package seed

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"strings"
)

// parseJSON handles both keyed {"users": [...]} and flat [{...}] formats.
func parseJSON(data []byte) (map[string][]map[string]any, error) {
	var keyed map[string][]map[string]any
	if err := decodeSeedJSON(data, &keyed); err == nil {
		return keyed, nil
	}

	var flat []map[string]any
	if err := decodeSeedJSON(data, &flat); err != nil {
		return nil, fmt.Errorf("seed data must be a JSON object or array: %w", err)
	}

	return map[string][]map[string]any{"_default": flat}, nil
}

func decodeSeedJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode seed JSON: %w", err)
	}

	// Keep the single-document contract of json.Unmarshal.
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("seed JSON must contain exactly one document")
	}

	return nil
}

// convertSeedRecords converts matched values before any row is inserted, so a
// rejected value cannot leave a table partially seeded and skipped on restart.
func convertSeedRecords(tableName string, cols tableInfo, records []map[string]any) error {
	for _, record := range records {
		matched := make(map[string]bool, len(record))
		for jsonKey, value := range record {
			column, ok := cols[strings.ToLower(jsonKey)]
			if !ok {
				continue
			}
			if matched[column.name] {
				return fmt.Errorf("duplicate seed column %q in table %q", column.name, tableName)
			}
			matched[column.name] = true
			converted, err := seedColumnValue(column, value)
			if err != nil {
				return fmt.Errorf("seed value for %s.%s: %w", tableName, column.name, err)
			}
			record[jsonKey] = converted
		}
	}

	return nil
}

// seedSQLValue binds integral JSON numbers exactly as int64, rejecting overflow.
// Fractional numbers use SQLite REAL's float64 precision.
func seedSQLValue(value any) (any, error) {
	number, ok := value.(json.Number)
	if !ok {
		return value, nil
	}

	if !strings.ContainsAny(number.String(), ".eE") {
		integer, err := number.Int64()
		if err != nil {
			return nil, fmt.Errorf("seed integer outside int64 range: %w", err)
		}

		return integer, nil
	}

	decimal, err := number.Float64()
	if err != nil {
		return nil, fmt.Errorf("seed decimal outside float64 range: %w", err)
	}

	// Avoid expanding extreme exponents that have already underflowed to zero.
	if decimal == 0 {
		mantissa, _, _ := strings.Cut(strings.ToLower(number.String()), "e")
		if strings.ContainsAny(mantissa, "123456789") {
			return nil, fmt.Errorf("seed decimal underflows float64: %s", number)
		}

		return int64(0), nil
	}

	exact, ok := new(big.Rat).SetString(number.String())
	if !ok {
		return nil, fmt.Errorf("invalid seed decimal: %s", number)
	}
	if exact.IsInt() {
		if !exact.Num().IsInt64() {
			return nil, fmt.Errorf("seed integer outside int64 range: %s", number)
		}

		return exact.Num().Int64(), nil
	}

	return decimal, nil
}
