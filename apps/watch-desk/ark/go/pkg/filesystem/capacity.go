// Package filesystem exposes bounded filesystem capacity measurements.
package filesystem

import (
	"fmt"
	"math"
)

// Capacity describes the filesystem containing a path, not directory sizes.
type Capacity struct {
	TotalBytes     uint64 `json:"total_bytes"`
	UsedBytes      uint64 `json:"used_bytes"`
	FreeBytes      uint64 `json:"free_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
	TotalFiles     uint64 `json:"total_files"`
	FreeFiles      uint64 `json:"free_files"`
}

func capacityFromBlocks(size, blocks, free, available, files, freeFiles uint64) (Capacity, error) {
	if size == 0 || blocks == 0 || blocks > math.MaxUint64/size || free > blocks || available > free || freeFiles > files {
		return Capacity{}, fmt.Errorf("filesystem reported invalid capacity")
	}
	return Capacity{TotalBytes: blocks * size, UsedBytes: (blocks - free) * size, FreeBytes: free * size, AvailableBytes: available * size, TotalFiles: files, FreeFiles: freeFiles}, nil
}
