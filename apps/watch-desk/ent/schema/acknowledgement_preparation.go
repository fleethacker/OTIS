package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// AcknowledgementPreparation is private unsent structured work, independent of legacy text.
type AcknowledgementPreparation struct{ ent.Schema }

// Fields separates editable inputs, server output and personal tracking.
func (AcknowledgementPreparation) Fields() []ent.Field {
	return []ent.Field{
		field.String("owner_subject").NotEmpty().Immutable(),
		field.Text("fields_json").Default("{}"),
		field.Text("generated_text").Default(""),
		field.Bool("acknowledged").Default(false),
	}
}

// Edges binds preparation to an immutable source message.
func (AcknowledgementPreparation) Edges() []ent.Edge {
	return []ent.Edge{edge.From("message", MessageRecord.Type).Ref("preparations").Unique().Required().Immutable()}
}

// Indexes enforces one preparation per owner/message.
func (AcknowledgementPreparation) Indexes() []ent.Index {
	return []ent.Index{index.Fields("owner_subject").Edges("message").Unique()}
}
