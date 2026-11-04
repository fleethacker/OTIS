// Package schema defines the application's persisted ENT data model.
package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
)

// Setting stores application key-value configuration.
type Setting struct {
	ent.Schema
}

// Fields of the Setting.
func (Setting) Fields() []ent.Field {
	return []ent.Field{
		field.String("key").Unique().NotEmpty(),
		field.String("value").Default(""),
	}
}
