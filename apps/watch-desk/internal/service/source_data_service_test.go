package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"connectrpc.com/connect"
	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/defenseunicorns/ark/framework/go/pkg/identity"
	"github.com/defenseunicorns/ark/framework/go/pkg/seed"
	"github.com/defenseunicorns/generated-app/ent"
	appv1 "github.com/defenseunicorns/generated-app/gen/app/v1"
	"github.com/defenseunicorns/generated-app/gen/app/v1/appv1connect"
	"github.com/defenseunicorns/generated-app/internal/sourcedata"
	"github.com/go-chi/chi/v5"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func seedStructuredReferences(t *testing.T, ctx context.Context, db *ent.Client) (map[string]string, map[string]string) {
	t.Helper()
	data, err := os.ReadFile("testdata/structured-messages.json")
	if os.IsNotExist(err) {
		t.Skip("optional external OPTASK references absent; restore from the original archive with scripts/restore-ark-fixtures.py at the monorepo root")
	}
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct{ ID, Name, Purpose, Text string }
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(fixtures) != 14 {
		t.Fatalf("fixtures = %d", len(fixtures))
	}
	want := make(map[string]string)
	attributions := make(map[string]string)
	for _, fixture := range fixtures {
		if fixture.Purpose != "reference" || fixture.ID == "" || fixture.Name == "" {
			t.Fatal("unattributed reference")
		}
		id := "reference:" + fixture.ID
		attribution := fixture.Name + " (attachment " + fixture.ID + "; reference/test only)"
		if _, exists := want[id]; exists {
			t.Fatal("duplicate reference")
		}
		want[id], attributions[id] = fixture.Text, attribution
		_, err := db.MessageRecord.Create().SetSourceMessageID(id).SetRawText("").SetProvenance("reference").
			SetStructuredPayloadJSON(fixture.Text).SetReferenceAttribution(attribution).Save(ctx)
		if err != nil {
			t.Fatal(err)
		}
	}
	return want, attributions
}

