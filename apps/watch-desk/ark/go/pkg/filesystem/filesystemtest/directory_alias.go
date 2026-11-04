// Package filesystemtest supplies real filesystem aliases for boundary tests.
package filesystemtest

import (
	"os"
	"path/filepath"
	"testing"
)

// DirectoryAlias exposes two verified names for the same existing directory.
// Physical has resolved ancestors; Aliased traverses a directory symlink.
type DirectoryAlias struct {
	Physical string
	Aliased  string
}

// NewDirectoryAlias creates a directory alias independently of TMPDIR spelling.
// The caller owns the files inside it; testing removes both names on cleanup.
func NewDirectoryAlias(t testing.TB) DirectoryAlias {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatalf("resolve alias fixture root: %v", err)
	}
	paths := DirectoryAlias{Physical: filepath.Join(root, "physical"), Aliased: filepath.Join(root, "alias")}
	if err := os.Mkdir(paths.Physical, 0700); err != nil {
		t.Fatalf("create alias fixture directory: %v", err)
	}
	if err := os.Symlink(paths.Physical, paths.Aliased); err != nil {
		t.Fatalf("create directory alias: %v", err)
	}
	RequireSameDirectory(t, paths.Aliased, paths.Physical)
	return paths
}

// RequireSameDirectory checks existing directory identity, preserving lookup errors.
// It does not establish containment, forbid symlinks, or compare future paths.
func RequireSameDirectory(t testing.TB, actual, expected string) {
	t.Helper()
	actualInfo, err := os.Stat(actual)
	if err != nil {
		t.Fatalf("stat actual directory %q: %v", actual, err)
	}
	expectedInfo, err := os.Stat(expected)
	if err != nil {
		t.Fatalf("stat expected directory %q: %v", expected, err)
	}
	if !actualInfo.IsDir() || !expectedInfo.IsDir() || !os.SameFile(actualInfo, expectedInfo) {
		t.Fatalf("directory identity differs: actual %q, expected %q", actual, expected)
	}
}
