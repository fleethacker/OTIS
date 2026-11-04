// Package sourcedata defines persisted source evidence values independent of ENT.
package sourcedata

import "time"

// MessageLifecycleEntry is source-owned processing evidence, never private draft activity.
type MessageLifecycleEntry struct {
	ID         string     `json:"id"`
	Milestone  string     `json:"milestone"`
	RecordedAt *time.Time `json:"recorded_at,omitempty"`
	Detail     string     `json:"detail,omitempty"`
	Provenance string     `json:"provenance,omitempty"`
}
