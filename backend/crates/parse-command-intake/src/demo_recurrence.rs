//! Exact-fixture-only companion fact; not a general GENTEXT/OPTASK recurrence parser.
use crate::demo::Catalog;
use parse_command_optask::OptaskParser;
use parse_command_parser_api::*;
use parse_command_types::{Recurrence, RecurrenceStatus, UtcTimestamp};
use serde_json::json;
use std::sync::LazyLock;

pub struct DemoOptaskParser;
impl MessageParser for DemoOptaskParser {
    fn descriptor(&self) -> &'static ParserDescriptor {
        static DESCRIPTOR: LazyLock<ParserDescriptor> = LazyLock::new(|| {
            let original = OptaskParser.descriptor();
            ParserDescriptor { id: "optask-watchdesk-demo", version: "0.3.0-demo", icd_major: original.icd_major,
                message_types: original.message_types, profiles: original.profiles, fact_categories: original.fact_categories }
        });
        &DESCRIPTOR
    }
    fn assess(&self, input: &MessageView<'_>) -> MatchOutcome { OptaskParser.assess(input) }
    fn parse(&self, input: &MessageView<'_>, context: &ParseContext<'_>, output: &mut dyn ParseSink) -> Result<ParseSummary, ParseFailure> {
        let summary = OptaskParser.parse(input, context, output)?;
        let catalog = Catalog::load().map_err(|_| failure())?;
        let Some(fixture) = catalog.assignment(input.source).filter(|f| f.recurrence.as_deref() == Some("daily_radio_check")) else { return Ok(summary); };
        context.budget.checkpoint(1)?;
        let period = input.records.iter().find(|r| r.set_id == "PERIOD" && r.fields.len() == 2
            && r.fields[0].normalized() == "050000ZNOV2026" && r.fields[1].normalized() == "082359ZNOV2026").ok_or_else(failure)?;
        let record = input.records.iter().find(|r| r.set_id == "GENTEXT" && r.fields.len() == 2
            && r.fields[0].normalized() == "FICTIONAL RECURRENCE"
            && r.fields[1].normalized().starts_with("FICTIONAL DAILY RADIO CHECK 0800Z AND 2000Z, 05-08 NOV 2026.")).ok_or_else(failure)?;
        // These constants are the explicit, checked source tokens above, not an issue/receipt date.
        let fact = Recurrence { id: "r1".into(), kind: "communications_check".into(), activity_id: None,
            rule: "FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0".into(), dtstart: Some(UtcTimestamp::new("2026-11-05T00:00:00Z")?),
            until: Some(UtcTimestamp::new("2026-11-08T23:59:00Z")?), count: None, exdates: Vec::new(),
            scope: Some("FICTIONAL DEMO ONLY".into()), status: RecurrenceStatus::Inferred };
        output.audit(AuditEntry { kind: "fact_interpreted".into(), subject_id: Some(fact.id.clone()),
            payload: json!({"rule_id":"watchdesk.synthetic.recurrence.v1","rule_revision":"1","inferred":true,
                "profile":summary.profile,"config":crate::demo::CONFIG_SOURCE,"version":catalog.version,"fixture":fixture.file,
                "source_reference":"Exact allowlisted fictional radio-check paragraph and explicit PERIOD",
                "record_sequence":record.sequence,"set_id":record.set_id,
                "span":{"start_byte":record.span.start,"end_byte":record.span.end,"representation":"decoded_utf8_body"},
                "period_record_sequence":period.sequence,
                "period_span":{"start_byte":period.span.start,"end_byte":period.span.end,"representation":"decoded_utf8_body"},
                "anchor_basis":"explicit_source_period","synthetic_fixture_only":true}).as_object().cloned().ok_or_else(failure)? })?;
        output.recurrence(fact)?;
        Ok(summary)
    }
}
fn failure() -> ParseFailure { ParseFailure::new(ErrorKind::InvalidValue, "synthetic_recurrence_evidence") }
