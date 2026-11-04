// Package archcheck validates application wiring under Ark's owned policy.
package archcheck

import (
	"context"
	"fmt"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
)

// Violation identifies a fake/stub constructor wired in production source.
type Violation struct {
	Path string
	Line int
}

var excludedDirectories = map[string]bool{
	"gen": true, "ent": true, "node_modules": true, "ui": true,
	".git": true, ".ark": true, "ark": true,
}

// CheckProduction rejects stub/fake/mock/offline/dummy composite values in app
// Go source. Tests and Ark's owned implementation are outside the app scope.
// An explicit arkstub:allow comment on the same line retains the existing escape.
func CheckProduction(ctx context.Context, root string) ([]Violation, error) {
	if !filepath.IsAbs(root) {
		return nil, fmt.Errorf("architecture check root must be absolute")
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("architecture check requires an application directory: %s", root)
	}
	var violations []Violation
	fset := token.NewFileSet()
	err = filepath.WalkDir(root, func(name string, entry os.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("application wiring check canceled: %w", err)
		}
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if name != root && excludedDirectories[entry.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			return nil
		}
		found, err := checkProductionFile(fset, root, name)
		violations = append(violations, found...)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("check application wiring: %w", err)
	}
	return violations, nil
}

func checkProductionFile(fset *token.FileSet, root, name string) ([]Violation, error) {
	file, err := parser.ParseFile(fset, name, nil, parser.ParseComments)
	if err != nil {
		return nil, fmt.Errorf("parse application source %s: %w", name, err)
	}
	relative, err := filepath.Rel(root, name)
	if err != nil {
		return nil, fmt.Errorf("resolve application source path: %w", err)
	}
	var violations []Violation
	for _, line := range stubViolations(fset, file) {
		violations = append(violations, Violation{Path: relative, Line: line})
	}
	return violations, nil
}
