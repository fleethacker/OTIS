package service

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/defenseunicorns/ark/framework/go/pkg/identity"
	"github.com/defenseunicorns/generated-app/ent"
	appv1 "github.com/defenseunicorns/generated-app/gen/app/v1"
)

func samplePreparation() preparationFields {
	return preparationFields{Outgoing: "USS EXAMPLE", Letter: "A", Type: "OPTASK LINK", Originator: "CTF DEMO", DTG: "041200ZNOV2026", Authority: "USS EXAMPLE", Family: "ACTAGCY", Response: "WILCO", Confirmed: true}
}
func fieldsJSON(f preparationFields) string { raw, _ := json.Marshal(f); return string(raw) }

func TestPreparationFormatter(t *testing.T) {
	f := samplePreparation()
	_, text, err := parsePreparation(fieldsJSON(f), true)
	want := "MSGID/AKNLDG/USS EXAMPLE//\nREF/A/OPTASK LINK/CTF DEMO/041200ZNOV2026//\nACTAGCY/USS EXAMPLE/WILCO/A//"
	if err != nil || text != want {
		t.Fatalf("synthetic example: %q %v", text, err)
	}
	for family, codes := range map[string][]string{"ACTAGCY": {"ACK", "WILCO", "HAVCO", "CANTCO"}, "ICVALID": {"NONVAL", "VALID", "VALCHG"}} {
		for _, code := range codes {
			f.Family = family
			f.Response = code
			f.ContextKind = "EXER"
			f.Context = "DEMO"
			f.Serial = "123"
			_, text, err := parsePreparation(fieldsJSON(f), true)
			if err != nil || !strings.HasPrefix(text, "EXER/DEMO//\nMSGID/") || !strings.HasSuffix(text, family+"/USS EXAMPLE/"+code+"/A//") || !strings.Contains(text, "ZNOV2026/123//") {
				t.Fatalf("%s %s: %q %v", family, code, text, err)
			}
		}
	}
	for _, dtg := range []string{"291200ZFEB2024", "010000ZJAN0001", "312359ZDEC9999"} {
		f = samplePreparation()
		f.DTG = dtg
		if _, _, err := parsePreparation(fieldsJSON(f), true); err != nil {
			t.Fatalf("valid date %s: %v", dtg, err)
		}
	}
	for _, dtg := range []string{"291200ZFEB2025", "311200ZAPR2026", "012400ZJAN2026", "011260ZJAN2026", "041200ZNOV26", "041200ANOV2026", "041200Znov2026", "001200ZNOV2026", "041200ZNOV0000"} {
		f = samplePreparation()
		f.DTG = dtg
		if _, _, err := parsePreparation(fieldsJSON(f), true); err == nil {
			t.Fatalf("accepted %s", dtg)
		}
	}
}

func TestPreparationInvalidFields(t *testing.T) {
	invalid := []func(*preparationFields){
		func(f *preparationFields) { f.Outgoing = "" }, func(f *preparationFields) { f.Confirmed = false },
		func(f *preparationFields) { f.Response = "HAVECO" }, func(f *preparationFields) { f.Family = "ICVALID" },
		func(f *preparationFields) { f.Letter = "a" }, func(f *preparationFields) { f.Type = "X" },
		func(f *preparationFields) { f.ContextKind = "OPER" }, func(f *preparationFields) { f.Context = "unlinked" },
		func(f *preparationFields) { f.ContextKind = "BOTH"; f.Context = "context" },
		func(f *preparationFields) { f.Authority = "UNIT//ACTAGCY" }, func(f *preparationFields) { f.Notes = "hidden\nset" },
		func(f *preparationFields) { f.Serial = strings.Repeat("1", 11) },
	}
	for i, edit := range invalid {
		f := samplePreparation()
		edit(&f)
		if _, _, err := parsePreparation(fieldsJSON(f), true); err == nil {
			t.Errorf("accepted invalid case %d", i)
		}
	}
	for _, raw := range []string{`null`, `[]`, `{"outgoing":null}`, `{"outgoing":1}`, `{"outgoing":"a","outgoing":"b"}`, `{"unknown":"x"}`, `{} {}`, `{"confirmed":"true"}`, strings.Repeat(" ", 16385)} {
		if _, _, err := parsePreparation(raw, false); err == nil {
			t.Errorf("accepted unsafe JSON %q", raw)
		}
	}
	if _, text, err := parsePreparation(`{"dtg":"partial","response":""}`, false); err != nil || text != "" {
		t.Fatalf("incomplete WIP %v", err)
	}
}

