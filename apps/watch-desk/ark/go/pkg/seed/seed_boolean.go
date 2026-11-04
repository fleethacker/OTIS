package seed

import (
	"fmt"
	"strings"
)

// seedBooleanValue normalizes boolean seeds and rejects incompatible values.
// Other column types retain their usual JSON number conversion.
func seedBooleanValue(column columnInfo, value any) (any, error) {
	switch strings.ToUpper(strings.TrimSpace(column.dataType)) {
	case "BOOLEAN", "BOOL":
	default:
		return seedSQLValue(value)
	}
	token, ok := value.(string)
	if !ok {
		converted, err := seedSQLValue(value)
		if err != nil {
			return nil, err
		}
		switch converted {
		case nil, true, false, int64(0), int64(1):
			return converted, nil
		default:
			return nil, fmt.Errorf("invalid boolean value: %v", value)
		}
	}
	switch strings.ToLower(strings.TrimSpace(token)) {
	case "":
		if column.nullable {
			return nil, nil
		}
		return nil, fmt.Errorf("empty value for required boolean column")
	case "true", "yes", "y", "1":
		return true, nil
	case "false", "no", "n", "0":
		return false, nil
	default:
		return nil, fmt.Errorf("invalid boolean token: %q", token)
	}
}
