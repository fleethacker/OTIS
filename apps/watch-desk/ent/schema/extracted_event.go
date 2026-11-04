package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

// ExtractedEvent has a stable internal ID even when no upstream event ID exists.
type ExtractedEvent struct{ ent.Schema }

// Fields preserves uncertain schedules and separately typed supporting evidence.
func (ExtractedEvent) Fields() []ent.Field {
	return []ent.Field{
		field.String("source_event_id").Optional().Nillable().Immutable(),
		field.String("title").NotEmpty(),
		field.String("unit").Optional().Nillable(),
		field.String("location").Optional().Nillable(),
		field.Time("start_at").Optional().Nillable().Comment("UTC instant; NULL is unknown, never a sentinel time."),
		field.Time("end_at").Optional().Nillable().Comment("UTC instant; NULL is unknown, never a sentinel time."),
		field.Enum("schedule_status").Values("confirmed", "needs_review").Default("needs_review"),
		field.Bool("is_revised").Default(false),
		field.Text("review_reason").Optional().Nillable(),
		field.JSON("time_source_lines", []int{}).Optional().Comment("One-based raw-message line numbers; NULL means unavailable, [] means no supporting lines."),
		field.JSON("location_source_lines", []int{}).Optional().Comment("One-based raw-message line numbers; NULL means unavailable, [] means no supporting lines."),
	}
}

// Edges requires a stable source message and retains revision history.
func (ExtractedEvent) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("message", MessageRecord.Type).Ref("events").Unique().Required().Immutable(),
		edge.To("revisions", EventRevision.Type),
	}
}
