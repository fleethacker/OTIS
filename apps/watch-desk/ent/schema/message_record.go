package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/defenseunicorns/generated-app/internal/sourcedata"
)

// MessageRecord retains source content separately from extracted schedules.
type MessageRecord struct{ ent.Schema }

// Fields defines source content, processing state, and explicit provenance.
func (MessageRecord) Fields() []ent.Field {
	return []ent.Field{
		field.String("source_message_id").NotEmpty().Unique().Immutable(),
		field.String("subject").Optional().Nillable(),
		field.Text("raw_text"),
		field.Text("structured_payload_json").Optional().Nillable().Validate(sourcedata.ValidateStructuredPayloadJSON).Comment("Lossless JSON object text; NULL means no structured payload."),
		field.Text("reference_attribution").Optional().Nillable().Comment("Attachment attribution, not operational provenance or raw-message evidence."),
		field.String("sender").Optional().Nillable(),
		field.JSON("recipients", []string{}).Optional().Comment("NULL means unavailable; an empty array means known to be empty."),
		field.Time("received_at").Optional().Nillable().Comment("Timezone-aware instant; display and calculate in UTC."),
		field.JSON("lifecycle_entries", []sourcedata.MessageLifecycleEntry{}).Optional().Comment("Optional source-owned history; unique stable IDs per message, optional recorded_at, never inferred from status or drafts."),
		field.Enum("processing_status").Values("unknown", "parsed", "updated", "needs_review").Default("unknown"),
		field.Enum("provenance").Values("upstream", "fictional", "reference").Comment("Required explicit origin; reference attachments and fictional syntax are not operational or validated USMTF."),
	}
}

// Edges links the source to its independently identified events and drafts.
func (MessageRecord) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("events", ExtractedEvent.Type),
		edge.To("drafts", DraftAcknowledgement.Type),
		edge.To("preparations", AcknowledgementPreparation.Type),
		edge.To("acknowledgement_activities", AcknowledgementActivity.Type),
	}
}
