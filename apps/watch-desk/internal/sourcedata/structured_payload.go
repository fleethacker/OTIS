package sourcedata

import (
	"encoding/json"
	"errors"
	"strings"
)

// ValidateStructuredPayloadJSON checks the envelope without decoding or rewriting
// values. Unknown fields, duplicate keys, numeric spelling and whitespace survive.
func ValidateStructuredPayloadJSON(value string) error {
	if !json.Valid([]byte(value)) || !strings.HasPrefix(strings.TrimSpace(value), "{") {
		return errors.New("structured payload must be a JSON object")
	}
	return nil
}
