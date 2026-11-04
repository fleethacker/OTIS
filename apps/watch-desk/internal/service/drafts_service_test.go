package service

import (
	"connectrpc.com/connect"
	"context"
	"github.com/defenseunicorns/ark/framework/go/pkg/identity"
	appv1 "github.com/defenseunicorns/generated-app/gen/app/v1"
	"path/filepath"
	"testing"
)

func TestPrivateDraftPersistence(t *testing.T) {
	dsn := "file:" + filepath.Join(t.TempDir(), "drafts.db") + "?_pragma=foreign_keys(1)"
	db := sourceTestDB(t, dsn)
	ctx := context.Background()
	for _, source := range []string{"one", "two"} {
		if _, err := db.MessageRecord.Create().SetSourceMessageID(source).SetRawText("source").SetProvenance("fictional").Save(ctx); err != nil {
			t.Fatal(err)
		}
	}
	s := NewDraftService(db)
	owner := func(subject string) context.Context {
		return identity.NewContext(ctx, &identity.Identity{Subject: subject})
	}
	for _, subject := range []string{"alpha", "beta"} {
		for _, source := range []string{"one", "two"} {
			text := subject + source + "\n  exact text  \n"
			r, err := s.SaveDraft(owner(subject), connect.NewRequest(&appv1.SaveDraftRequest{SourceMessageId: source, Text: text}))
			if err != nil || r.Msg.Draft.Text != text || r.Msg.Draft.Status != "unsent" {
				t.Fatalf("save: %v %v", r, err)
			}
		}
	}
	if n, err := db.DraftAcknowledgement.Query().Count(ctx); err != nil || n != 4 {
		t.Fatalf("count %d %v", n, err)
	}
	_, err := s.SaveDraft(owner("alpha"), connect.NewRequest(&appv1.SaveDraftRequest{SourceMessageId: "one", Text: "replacement\n"}))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	s = NewDraftService(sourceTestDB(t, dsn))
	assertReloadedDrafts(t, s, owner)
	assertDraftDenials(t, s, owner)
}

func assertReloadedDrafts(t *testing.T, s *DraftService, owner func(string) context.Context) {
	t.Helper()
	for _, subject := range []string{"alpha", "beta"} {
		for _, source := range []string{"one", "two"} {
			r, err := s.ReadDraft(owner(subject), connect.NewRequest(&appv1.ReadDraftRequest{SourceMessageId: source}))
			want := subject + source + "\n  exact text  \n"
			if subject == "alpha" && source == "one" {
				want = "replacement\n"
			}
			if err != nil || r.Msg.Draft.Text != want {
				t.Fatalf("reload %v %v", r, err)
			}
		}
	}
}

func assertDraftDenials(t *testing.T, s *DraftService, owner func(string) context.Context) {
	t.Helper()
	ctx := context.Background()
	empty, err := s.ReadDraft(owner("other"), connect.NewRequest(&appv1.ReadDraftRequest{SourceMessageId: "one"}))
	if err != nil || empty.Msg.Draft != nil {
		t.Fatal("private draft leaked")
	}
	_, err = s.ReadDraft(ctx, connect.NewRequest(&appv1.ReadDraftRequest{SourceMessageId: "one"}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal(err)
	}
	_, err = s.SaveDraft(ctx, connect.NewRequest(&appv1.SaveDraftRequest{SourceMessageId: "one"}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal(err)
	}
	_, err = s.ReadDraft(owner("alpha"), connect.NewRequest(&appv1.ReadDraftRequest{SourceMessageId: "missing"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatal(err)
	}
}
