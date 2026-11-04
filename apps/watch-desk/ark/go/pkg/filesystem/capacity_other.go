//go:build !linux && !darwin

package filesystem

import "fmt"

// ReadCapacity reports an unsupported source on other platforms.
func ReadCapacity(_ string) (Capacity, error) {
	return Capacity{}, fmt.Errorf("filesystem capacity measurements are unsupported on this platform")
}
