package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

// EventRevision preserves partial prior schedules without inventing components.
type EventRevision struct{ ent.Schema }

// Fields retains independently nullable prior and replacement UTC instants.
func (EventRevision) Fields() []ent.Field {
	return []ent.Field{
		field.Int("sequence").Positive().Immutable(),
		field.Time("revised_at").Optional().Nillable(),
		field.Time("prior_start_at").Optional().Nillable(),
		field.Time("prior_end_at").Optional().Nillable(),
		field.Time("replacement_start_at").Optional().Nillable(),
		field.Time("replacement_end_at").Optional().Nillable(),
		field.String("source_message_id").Optional().Nillable().Comment("Available upstream reference for the revision, not a fabricated message relationship."),
		field.Text("description").Optional().Nillable(),
		field.JSON("time_source_lines", []int{}).Optional(),
	}
}

// Edges requires the event whose schedule was revised.
func (EventRevision) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("event", ExtractedEvent.Type).Ref("revisions").Unique().Required().Immutable(),
	}
}
