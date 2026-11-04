package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/defenseunicorns/ark/framework/go/pkg/connectrpc"
	"github.com/defenseunicorns/ark/framework/go/pkg/identity"
	"github.com/defenseunicorns/generated-app/ent"
	"github.com/defenseunicorns/generated-app/ent/draftacknowledgement"
	"github.com/defenseunicorns/generated-app/ent/messagerecord"
	appv1 "github.com/defenseunicorns/generated-app/gen/app/v1"
	"github.com/defenseunicorns/generated-app/gen/app/v1/appv1connect"
	"github.com/defenseunicorns/generated-app/internal/enterrors"
	"github.com/go-chi/chi/v5"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// DraftService persists private, unsent text only.
type DraftService struct {
	*connectrpc.BaseService
	db *ent.Client
}

func init() {
	registerService(func(deps ServiceDeps) {
		db, ok := deps.App.Storage.EntClient().(*ent.Client)
		if !ok {
			panic("draft service requires ENT storage")
		}
		deps.App.AddService(NewDraftService(db))
	})
}

// NewDraftService binds persistence.
func NewDraftService(db *ent.Client) *DraftService {
	return &DraftService{connectrpc.NewBaseService(), db}
}

// Register installs the draft RPCs.
func (s *DraftService) Register(mux *chi.Mux, interceptors ...connect.Interceptor) {
	path, handler := appv1connect.NewDraftServiceHandler(s, connectrpc.HandlerOptions(append(s.Interceptors(), interceptors...)...)...)
	mux.Handle(path+"*", handler)
}
func (s *DraftService) scope(ctx context.Context, source string) (string, *ent.MessageRecord, error) {
	id := identity.FromContext(ctx)
	if id == nil || id.Subject == "" {
		return "", nil, connect.NewError(connect.CodeUnauthenticated, errors.New("identity required"))
	}
	m, err := s.db.MessageRecord.Query().Where(messagerecord.SourceMessageIDEQ(source)).Only(ctx)
	if err != nil {
		return "", nil, fmt.Errorf("read draft source: %w", enterrors.Map(err))
	}
	return id.Subject, m, nil
}
func draftProto(d *ent.DraftAcknowledgement, message int) *appv1.DraftAcknowledgement {
	return &appv1.DraftAcknowledgement{Id: int64(d.ID), MessageId: int64(message), Text: d.Text, Status: string(d.Status), SavedAt: timestamppb.New(d.SavedAt)}
}

// ReadDraft distinguishes an absent draft from a missing source.
func (s *DraftService) ReadDraft(ctx context.Context, req *connect.Request[appv1.ReadDraftRequest]) (*connect.Response[appv1.ReadDraftResponse], error) {
	owner, m, err := s.scope(ctx, req.Msg.SourceMessageId)
	if err != nil {
		return nil, err
	}
	d, err := s.db.DraftAcknowledgement.Query().Where(draftacknowledgement.OwnerSubjectEQ(owner), draftacknowledgement.HasMessageWith(messagerecord.ID(m.ID))).Only(ctx)
	if ent.IsNotFound(err) {
		return connect.NewResponse(&appv1.ReadDraftResponse{}), nil
	}
	if err != nil {
		return nil, fmt.Errorf("read private draft: %w", enterrors.Map(err))
	}
	return connect.NewResponse(&appv1.ReadDraftResponse{Draft: draftProto(d, m.ID)}), nil
}

// SaveDraft atomically replaces this owner's text without changing the source or unsent status.
func (s *DraftService) SaveDraft(ctx context.Context, req *connect.Request[appv1.SaveDraftRequest]) (*connect.Response[appv1.SaveDraftResponse], error) {
	owner, m, err := s.scope(ctx, req.Msg.SourceMessageId)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	err = s.db.DraftAcknowledgement.Create().SetOwnerSubject(owner).SetMessage(m).SetText(req.Msg.Text).SetSavedAt(now).
		OnConflictColumns(draftacknowledgement.FieldOwnerSubject, "message_record_drafts").Update(func(u *ent.DraftAcknowledgementUpsert) { u.SetText(req.Msg.Text).SetSavedAt(now) }).Exec(ctx)
	if err != nil {
		return nil, fmt.Errorf("save private draft: %w", enterrors.Map(err))
	}
	return connect.NewResponse(&appv1.SaveDraftResponse{Draft: &appv1.DraftAcknowledgement{MessageId: int64(m.ID), Text: req.Msg.Text, Status: "unsent", SavedAt: timestamppb.New(now)}}), nil
}
