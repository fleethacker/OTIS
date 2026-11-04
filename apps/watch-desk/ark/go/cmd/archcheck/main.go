// Command archcheck runs the owned production-wiring guard on an application.
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/defenseunicorns/ark/framework/go/pkg/archcheck"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: archcheck APPLICATION_ROOT")
		os.Exit(2)
	}
	root, err := filepath.Abs(os.Args[1])
	if err == nil {
		var violations []archcheck.Violation
		violations, err = archcheck.CheckProduction(context.Background(), root)
		for _, violation := range violations {
			fmt.Fprintf(os.Stderr, "%s:%d: stub/offline/fake/mock/dummy value wired in production; wire the real implementation or document arkstub:allow\n", violation.Path, violation.Line)
		}
		if len(violations) > 0 {
			os.Exit(1)
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
