package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// DraftAcknowledgement is saved editable text, never a transmitted message.
type DraftAcknowledgement struct{ ent.Schema }

// Fields allows text edits but provides no sent state.
func (DraftAcknowledgement) Fields() []ent.Field {
	return []ent.Field{
		field.String("owner_subject").Optional().Immutable().NotEmpty().Comment("Legacy unowned rows remain inaccessible; all new saves require authenticated subject."),
		field.Text("text").Default(""),
		field.Enum("status").Values("unsent").Default("unsent").Immutable(),
		field.Time("saved_at").Comment("Timezone-aware save instant, supplied by the saving feature."),
	}
}

// Indexes keeps a single private draft per owner and source.
func (DraftAcknowledgement) Indexes() []ent.Index {
	return []ent.Index{index.Fields("owner_subject").Edges("message").Unique()}
}

// Edges requires an immutable reference to the acknowledged message.
func (DraftAcknowledgement) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("message", MessageRecord.Type).Ref("drafts").Unique().Required().Immutable(),
	}
}
