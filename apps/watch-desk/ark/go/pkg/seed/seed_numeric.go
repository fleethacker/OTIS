package seed

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Convert seed values before SQLite affinity can retain values that the
// application's typed scanners reject.
func seedColumnValue(column columnInfo, value any) (any, error) {
	kind := numericColumnKind(column.dataType)
	if kind == "" {
		return seedBooleanValue(column, value)
	}
	token, isString := value.(string)
	token = strings.TrimSpace(token)
	if isString && token == "" {
		if column.nullable {
			return nil, nil
		}
		return nil, fmt.Errorf("empty value for required numeric column")
	}
	if isString && kind == "real" {
		return seedRealString(token)
	}
	if isString {
		value = json.Number(token)
	}
	converted, err := seedSQLValue(value)
	if err != nil {
		return nil, err
	}
	if _, fractional := converted.(float64); kind == "integer" && fractional {
		return nil, fmt.Errorf("non-integral value for integer column: %v", value)
	}
	return converted, nil
}

func numericColumnKind(declaredType string) string {
	columnType := strings.ToUpper(strings.TrimSpace(declaredType))
	// Follow SQLite's affinity precedence, without interpreting date, JSON, or
	// boolean text as numbers merely because those types have NUMERIC affinity.
	switch {
	case strings.Contains(columnType, "INT"):
		return "integer"
	case strings.Contains(columnType, "CHAR"), strings.Contains(columnType, "CLOB"),
		strings.Contains(columnType, "TEXT"), strings.Contains(columnType, "BLOB"):
		return ""
	case strings.Contains(columnType, "REAL"), strings.Contains(columnType, "FLOA"),
		strings.Contains(columnType, "DOUB"): //nolint:misspell // SQLite's REAL affinity marker.
		return "real"
	case strings.HasPrefix(columnType, "NUMERIC"), strings.HasPrefix(columnType, "DECIMAL"), strings.HasPrefix(columnType, "NUMBER"):
		return "numeric"
	default:
		return ""
	}
}

func seedRealString(token string) (any, error) {
	value, err := strconv.ParseFloat(token, 64)
	if err != nil {
		return nil, fmt.Errorf("seed real outside float64 range: %w", err)
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return nil, fmt.Errorf("seed real must be finite: %s", token)
	}
	if value == 0 {
		mantissa, _, _ := strings.Cut(strings.ToLower(token), "e")
		if strings.ContainsAny(mantissa, "123456789") {
			return nil, fmt.Errorf("seed real underflows float64: %s", token)
		}
	}
	return value, nil
}