func TestPreparationPersistence(t *testing.T) {
	dsn := "file:" + filepath.Join(t.TempDir(), "preparation.db") + "?_pragma=foreign_keys(1)"
	db := sourceTestDB(t, dsn)
	s := NewDraftService(db)
	ctx := context.Background()
	owner := identity.NewContext(ctx, &identity.Identity{Subject: "alpha"})
	for _, source := range []string{"one", "two"} {
		if _, err := db.MessageRecord.Create().SetSourceMessageID(source).SetRawText("raw").SetProvenance("fictional").Save(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.SaveDraft(owner, connect.NewRequest(&appv1.SaveDraftRequest{SourceMessageId: "one", Text: "legacy exact\n"})); err != nil {
		t.Fatal(err)
	}
	save := func(raw string, generate bool) (*connect.Response[appv1.PreparationState], error) {
		return s.SavePreparation(owner, connect.NewRequest(&appv1.SavePreparationRequest{SourceMessageId: "one", FieldsJson: raw, Generate: generate}))
	}
	state, err := save(fieldsJSON(samplePreparation()), true)
	if err != nil || state.Msg.GeneratedText == "" || state.Msg.Acknowledged {
		t.Fatalf("generate %v %v", state, err)
	}
	_, err = s.RecordAcknowledgement(owner, connect.NewRequest(&appv1.RecordAcknowledgementRequest{SourceMessageId: "one", Acknowledged: true}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatal("missing external confirmation", err)
	}
	_, err = s.RecordAcknowledgement(owner, connect.NewRequest(&appv1.RecordAcknowledgementRequest{SourceMessageId: "one", Acknowledged: true, ConfirmedExternal: true, OccurredAt: "yesterday"}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatal("bad occurrence", err)
	}
	state, err = s.RecordAcknowledgement(owner, connect.NewRequest(&appv1.RecordAcknowledgementRequest{SourceMessageId: "one", Acknowledged: true, ConfirmedExternal: true, Note: "manual email", OccurredAt: "2026-11-04T12:00:00Z"}))
	if err != nil || !state.Msg.Acknowledged || state.Msg.GeneratedText == "" {
		t.Fatalf("record %v %v", state, err)
	}
	state, err = save(`{"notes":"unfinished"}`, false)
	if err != nil || !state.Msg.Acknowledged || state.Msg.GeneratedText != "" {
		t.Fatalf("WIP must invalidate output only: %v %v", state, err)
	}
	state, err = s.RecordAcknowledgement(owner, connect.NewRequest(&appv1.RecordAcknowledgementRequest{SourceMessageId: "one", Note: "correction"}))
	if err != nil || state.Msg.Acknowledged {
		t.Fatalf("reset %v %v", state, err)
	}
	history := state.Msg.HistoryJson
	assertPreparationHistory(t, history)
	if _, err = save(`{"outgoing":"inject//"}`, false); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	s = NewDraftService(sourceTestDB(t, dsn))
	assertPreparationReload(t, s, owner, history)
}

func assertPreparationHistory(t *testing.T, history string) {
	t.Helper()
	if !strings.Contains(history, `"occurred_at":null`) || !strings.Contains(history, `"recorder":"alpha"`) || !strings.Contains(history, `"provenance":"user-reported"`) {
		t.Fatal(history)
	}
	var events []map[string]any
	if err := json.Unmarshal([]byte(history), &events); err != nil || len(events) != 4 {
		t.Fatalf("history %s %v", history, err)
	}
}

func assertPreparationReload(t *testing.T, s *DraftService, owner context.Context, history string) {
	t.Helper()
	ctx := context.Background()
	restored, err := s.ReadPreparation(owner, connect.NewRequest(&appv1.ReadPreparationRequest{SourceMessageId: "one"}))
	if err != nil || restored.Msg.HistoryJson != history || !strings.Contains(restored.Msg.FieldsJson, "unfinished") {
		t.Fatalf("reload %v %v", restored, err)
	}
	legacy, err := s.ReadDraft(owner, connect.NewRequest(&appv1.ReadDraftRequest{SourceMessageId: "one"}))
	if err != nil || legacy.Msg.Draft.Text != "legacy exact\n" {
		t.Fatal("legacy changed", err)
	}
	for _, scope := range []struct {
		ctx    context.Context
		source string
	}{{identity.NewContext(ctx, &identity.Identity{Subject: "beta"}), "one"}, {owner, "two"}} {
		r, err := s.ReadPreparation(scope.ctx, connect.NewRequest(&appv1.ReadPreparationRequest{SourceMessageId: scope.source}))
		if err != nil || r.Msg.FieldsJson != "{}" || r.Msg.HistoryJson != "[]" || r.Msg.Acknowledged {
			t.Fatal("scope leaked", r, err)
		}
	}
	_, err = s.ReadPreparation(ctx, connect.NewRequest(&appv1.ReadPreparationRequest{SourceMessageId: "one"}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal(err)
	}
	_, err = s.SavePreparation(ctx, connect.NewRequest(&appv1.SavePreparationRequest{SourceMessageId: "one", FieldsJson: "{}"}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal(err)
	}
	_, err = s.RecordAcknowledgement(ctx, connect.NewRequest(&appv1.RecordAcknowledgementRequest{SourceMessageId: "one"}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal(err)
	}
	_, err = s.ReadPreparation(owner, connect.NewRequest(&appv1.ReadPreparationRequest{SourceMessageId: "missing"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatal(err)
	}
	// Reject the audit insert after the upsert to prove both changes roll back.
	s.db.AcknowledgementActivity.Use(func(_ ent.Mutator) ent.Mutator {
		return ent.MutateFunc(func(_ context.Context, _ ent.Mutation) (ent.Value, error) {
			return nil, errors.New("audit storage unavailable")
		})
	})
	_, err = s.RecordAcknowledgement(owner, connect.NewRequest(&appv1.RecordAcknowledgementRequest{SourceMessageId: "one", Acknowledged: true, ConfirmedExternal: true}))
	if err == nil {
		t.Fatal("failed audit reported success")
	}
	restored, err = s.ReadPreparation(owner, connect.NewRequest(&appv1.ReadPreparationRequest{SourceMessageId: "one"}))
	if err != nil || restored.Msg.Acknowledged || restored.Msg.HistoryJson != history {
		t.Fatalf("partial transaction persisted: %v %v", restored, err)
	}
}
