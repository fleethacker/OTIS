package enterrors

import (
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	"connectrpc.com/connect"

	"github.com/defenseunicorns/generated-app/ent"
)

// Discard logs so the server-side cause logging doesn't spam test output (and
// so the test asserts only what crosses the wire, not what's logged).
func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	os.Exit(m.Run())
}

func TestMap_NilReturnsNil(t *testing.T) {
	if got := Map(nil); got != nil {
		t.Fatalf("Map(nil) = %v, want nil", got)
	}
}

// Map must return a fixed, generic message per code and NEVER echo the raw
// ENT/driver text onto the wire (table/column names, SQL fragments, etc.).
func TestMap_MessagesAreGenericAndClientSafe(t *testing.T) {
	// The kind of schema-disclosing string SQLite/ENT produces — must not leak.
	const secret = "UNIQUE constraint failed: key_areas.name"

	cases := []struct {
		name     string
		in       error
		wantCode connect.Code
		wantMsg  string
	}{
		{"not_found", &ent.NotFoundError{}, connect.CodeNotFound, "not found"},
		{"constraint", &ent.ConstraintError{}, connect.CodeAlreadyExists, "already exists"},
		{"not_singular", &ent.NotSingularError{}, connect.CodeInternal, "internal error"},
		// Any non-ENT error (incl. a raw driver string) → generic internal.
		{"raw_with_secret", errors.New(secret), connect.CodeInternal, "internal error"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var ce *connect.Error
			if !errors.As(Map(tc.in), &ce) {
				t.Fatalf("Map did not return a *connect.Error")
			}
			if ce.Code() != tc.wantCode {
				t.Errorf("code = %v, want %v", ce.Code(), tc.wantCode)
			}
			if ce.Message() != tc.wantMsg {
				t.Errorf("message = %q, want generic %q", ce.Message(), tc.wantMsg)
			}
			// Nothing driver-shaped may appear in what reaches the client.
			full := ce.Error()
			for _, leak := range []string{"ent:", "constraint", "key_areas", "UNIQUE", secret} {
				if strings.Contains(full, leak) {
					t.Errorf("wire error leaks %q: %q", leak, full)
				}
			}
		})
	}
}

// Handlers may pre-wrap with a specific, non-sensitive message; Map passes those
// through unchanged rather than overriding them with a generic one.
func TestMap_PreWrappedConnectErrorPassesThrough(t *testing.T) {
	in := connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	var ce *connect.Error
	if !errors.As(Map(in), &ce) {
		t.Fatalf("Map did not return a *connect.Error")
	}
	if ce.Code() != connect.CodeInvalidArgument || ce.Message() != "name is required" {
		t.Errorf("pre-wrapped error not preserved: code=%v msg=%q", ce.Code(), ce.Message())
	}
}
