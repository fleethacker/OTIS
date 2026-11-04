// Package ent provides the ENT ORM client for this application.
// Run `ark generate` from the workspace root to regenerate after schema changes.
package ent

//go:generate go run ../ark/codegen/ent/generate.go ../ark/codegen/ent generate --feature sql/upsert ./schema
