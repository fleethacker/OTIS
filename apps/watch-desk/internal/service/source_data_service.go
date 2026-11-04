package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/defenseunicorns/ark/framework/go/pkg/connectrpc"
	"github.com/defenseunicorns/generated-app/ent"
	"github.com/defenseunicorns/generated-app/ent/messagerecord"
	appv1 "github.com/defenseunicorns/generated-app/gen/app/v1"
	"github.com/defenseunicorns/generated-app/gen/app/v1/appv1connect"
	"github.com/defenseunicorns/generated-app/internal/enterrors"
	"github.com/defenseunicorns/generated-app/internal/sourcedata"
	"github.com/go-chi/chi/v5"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ScheduleSource is the replaceable server-only integration boundary. It must
// return an error, never a retained snapshot, when a current read fails.
type ScheduleSource interface {
	Read(context.Context) ([]*appv1.MessageRecord, error)
}

type persistedScheduleSource struct{ db *ent.Client }

func (s *persistedScheduleSource) Read(ctx context.Context) ([]*appv1.MessageRecord, error) {
	records, err := s.db.MessageRecord.Query().Order(ent.Asc(messagerecord.FieldID)).
		WithEvents(func(q *ent.ExtractedEventQuery) {
			q.Order(ent.Asc("id")).WithRevisions(func(r *ent.EventRevisionQuery) { r.Order(ent.Asc("sequence")) })
		}).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("read persisted schedules: %w", enterrors.Map(err))
	}
	result := make([]*appv1.MessageRecord, 0, len(records))
	for _, m := range records {
		result = append(result, sourceMessageToProto(m))
	}
	return result, nil
}

// SourceDataService exposes current persisted records without parsing message text.
type SourceDataService struct {
	*connectrpc.BaseService
	source ScheduleSource
}

func init() {
	registerService(func(deps ServiceDeps) {
		db, ok := deps.App.Storage.EntClient().(*ent.Client)
		if !ok {
			panic("source data service requires ENT storage")
		}
		deps.App.AddService(NewSourceDataService(&persistedScheduleSource{db: db}))
	})
}

// NewSourceDataService constructs a service with a replaceable source.
func NewSourceDataService(source ScheduleSource) *SourceDataService {
	return &SourceDataService{BaseService: connectrpc.NewBaseService(), source: source}
}

// Register installs the generated Connect handler.
func (s *SourceDataService) Register(mux *chi.Mux, interceptors ...connect.Interceptor) {
	opts := connectrpc.HandlerOptions(append(s.Interceptors(), interceptors...)...)
	path, handler := appv1connect.NewSourceDataServiceHandler(s, opts...)
	mux.Handle(path+"*", handler)
}

// ReadSchedules returns a new read or an explicit failure without cached data.
func (s *SourceDataService) ReadSchedules(ctx context.Context, _ *connect.Request[appv1.ReadSchedulesRequest]) (*connect.Response[appv1.ReadSchedulesResponse], error) {
	messages, err := s.source.Read(ctx)
	if err == nil {
		err = validateSourceMessages(messages)
	}
	if err != nil {
		if ctx.Err() != nil {
			return nil, connect.NewError(connect.CodeCanceled, ctx.Err())
		}
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("schedule source read failed; previous results are not fresh"))
	}
	return connect.NewResponse(&appv1.ReadSchedulesResponse{
		Messages: messages, RetrievedAt: timestamppb.Now(), Source: "persisted-records",
		Notice: "Check each message's provenance. Fictional USS Meridian examples are illustrative, not operational information or validated USMTF. Read time is not source freshness.",
	}), nil
}

func validateSourceMessages(messages []*appv1.MessageRecord) error {
	for _, message := range messages {
		if message == nil {
			return errors.New("nil source message")
		}
		if message.StructuredPayloadJson == nil {
			continue
		}
		if err := sourcedata.ValidateStructuredPayloadJSON(*message.StructuredPayloadJson); err != nil {
			return fmt.Errorf("validate source message payload: %w", err)
		}
	}
	return nil
}

func sourceTimestamp(t *time.Time) *timestamppb.Timestamp {
	if t == nil {
		return nil
	}
	return timestamppb.New(t.UTC())
}

