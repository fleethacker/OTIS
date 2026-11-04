package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// AcknowledgementActivity is an append-only private audit event, not transmission evidence.
type AcknowledgementActivity struct{ ent.Schema }

// Fields preserves recorder, recording instant and separately reported occurrence.
func (AcknowledgementActivity) Fields() []ent.Field {
	return []ent.Field{
		field.String("owner_subject").NotEmpty().Immutable(),
		field.Enum("kind").Values("saved", "generated", "acknowledged", "reset").Immutable(),
		field.Text("note").Default("").Immutable(),
		field.Time("recorded_at").Immutable(),
		field.Time("occurred_at").Optional().Nillable().Immutable(),
	}
}

// Edges binds each activity to its immutable source message.
func (AcknowledgementActivity) Edges() []ent.Edge {
	return []ent.Edge{edge.From("message", MessageRecord.Type).Ref("acknowledgement_activities").Unique().Required().Immutable()}
}

// Indexes supports owner/message history reads.
func (AcknowledgementActivity) Indexes() []ent.Index {
	return []ent.Index{index.Fields("owner_subject").Edges("message")}
}
