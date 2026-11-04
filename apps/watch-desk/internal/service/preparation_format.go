package service

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// This is a bounded 2003-reference composer, not full USMTF/profile certification.
type preparationFields struct {
	Outgoing    string `json:"outgoing"`
	Letter      string `json:"letter"`
	Type        string `json:"type"`
	Originator  string `json:"originator"`
	DTG         string `json:"dtg"`
	Serial      string `json:"serial"`
	Authority   string `json:"authority"`
	Family      string `json:"family"`
	Response    string `json:"response"`
	ContextKind string `json:"contextKind"`
	Context     string `json:"context"`
	Notes       string `json:"notes"`
	Confirmed   bool   `json:"confirmed"`
}

func parsePreparation(raw string, generate bool) (string, string, error) {
	f, err := decodePreparation(raw)
	if err != nil {
		return "", "", err
	}
	if err := validatePreparationBounds(f, generate); err != nil {
		return "", "", err
	}
	canonical, err := json.Marshal(f)
	if err != nil {
		return "", "", fmt.Errorf("encode preparation: %w", err)
	}
	if !generate {
		return string(canonical), "", nil
	}
	text, err := formatPreparation(f)
	return string(canonical), text, err
}

func decodePreparation(raw string) (preparationFields, error) {
	var f preparationFields
	if err := validatePreparationObject(raw); err != nil {
		return f, err
	}
	strict := json.NewDecoder(strings.NewReader(raw))
	strict.DisallowUnknownFields()
	if err := strict.Decode(&f); err != nil {
		return f, fmt.Errorf("fields_json: %w", err)
	}
	return f, nil
}

func validatePreparationObject(raw string) error {
	if len(raw) > 16384 || !utf8.ValidString(raw) {
		return fmt.Errorf("fields_json: must be valid UTF-8 JSON of at most 16384 bytes")
	}
	// Decode an object first so null, arrays, duplicate keys and unknown fields cannot hide input.
	dec := json.NewDecoder(strings.NewReader(raw))
	token, err := dec.Token()
	if err != nil || token != json.Delim('{') {
		return fmt.Errorf("fields_json: expected an object")
	}
	values := map[string]json.RawMessage{}
	for dec.More() {
		token, err = dec.Token()
		if err != nil {
			return fmt.Errorf("fields_json: invalid object")
		}
		key, ok := token.(string)
		if !ok {
			return fmt.Errorf("fields_json: expected field name")
		}
		if _, exists := values[key]; exists {
			return fmt.Errorf("fields_json: duplicate key %s", key)
		}
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil || string(value) == "null" {
			return fmt.Errorf("%s: invalid value", key)
		}
		values[key] = value
	}
	if _, err := dec.Token(); err != nil {
		return fmt.Errorf("fields_json: invalid object")
	}
	if _, err := dec.Token(); err != io.EOF {
		return fmt.Errorf("fields_json: trailing data")
	}
	return nil
}

func validatePreparationBounds(f preparationFields, generate bool) error {
	fields := []struct {
		name, value string
		max         int
		required    bool
	}{
		{"outgoing", f.Outgoing, 30, true}, {"letter", f.Letter, 1, true}, {"type", f.Type, 20, true},
		{"originator", f.Originator, 30, true}, {"dtg", f.DTG, 14, true}, {"serial", f.Serial, 10, false},
		{"authority", f.Authority, 50, true}, {"family", f.Family, 7, true}, {"response", f.Response, 6, true},
		{"contextKind", f.ContextKind, 4, false}, {"context", f.Context, 100, false}, {"notes", f.Notes, 2000, false},
	}
	for _, field := range fields {
		if utf8.RuneCountInString(field.value) > field.max {
			return fmt.Errorf("%s: maximum length is %d", field.name, field.max)
		}
		if strings.ContainsAny(field.value, "/\\") || strings.IndexFunc(field.value, func(r rune) bool {
			return unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || r == '\u2028' || r == '\u2029'
		}) >= 0 {
			return fmt.Errorf("%s: delimiters and control characters are unsupported", field.name)
		}
		if generate && field.required && strings.TrimSpace(field.value) == "" {
			return fmt.Errorf("%s: required for generation", field.name)
		}
	}
	return nil
}

func formatPreparation(f preparationFields) (string, error) {
	if f.Letter < "A" || f.Letter > "Z" {
		return "", fmt.Errorf("letter: use one uppercase reference letter A-Z")
	}
	if len(f.Type) < 2 {
		return "", fmt.Errorf("type: use 2-20 characters")
	}
	if !validPreparationDTG(f.DTG) {
		return "", fmt.Errorf("dtg: use a real Zulu date DDHHMMZMONYYYY with a four-digit year")
	}
	allowed := map[string]string{"ACTAGCY": " ACK WILCO HAVCO CANTCO ", "ICVALID": " NONVAL VALID VALCHG "}
	if allowed[f.Family] == "" || !strings.Contains(allowed[f.Family], " "+f.Response+" ") {
		return "", fmt.Errorf("response: select an exact supported code for family ACTAGCY or ICVALID")
	}
	if !f.Confirmed {
		return "", fmt.Errorf("confirmed: explicit understanding/authority confirmation required")
	}
	if (f.ContextKind == "") != (f.Context == "") || (f.ContextKind != "" && f.ContextKind != "EXER" && f.ContextKind != "OPER") {
		return "", fmt.Errorf("contextKind: select EXER or OPER with one context, or leave both empty")
	}
	var lines []string
	if f.ContextKind != "" {
		lines = append(lines, f.ContextKind+"/"+f.Context+"//")
	}
	lines = append(lines, "MSGID/AKNLDG/"+f.Outgoing+"//")
	ref := "REF/" + f.Letter + "/" + f.Type + "/" + f.Originator + "/" + f.DTG
	if f.Serial != "" {
		ref += "/" + f.Serial
	}
	lines = append(lines, ref+"//", f.Family+"/"+f.Authority+"/"+f.Response+"/"+f.Letter+"//")
	return strings.Join(lines, "\n"), nil
}

func validPreparationDTG(dtg string) bool {
	date, err := time.Parse("021504ZJan2006", dtg)
	return err == nil && date.Year() >= 1 && strings.ToUpper(date.Format("021504ZJan2006")) == dtg
}
