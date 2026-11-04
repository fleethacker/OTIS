package archcheck

import (
	"path/filepath"
	"testing"

	arkcheck "github.com/defenseunicorns/ark/framework/go/pkg/archcheck"
)

// The app owns this test adapter; the canonical pipeline runs the owned checker
// independently so removing this adapter does not remove Ark's wiring policy.
func TestNoStubWiredInProduction(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	violations, err := arkcheck.CheckProduction(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) > 0 {
		t.Fatalf("stub/offline/fake implementation wired in production: %+v", violations)
	}
}