func sourceLines(lines []int) *appv1.SourceLineReferences {
	if lines == nil {
		return nil
	}
	result := &appv1.SourceLineReferences{Lines: make([]int32, 0, len(lines))}
	for _, line := range lines {
		// Evidence is one-based; invalid or unrepresentable stored values are not evidence.
		if line > 0 && int64(line) <= 2147483647 {
			result.Lines = append(result.Lines, int32(line))
		}
	}
	return result
}

func sourceLifecycleToProto(m *ent.MessageRecord) []*appv1.MessageLifecycleEntry {
	var result []*appv1.MessageLifecycleEntry
	hasReceived := false
	usedIDs := make(map[string]bool, len(m.LifecycleEntries))
	for _, entry := range m.LifecycleEntries {
		result = append(result, &appv1.MessageLifecycleEntry{
			Id: entry.ID, Milestone: entry.Milestone, RecordedAt: sourceTimestamp(entry.RecordedAt),
			Detail: entry.Detail, Provenance: entry.Provenance,
		})
		usedIDs[entry.ID] = true
		if strings.EqualFold(strings.TrimSpace(entry.Milestone), "received") &&
			entry.RecordedAt != nil && m.ReceivedAt != nil && entry.RecordedAt.Equal(*m.ReceivedAt) {
			hasReceived = true
		}
	}
	if m.ReceivedAt != nil && !hasReceived {
		id := "received_at"
		for usedIDs[id] {
			id += "_"
		}
		result = append(result, &appv1.MessageLifecycleEntry{
			Id: id, Milestone: "received", RecordedAt: sourceTimestamp(m.ReceivedAt),
			Detail: "From the message's received_at field; other processing history may be unavailable.", Provenance: string(m.Provenance),
		})
	}
	sort.SliceStable(result, func(i, j int) bool {
		a, b := result[i], result[j]
		if a.RecordedAt == nil || b.RecordedAt == nil {
			if (a.RecordedAt == nil) != (b.RecordedAt == nil) {
				return a.RecordedAt != nil
			}
		} else if !a.RecordedAt.AsTime().Equal(b.RecordedAt.AsTime()) {
			return a.RecordedAt.AsTime().Before(b.RecordedAt.AsTime())
		}
		return a.Id < b.Id
	})
	return result
}

func sourceMessageToProto(m *ent.MessageRecord) *appv1.MessageRecord {
	result := &appv1.MessageRecord{Id: int64(m.ID), SourceMessageId: m.SourceMessageID,
		Subject: m.Subject, RawText: m.RawText, Sender: m.Sender, ReceivedAt: sourceTimestamp(m.ReceivedAt),
		ProcessingStatus: string(m.ProcessingStatus), Provenance: string(m.Provenance),
		StructuredPayloadJson: m.StructuredPayloadJSON, ReferenceAttribution: m.ReferenceAttribution,
		LifecycleEntries: sourceLifecycleToProto(m)}
	if m.Recipients != nil {
		result.Recipients = &appv1.Recipients{Values: m.Recipients}
	}
	for _, e := range m.Edges.Events {
		event := &appv1.ExtractedEvent{Id: int64(e.ID), MessageId: int64(m.ID), SourceEventId: e.SourceEventID,
			Title: e.Title, Unit: e.Unit, Location: e.Location, StartAt: sourceTimestamp(e.StartAt), EndAt: sourceTimestamp(e.EndAt),
			ScheduleStatus: string(e.ScheduleStatus), IsRevised: e.IsRevised, ReviewReason: e.ReviewReason,
			TimeSourceLines: sourceLines(e.TimeSourceLines), LocationSourceLines: sourceLines(e.LocationSourceLines)}
		for _, r := range e.Edges.Revisions {
			event.Revisions = append(event.Revisions, &appv1.EventRevision{Id: int64(r.ID), EventId: int64(e.ID), Sequence: int64(r.Sequence),
				RevisedAt: sourceTimestamp(r.RevisedAt), PriorStartAt: sourceTimestamp(r.PriorStartAt), PriorEndAt: sourceTimestamp(r.PriorEndAt),
				ReplacementStartAt: sourceTimestamp(r.ReplacementStartAt), ReplacementEndAt: sourceTimestamp(r.ReplacementEndAt),
				SourceMessageId: r.SourceMessageID, Description: r.Description, TimeSourceLines: sourceLines(r.TimeSourceLines)})
		}
		result.Events = append(result.Events, event)
	}
	return result
}
