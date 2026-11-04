//! Synthetic contribution example, never enabled in a production registry automatically.
use parse_command_parser_api::*;
use parse_command_types::*;
use serde_json::json;

pub struct ReferenceParser;
static DESCRIPTOR: ParserDescriptor = ParserDescriptor {
    id: "reference-parser",
    version: "0.1.0",
    icd_major: 1,
    message_types: &["REFERENCE"],
    profiles: &["reference-v1"],
    fact_categories: &[FactCategory::Activity],
};
impl MessageParser for ReferenceParser {
    fn descriptor(&self) -> &'static ParserDescriptor {
        &DESCRIPTOR
    }
    fn assess(&self, input: &MessageView<'_>) -> MatchOutcome {
        if input.message_type == "REFERENCE" {
            MatchOutcome::Applicable {
                profile: "reference-v1",
                rule: "reference.exact_type",
            }
        } else {
            MatchOutcome::Unsupported
        }
    }
    fn parse(
        &self,
        input: &MessageView<'_>,
        context: &ParseContext<'_>,
        output: &mut dyn ParseSink,
    ) -> Result<ParseSummary, ParseFailure> {
        context.budget.checkpoint(1)?;
        output.header(HeaderInterpretation {
            message_type: input.message_type.into(),
            originator: "REFERENCE UNIT".into(),
            serial: None,
            issued_at: None,
            security: Security {
                policy: "REFERENCE".into(),
                classification: None,
                release_to: Vec::new(),
                status: SecurityStatus::Unvalidated,
            },
        })?;
        let Some(record) = input.records.iter().find(|r| r.set_id == "TASK") else {
            return Err(ParseFailure::new(
                ErrorKind::MalformedInput,
                "reference_task_missing",
            ));
        };
        let field = record.fields.first().ok_or(ParseFailure::new(
            ErrorKind::MalformedInput,
            "reference_task_empty",
        ))?;
        let activity:Activity=serde_json::from_value(json!({"id":"a1","type":"tasking","status":"inferred","task_type":"reference","description":field.normalized()}))
            .map_err(|_|ParseFailure::new(ErrorKind::InternalDefect,"reference_output"))?;
        output.activity(activity)?;
        let mut payload = serde_json::Map::new();
        payload.insert("rule".into(), json!("reference.task_field"));
        payload.insert("record_sequence".into(), json!(record.sequence));
        payload.insert("field_position".into(), json!(field.position));
        payload.insert(
            "span".into(),
            json!({"start_byte":field.span.start,"end_byte":field.span.end}),
        );
        output.audit(AuditEntry {
            kind: "fact_interpreted".into(),
            subject_id: Some("a1".into()),
            payload,
        })?;
        Ok(ParseSummary {
            profile: "reference-v1",
            completeness: Completeness::Partial,
        })
    }
}
