//go:build ignore

// Run from the repository root with go run internal/service/testdata/generate-structured-journey.go.
// This only writes a journey fixture, never operational seed data.
package main

import (
	"encoding/json"
	"os"
	"strings"
)

func main() {
	input, err := os.ReadFile("internal/service/testdata/structured-messages.json")
	if err != nil {
		panic(err)
	}
	var references []struct {
		Name string `json:"name"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(input, &references); err != nil {
		panic(err)
	}
	if len(references) != 14 {
		panic("expected all 14 bound references")
	}
	records := make([]map[string]any, 0, 16)
	for i, reference := range references {
		if !json.Valid([]byte(reference.Text)) {
			panic(reference.Name)
		}
		records = append(records, map[string]any{
			"id": i + 1, "source_message_id": "REFERENCE-" + reference.Name,
			"processing_status": "needs_review", "provenance": "reference",
			"raw_text": "",
			"reference_attribution":   "Turn 24 attachment: " + reference.Name + " (reference JSON; not operational ingestion)",
			"structured_payload_json": reference.Text,
		})
	}
	extension := map[string]any{
		"id": "extension-source-id", "revision": "extension-review", "type": "FUTURE TYPE",
		"originator": "SYNTHETIC EXTENSION", "serial": nil,
		"security": map[string]any{"classification": nil, "future_marking": map[string]any{"policy_note": "not authorization"}},
		"periods":  []any{}, "frequencies": []any{map[string]any{"id": "future-frequency", "hz": 0, "upper_hz": nil, "future_band": "unknown band"}},
		"activities":       []any{map[string]any{"type": "future_activity", "nested_extension": map[string]any{"enabled": false, "count": 0, "items": []any{"first extension item", "last extension item"}}}},
		"contacts":         []any{map[string]any{"name": "Synthetic contact", "channels": []any{map[string]any{"type": "CUSTOM", "value": "javascript:alert('reference-only')"}}}},
		"future_extension": map[string]any{"null_value": nil, "empty_list": []any{}, "unsafe_text": "<img src=x onerror=alert('reference-only')>", "long_token": "extension-" + strings.Repeat("abcdef0123456789", 32)},
	}
	payload, err := json.Marshal(extension)
	if err != nil {
		panic(err)
	}
	records = append(records, map[string]any{"id": 15, "source_message_id": "SYNTHETIC-EXTENSION", "processing_status": "needs_review", "provenance": "reference", "reference_attribution": "Synthetic extension test, not a supplied attachment", "structured_payload_json": string(payload)})
	records = append(records, map[string]any{"id": 16, "source_message_id": "FICTIONAL-LEGACY", "subject": "Legacy structured-card regression", "processing_status": "parsed", "provenance": "fictional", "raw_text": "FICTIONAL / ILLUSTRATIVE ONLY\nLegacy briefing: 05 NOV 2026 0800 UTC; Wardroom", "received_at": "2026-11-04T23:58:00Z"})
	fixture := map[string]any{"message_records": records, "extracted_events": []any{map[string]any{"id": 1, "message_record_events": 16, "title": "Legacy briefing", "location": "Wardroom", "start_at": "2026-11-05T08:00:00Z", "schedule_status": "confirmed", "time_source_lines": "[2]", "location_source_lines": "[2]"}}, "event_revisions": []any{}, "draft_acknowledgements": []any{}}
	for _, record := range records {
		if _, exists := record["raw_text"]; !exists { record["raw_text"] = "" }
	}
	output, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile("ui/tests/journey/fixtures/present-extensible-structured-message-cards.json", append(output, '\n'), 0644); err != nil {
		panic(err)
	}
}