func TestStructuredMessagesPersistedContract(t *testing.T) {
	ctx := context.Background()
	dsn := "file:" + filepath.Join(t.TempDir(), "structured.db") + "?_pragma=foreign_keys(1)"
	db := sourceTestDB(t, dsn)
	want, attributions := seedStructuredReferences(t, ctx, db)
	// Preserve exact spelling, whitespace, large numbers, unknown types and nested
	// values. Missing fields are intentionally not filled from other metadata.
	extensions := []string{
		" {\n\"type\":\"FUTURE\",\"extension\":{\"null\":null,\"false\":false,\"zero\":0,\"empty\":[],\"object\":{},\"large\":9007199254740993,\"decimal\":1.2300,\"array\":[3,null,false,0,{},[]]},\"activities\":[{\"type\":\"future\",\"extra\":{\"value\":false}}]}\n",
		`{"subject":null,"security":{"classification":null,"extension":[null,false,0]},"periods":[{"end_status":"open_ended"}],"frequencies":[{"hz":null,"upper_hz":null},{"hz":23}],"contacts":[{"channels":[{"type":"FUTURE","value":"<script>alert(1)</script>"}]}]}`,
		`{"subject":"","issued_at":null,"review_flags":[],"extension":"","same":1,"same":2}`,
		`{}`,
	}
	for i, payload := range extensions {
		id := fmt.Sprintf("extension-%d", i)
		want[id], attributions[id] = payload, ""
		if _, err := db.MessageRecord.Create().SetSourceMessageID(id).SetRawText("").SetProvenance("reference").SetStructuredPayloadJSON(payload).SetReferenceAttribution("").Save(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.MessageRecord.Create().SetSourceMessageID("legacy").SetRawText("legacy source\nline two").SetProvenance("upstream").Save(ctx); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	reopened := sourceTestDB(t, dsn)
	response, err := sourceTestRPC(t, reopened).ReadSchedules(ctx, connect.NewRequest(&appv1.ReadSchedulesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Msg.Messages) != len(want)+1 {
		t.Fatal("records lost")
	}
	for _, message := range response.Msg.Messages {
		assertStructuredMessage(t, message, want, attributions)
	}
}

func assertStructuredMessage(t *testing.T, message *appv1.MessageRecord, want, attributions map[string]string) {
	t.Helper()
	if message.SourceMessageId == "legacy" {
		if message.StructuredPayloadJson != nil || message.ReferenceAttribution != nil || message.RawText != "legacy source\nline two" {
			t.Fatal("legacy changed")
		}
		return
	}
	payload, exists := want[message.SourceMessageId]
	if !exists || message.StructuredPayloadJson == nil || *message.StructuredPayloadJson != payload || message.ReferenceAttribution == nil || *message.ReferenceAttribution != attributions[message.SourceMessageId] {
		t.Fatalf("lossy record: %v", message)
	}
	if message.Provenance != "reference" || message.Id == 0 || message.RawText != "" || message.ReceivedAt != nil || message.Subject != nil || len(message.Events) != 0 || len(message.LifecycleEntries) != 0 || len(message.Drafts) != 0 {
		t.Fatal("invented source evidence")
	}
	encoded, err := protojson.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	var decoded appv1.MessageRecord
	if err := protojson.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(message, &decoded) {
		t.Fatal("generated JSON contract lost presence or text")
	}
}

type structuredTestSource struct{ payload string }

func (s structuredTestSource) Read(context.Context) ([]*appv1.MessageRecord, error) {
	return []*appv1.MessageRecord{{StructuredPayloadJson: &s.payload}}, nil
}

func TestStructuredPayloadValidation(t *testing.T) {
	db := sourceTestDB(t, "file:"+filepath.Join(t.TempDir(), "validation.db")+"?_pragma=foreign_keys(1)")
	for _, payload := range []string{"", "null", "[]", "false", "0", `"text"`, "{", "{} {}"} {
		t.Run(payload, func(t *testing.T) {
			if _, err := db.MessageRecord.Create().SetSourceMessageID("invalid").SetRawText("").SetProvenance("upstream").SetStructuredPayloadJSON(payload).Save(context.Background()); err == nil {
				t.Fatal("invalid envelope persisted")
			}
			response, err := NewSourceDataService(structuredTestSource{payload}).ReadSchedules(context.Background(), connect.NewRequest(&appv1.ReadSchedulesRequest{}))
			if response != nil || connect.CodeOf(err) != connect.CodeUnavailable {
				t.Fatal("invalid adapter payload accepted")
			}
		})
	}
}

func TestStructuredPayloadLegacyMigration(t *testing.T) {
	dsn := "file:" + filepath.Join(t.TempDir(), "legacy.db") + "?_pragma=foreign_keys(1)"
	old, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer old.Close()
	if _, err := old.ExecContext(context.Background(), `CREATE TABLE message_records (id integer PRIMARY KEY AUTOINCREMENT, source_message_id text NOT NULL UNIQUE, raw_text text NOT NULL, processing_status text NOT NULL DEFAULT 'unknown', provenance text NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := old.ExecContext(context.Background(), `INSERT INTO message_records(source_message_id, raw_text, provenance) VALUES ('old-source', 'original raw', 'upstream')`); err != nil {
		t.Fatal(err)
	}
	db := sourceTestDB(t, dsn)
	response, err := sourceTestRPC(t, db).ReadSchedules(context.Background(), connect.NewRequest(&appv1.ReadSchedulesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Msg.Messages) != 1 {
		t.Fatal("migration lost legacy row")
	}
	m := response.Msg.Messages[0]
	if m.SourceMessageId != "old-source" || m.RawText != "original raw" || m.StructuredPayloadJson != nil || m.ReferenceAttribution != nil {
		t.Fatal("migration changed legacy source")
	}
}

func sourceTestDB(t *testing.T, dsn string) *ent.Client {
	t.Helper()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	client := ent.NewClient(ent.Driver(entsql.OpenDB(dialect.SQLite, db)))
	t.Cleanup(func() { _ = client.Close() })
	if err := client.Schema.Create(context.Background()); err != nil {
		t.Fatal(err)
	}
	return client
}

func sourceTestRPC(t *testing.T, db *ent.Client) appv1connect.SourceDataServiceClient {
	t.Helper()
	mux := chi.NewRouter()
	NewSourceDataService(&persistedScheduleSource{db: db}).Register(mux)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return appv1connect.NewSourceDataServiceClient(server.Client(), server.URL)
}

func TestSourceDataPersistedContract(t *testing.T) {
	ctx := context.Background()
	dsn := "file:" + filepath.Join(t.TempDir(), "source.db") + "?_pragma=foreign_keys(1)"
	db := sourceTestDB(t, dsn)
	seedPath := "../data/seed_data.json"
	logger := slog.Default()
	if err := seed.AutoSeedContext(ctx, dsn, seedPath, logger); err != nil {
		t.Fatal(err)
	}
	client := sourceTestRPC(t, db)
	first, err := client.ReadSchedules(ctx, connect.NewRequest(&appv1.ReadSchedulesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	assertMeridian(t, first.Msg)
	again, err := client.ReadSchedules(ctx, connect.NewRequest(&appv1.ReadSchedulesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(first.Msg.Messages[0], again.Msg.Messages[0]) {
		t.Fatal("unstable read")
	}
	if again.Msg.RetrievedAt.AsTime().Before(first.Msg.RetrievedAt.AsTime()) {
		t.Fatal("read time regressed")
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	restarted := sourceTestDB(t, dsn)
	if err := seed.AutoSeedContext(ctx, dsn, seedPath, logger); err != nil {
		t.Fatal(err)
	}
	after, err := sourceTestRPC(t, restarted).ReadSchedules(ctx, connect.NewRequest(&appv1.ReadSchedulesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	assertMeridian(t, after.Msg)
	for i, m := range first.Msg.Messages {
		if !proto.Equal(m, after.Msg.Messages[i]) {
			t.Fatal("restart changed records")
		}
	}
	// A previously successful source must not return cached data after a failure.
	if err := restarted.Close(); err != nil {
		t.Fatal(err)
	}
	failed, err := sourceTestRPC(t, restarted).ReadSchedules(ctx, connect.NewRequest(&appv1.ReadSchedulesRequest{}))
	if connect.CodeOf(err) != connect.CodeUnavailable || failed != nil {
		t.Fatalf("expected explicit failure, got %v, %v", failed, err)
	}
}

func assertMeridian(t *testing.T, result *appv1.ReadSchedulesResponse) {
	t.Helper()
	if len(result.Messages) != 5 || result.Source != "persisted-records" || result.RetrievedAt == nil || result.Notice == "" {
		t.Fatalf("invalid snapshot: %v", result)
	}
	count := 0
	for _, m := range result.Messages {
		if m.Provenance != "fictional" || m.RawText == "" || m.SourceMessageId == "" {
			t.Fatal("missing provenance/source")
		}
		for _, e := range m.Events {
			count++
			if e.MessageId != m.Id {
				t.Fatal("broken event link")
			}
		}
	}
	if count != 8 {
		t.Fatalf("events = %d, want 8", count)
	}
	assertSourceEvidence(t, result)
	assertScheduleBoundaries(t, result)
	assertPartialSchedule(t, result)
	assertMeridianLifecycle(t, result)
}

func assertMeridianLifecycle(t *testing.T, result *appv1.ReadSchedulesResponse) {
	t.Helper()
	if entries := result.Messages[0].LifecycleEntries; len(entries) != 4 || entries[0].Id != "m1-received" || entries[3].Milestone != "acknowledged" || entries[3].Detail == "" {
		t.Fatalf("rich lifecycle lost or received duplicated: %v", entries)
	}
	want := []string{"received_at", "m4-parsed", "m4-ingested", "m4-parsed-again", "m4-review"}
	for i, entry := range result.Messages[3].LifecycleEntries {
		if i >= len(want) || entry.Id != want[i] || entry.Provenance != "fictional" {
			t.Fatalf("partial lifecycle order/provenance: %v", result.Messages[3].LifecycleEntries)
		}
	}
	if len(result.Messages[3].LifecycleEntries) != len(want) || result.Messages[3].LifecycleEntries[4].RecordedAt != nil || len(result.Messages[4].LifecycleEntries) != 0 {
		t.Fatal("partial or absent history fabricated")
	}
	for _, i := range []int{1, 2} {
		if entries := result.Messages[i].LifecycleEntries; len(entries) != 1 || entries[0].Milestone != "received" {
			t.Fatal("legacy history inferred from status")
		}
	}
}

func TestSourceLifecycleOrderingAndReceivedFallback(t *testing.T) {
	instant, _ := time.Parse(time.RFC3339, "2026-11-05T01:00:00+02:00")
	later := instant.Add(time.Hour)
	entries := []sourcedata.MessageLifecycleEntry{
		{ID: "unknown-z", Milestone: "acknowledged", Detail: "external evidence", Provenance: "upstream"},
		{ID: "tie-z", Milestone: "parsed", RecordedAt: &later},
		{ID: "received_at", Milestone: "reviewed", RecordedAt: &later},
		{ID: "tie-a", Milestone: "parsed", RecordedAt: &later},
		{ID: "unknown-a", Milestone: "received"},
	}
	for _, equivalent := range []bool{false, true} {
		t.Run(map[bool]string{false: "fallback", true: "equivalent"}[equivalent], func(t *testing.T) {
			m := &ent.MessageRecord{ReceivedAt: &instant, LifecycleEntries: append([]sourcedata.MessageLifecycleEntry{}, entries...)}
			firstID := "received_at_"
			if equivalent {
				utc := instant.UTC()
				m.LifecycleEntries = append(m.LifecycleEntries, sourcedata.MessageLifecycleEntry{ID: "supplied", Milestone: " Received ", RecordedAt: &utc})
				firstID = "supplied"
			}
			got := sourceMessageToProto(m)
			var ids []string
			for _, entry := range got.LifecycleEntries {
				ids = append(ids, entry.Id)
			}
			if want := []string{firstID, "received_at", "tie-a", "tie-z", "unknown-a", "unknown-z"}; !reflect.DeepEqual(ids, want) {
				t.Fatalf("IDs = %v, want %v", ids, want)
			}
			if got.LifecycleEntries[0].RecordedAt.AsTime().Format(time.RFC3339) != "2026-11-04T23:00:00Z" || got.LifecycleEntries[5].RecordedAt != nil || got.LifecycleEntries[5].Detail != "external evidence" {
				t.Fatal("UTC, unavailable time or detail lost")
			}
			if !reflect.DeepEqual(m.LifecycleEntries[:len(entries)], entries) {
				t.Fatal("serialization mutated stored history")
			}
		})
	}
	repeated := sourceMessageToProto(&ent.MessageRecord{ReceivedAt: &instant, LifecycleEntries: []sourcedata.MessageLifecycleEntry{
		{ID: "later-receipt", Milestone: "received", RecordedAt: &later},
	}})
	if len(repeated.LifecycleEntries) != 2 || repeated.LifecycleEntries[1].Id != "later-receipt" {
		t.Fatal("a differently dated receipt must not suppress fallback or be collapsed")
	}
}

func TestSourceLifecycleUnaffectedByPrivateDrafts(t *testing.T) {
	ctx := context.Background()
	db := sourceTestDB(t, "file:"+filepath.Join(t.TempDir(), "private.db")+"?_pragma=foreign_keys(1)")
	_, err := db.MessageRecord.Create().SetSourceMessageID("private-history").SetRawText("source").SetProvenance("upstream").SetProcessingStatus("parsed").
		SetLifecycleEntries([]sourcedata.MessageLifecycleEntry{{ID: "external-ack", Milestone: "acknowledged", Detail: "External evidence", Provenance: "upstream"}}).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	source := &persistedScheduleSource{db: db}
	before, err := source.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, subject := range []string{"alpha", "beta"} {
		owner := identity.NewContext(ctx, &identity.Identity{Subject: subject})
		saved, err := NewDraftService(db).SaveDraft(owner, connect.NewRequest(&appv1.SaveDraftRequest{SourceMessageId: "private-history", Text: "private " + subject}))
		if err != nil || saved.Msg.Draft.Status != "unsent" {
			t.Fatalf("save draft: %v %v", saved, err)
		}
	}
	after, err := source.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(before[0], after[0]) || len(after[0].Drafts) != 0 || len(after[0].LifecycleEntries) != 1 || after[0].ProcessingStatus != "parsed" {
		t.Fatal("draft save changed shared source history/status or leaked private activity")
	}
}

func assertSourceEvidence(t *testing.T, result *appv1.ReadSchedulesResponse) {
	t.Helper()
	m := result.Messages[0]
	if len(m.Events) != 3 || m.Recipients == nil || len(m.Recipients.Values) != 1 || m.ProcessingStatus != "parsed" {
		t.Fatal("missing message fields")
	}
	if m.Events[0].TimeSourceLines.Lines[0] != 3 || m.Events[0].LocationSourceLines.Lines[0] != 3 {
		t.Fatal("missing evidence")
	}
	if !m.Events[0].EndAt.AsTime().After(m.Events[1].StartAt.AsTime()) {
		t.Fatal("overlap missing")
	}
	if result.Messages[1].Recipients == nil || len(result.Messages[1].Recipients.Values) != 0 {
		t.Fatal("known empty recipients lost")
	}
	if result.Messages[2].Recipients != nil || result.Messages[2].Sender != nil {
		t.Fatal("unavailable fields invented")
	}
}

func assertScheduleBoundaries(t *testing.T, result *appv1.ReadSchedulesResponse) {
	t.Helper()
	multi := result.Messages[1].Events[0]
	if multi.EndAt.AsTime().Sub(multi.StartAt.AsTime()) != 54*time.Hour {
		t.Fatal("multi-day duration")
	}
	night := result.Messages[2].Events[0]
	if night.StartAt.AsTime().Day() == night.EndAt.AsTime().Day() {
		t.Fatal("midnight boundary")
	}
	month := result.Messages[2].Events[1]
	if month.StartAt.AsTime().Month() == month.EndAt.AsTime().Month() {
		t.Fatal("month boundary")
	}
}

func assertPartialSchedule(t *testing.T, result *appv1.ReadSchedulesResponse) {
	t.Helper()
	revised := result.Messages[3].Events[0]
	if !revised.IsRevised || result.Messages[3].ProcessingStatus != "updated" || len(revised.Revisions) != 1 {
		t.Fatal("revision missing")
	}
	r := revised.Revisions[0]
	if r.EventId != revised.Id || r.PriorStartAt == nil || r.PriorEndAt != nil || r.ReplacementEndAt == nil || len(r.TimeSourceLines.Lines) != 2 {
		t.Fatal("partial revision lost")
	}
	missing := result.Messages[4].Events[0]
	if missing.StartAt != nil || missing.EndAt != nil || missing.Location != nil || missing.ScheduleStatus != "needs_review" || missing.TimeSourceLines == nil {
		t.Fatal("missing schedule fabricated")
	}
	if result.Messages[4].ReceivedAt != nil {
		t.Fatal("received time fabricated")
	}
}

func TestSourceDataEmptyAndUTC(t *testing.T) {
	db := sourceTestDB(t, "file:"+filepath.Join(t.TempDir(), "empty.db")+"?_pragma=foreign_keys(1)")
	client := sourceTestRPC(t, db)
	empty, err := client.ReadSchedules(context.Background(), connect.NewRequest(&appv1.ReadSchedulesRequest{}))
	if err != nil || len(empty.Msg.Messages) != 0 {
		t.Fatalf("empty read: %v %v", empty, err)
	}
	instant, err := time.Parse(time.RFC3339, "2026-11-04T10:00:00+02:00")
	if err != nil {
		t.Fatal(err)
	}
	got := sourceTimestamp(&instant).AsTime()
	if got.Format(time.RFC3339) != "2026-11-04T08:00:00Z" {
		t.Fatal(got)
	}
	if sourceTimestamp(nil) != nil || sourceLines(nil) != nil {
		t.Fatal("absence lost")
	}
}
