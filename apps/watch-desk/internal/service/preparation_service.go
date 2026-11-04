package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/defenseunicorns/generated-app/ent"
	"github.com/defenseunicorns/generated-app/ent/acknowledgementactivity"
	"github.com/defenseunicorns/generated-app/ent/acknowledgementpreparation"
	"github.com/defenseunicorns/generated-app/ent/messagerecord"
	appv1 "github.com/defenseunicorns/generated-app/gen/app/v1"
	"github.com/defenseunicorns/generated-app/internal/enterrors"
)

func preparationState(ctx context.Context, db *ent.Client, owner string, message int) (*appv1.PreparationState, error) {
	state := &appv1.PreparationState{FieldsJson: "{}", HistoryJson: "[]"}
	p, err := db.AcknowledgementPreparation.Query().Where(acknowledgementpreparation.OwnerSubjectEQ(owner), acknowledgementpreparation.HasMessageWith(messagerecord.ID(message))).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, fmt.Errorf("read private preparation: %w", err)
	}
	if p != nil {
		state.FieldsJson = p.FieldsJSON
		state.GeneratedText = p.GeneratedText
		state.Acknowledged = p.Acknowledged
	}
	events, err := db.AcknowledgementActivity.Query().Where(acknowledgementactivity.OwnerSubjectEQ(owner), acknowledgementactivity.HasMessageWith(messagerecord.ID(message))).Order(ent.Asc(acknowledgementactivity.FieldID)).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("read private activity: %w", err)
	}
	type event struct {
		ID         int        `json:"id"`
		Kind       string     `json:"kind"`
		Recorder   string     `json:"recorder"`
		RecordedAt time.Time  `json:"recorded_at"`
		OccurredAt *time.Time `json:"occurred_at"`
		Note       string     `json:"note"`
		Provenance string     `json:"provenance"`
	}
	history := make([]event, 0, len(events))
	for _, e := range events {
		history = append(history, event{e.ID, string(e.Kind), e.OwnerSubject, e.RecordedAt, e.OccurredAt, e.Note, "user-reported"})
	}
	raw, err := json.Marshal(history)
	if err != nil {
		return nil, fmt.Errorf("encode private activity: %w", err)
	}
	state.HistoryJson = string(raw)
	return state, nil
}

// ReadPreparation returns only the authenticated owner's state and activity.
func (s *DraftService) ReadPreparation(ctx context.Context, req *connect.Request[appv1.ReadPreparationRequest]) (*connect.Response[appv1.PreparationState], error) {
	owner, m, err := s.scope(ctx, req.Msg.SourceMessageId)
	if err != nil {
		return nil, err
	}
	state, err := preparationState(ctx, s.db, owner, m.ID)
	if err != nil {
		return nil, fmt.Errorf("read preparation: %w", enterrors.Map(err))
	}
	return connect.NewResponse(state), nil
}

// SavePreparation saves incomplete work or generates a server-validated unsent body.
func (s *DraftService) SavePreparation(ctx context.Context, req *connect.Request[appv1.SavePreparationRequest]) (*connect.Response[appv1.PreparationState], error) {
	owner, m, err := s.scope(ctx, req.Msg.SourceMessageId)
	if err != nil {
		return nil, err
	}
	fields, text, err := parsePreparation(req.Msg.FieldsJson, req.Msg.Generate)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return s.mutatePreparation(ctx, owner, m.ID, fields, text, req.Msg.Generate, nil, "", nil)
}

// RecordAcknowledgement appends user-reported external activity or a private reset.
func (s *DraftService) RecordAcknowledgement(ctx context.Context, req *connect.Request[appv1.RecordAcknowledgementRequest]) (*connect.Response[appv1.PreparationState], error) {
	owner, m, err := s.scope(ctx, req.Msg.SourceMessageId)
	if err != nil {
		return nil, err
	}
	if req.Msg.Acknowledged && !req.Msg.ConfirmedExternal {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("confirmed_external: confirm acknowledgement occurred outside Watch Desk"))
	}
	note := req.Msg.Note
	if !utf8.ValidString(note) || utf8.RuneCountInString(note) > 2000 || strings.IndexFunc(note, func(r rune) bool { return unicode.IsControl(r) || unicode.Is(unicode.Cf, r) }) >= 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("note: maximum 2000 characters without control characters"))
	}
	var occurred *time.Time
	if req.Msg.OccurredAt != "" {
		at, err := time.Parse(time.RFC3339Nano, req.Msg.OccurredAt)
		if err != nil || at.Year() < 1 {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("occurred_at: use RFC3339 with an explicit timezone or leave unknown empty"))
		}
		at = at.UTC()
		occurred = &at
	}
	return s.mutatePreparation(ctx, owner, m.ID, "", "", false, &req.Msg.Acknowledged, note, occurred)
}

// Upsert only the changed columns; append the event and read the result in the same transaction.
func (s *DraftService) mutatePreparation(ctx context.Context, owner string, message int, fields, text string, generate bool, ack *bool, note string, occurred *time.Time) (*connect.Response[appv1.PreparationState], error) {
	tx, err := s.db.Tx(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin preparation transaction: %w", enterrors.Map(err))
	}
	defer func() {
		if rollbackErr := tx.Rollback(); rollbackErr != nil && !errors.Is(rollbackErr, sql.ErrTxDone) {
			slog.Warn("preparation transaction rollback failed")
		}
	}()
	create := tx.AcknowledgementPreparation.Create().SetOwnerSubject(owner).SetMessageID(message)
	kind := acknowledgementactivity.KindSaved
	if ack != nil {
		create.SetAcknowledged(*ack)
		kind = acknowledgementactivity.KindReset
		if *ack {
			kind = acknowledgementactivity.KindAcknowledged
		}
	} else {
		create.SetFieldsJSON(fields).SetGeneratedText(text)
		if generate {
			kind = acknowledgementactivity.KindGenerated
		}
	}
	err = create.OnConflictColumns(acknowledgementpreparation.FieldOwnerSubject, "message_record_preparations").Update(func(u *ent.AcknowledgementPreparationUpsert) {
		if ack != nil {
			u.SetAcknowledged(*ack)
		} else {
			u.SetFieldsJSON(fields).SetGeneratedText(text)
		}
	}).Exec(ctx)
	if err != nil {
		return nil, fmt.Errorf("save preparation: %w", enterrors.Map(err))
	}
	err = tx.AcknowledgementActivity.Create().SetOwnerSubject(owner).SetMessageID(message).SetKind(kind).SetNote(note).SetRecordedAt(time.Now().UTC()).SetNillableOccurredAt(occurred).Exec(ctx)
	if err != nil {
		return nil, fmt.Errorf("append private activity: %w", enterrors.Map(err))
	}
	state, err := preparationState(ctx, tx.Client(), owner, message)
	if err != nil {
		return nil, fmt.Errorf("read saved preparation: %w", enterrors.Map(err))
	}
	if err = tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit preparation: %w", enterrors.Map(err))
	}
	return connect.NewResponse(state), nil
}
