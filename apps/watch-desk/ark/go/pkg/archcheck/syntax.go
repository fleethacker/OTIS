package archcheck

import (
	"go/ast"
	"go/token"
	"regexp"
	"strings"
)

var stubTypeName = regexp.MustCompile(`(?i)(offline|stub|fake|mock|dummy)`)

// stubViolations returns the 1-based line numbers of composite literals whose
// type name matches stubTypeName, skipping any line carrying `// arkstub:allow`.
// Decoupled from the filesystem so it can be unit-tested on synthetic source.
func stubViolations(fset *token.FileSet, file *ast.File) []int {
	allowed := map[int]bool{}
	for _, cg := range file.Comments {
		for _, c := range cg.List {
			if strings.Contains(c.Text, "arkstub:allow") {
				allowed[fset.Position(c.Pos()).Line] = true
			}
		}
	}

	var lines []int
	ast.Inspect(file, func(n ast.Node) bool {
		lit, ok := n.(*ast.CompositeLit)
		if !ok || lit.Type == nil {
			return true
		}
		name := typeName(lit.Type)
		if name == "" || !stubTypeName.MatchString(name) {
			return true
		}
		line := fset.Position(lit.Pos()).Line
		if !allowed[line] {
			lines = append(lines, line)
		}

		return true
	})

	return lines
}

// typeName returns the final identifier of a composite-literal type expression:
// `Foo`, `pkg.Foo`, and their generic instances resolve to "Foo";
// slices/maps/other resolve to "" (not the wiring of a named stub value).
func typeName(expr ast.Expr) string {
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.SelectorExpr:
		return t.Sel.Name
	case *ast.IndexExpr:
		return typeName(t.X)
	case *ast.IndexListExpr:
		return typeName(t.X)
	default:
		return ""
	}
}
