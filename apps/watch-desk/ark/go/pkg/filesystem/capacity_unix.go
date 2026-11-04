//go:build linux || darwin

package filesystem

import (
	"fmt"
	"path/filepath"

	"golang.org/x/sys/unix"
)

// ReadCapacity measures the containing filesystem without walking its contents.
func ReadCapacity(path string) (Capacity, error) {
	if !filepath.IsAbs(path) {
		return Capacity{}, fmt.Errorf("absolute filesystem path required")
	}
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return Capacity{}, fmt.Errorf("measure filesystem capacity: %w", err)
	}
	if stat.Bsize <= 0 {
		return Capacity{}, fmt.Errorf("filesystem reported invalid block size")
	}
	return capacityFromBlocks(uint64(stat.Bsize), stat.Blocks, stat.Bfree, stat.Bavail, stat.Files, stat.Ffree)
}
