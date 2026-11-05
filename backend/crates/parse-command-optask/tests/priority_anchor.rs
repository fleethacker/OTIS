use parse_command_core::{HostLimits, ParserHost, Registry};
use parse_command_optask::{OptaskParser, SUPPORTED_MESSAGE_TYPES};
use parse_command_parser_api::{
    DecodedMessage, OutputLimits, ParseContext, ScanLimits, WorkBudget,
};
use parse_command_types::UtcTimestamp;
use std::sync::atomic::AtomicBool;

fn parse(body: &str) -> serde_json::Value {
    let host = ParserHost::new(
        Registry::new(
            vec![Box::new(OptaskParser)],
            SUPPORTED_MESSAGE_TYPES
                .iter()
                .map(|s| (*s).into())
                .collect(),
        )
        .unwrap(),
        HostLimits {
            scan: ScanLimits {
                max_source_bytes: 524288,
                max_records: 4096,
                max_set_bytes: 262144,
                max_fields_per_record: 8192,
                max_total_fields: 65536,
            },
            output: OutputLimits {
                max_core_items: 4096,
                max_core_bytes: 1048576,
                max_audit_entries: 8192,
                max_audit_bytes: 8388608,
                max_audit_depth: 32,
                max_audit_nodes: 262144,
            },
            max_subject_bytes: 4096,
        },
    )
    .unwrap();
    let cancelled = AtomicBool::new(false);
    let budget = WorkBudget::new(4_000_000, &cancelled);
    let at = UtcTimestamp::new("2026-11-10T08:00:00Z").unwrap();
    let result = host
        .parse(
            DecodedMessage {
                body,
                subject: Some("SUBJ: Synthetic ANCHOR source"),
            },
            &ParseContext {
                revision: "priority-1-demo-v1",
                recorded_at: &at,
                command_ids: &["demo-meridian".into()],
                security_override: None,
                reference_time: None,
                budget: &budget,
            },
        )
        .unwrap();
    serde_json::to_value(result.core.get()).unwrap()
}

#[test]
fn amendment_parser_keeps_selected_window_and_unrelated_activity() {
    let core = parse(include_str!("../../../config/priority-2/amendment.txt"));
    assert_eq!(core["activities"][0]["id"], "a1");
    assert_eq!(core["activities"][0]["start_at"], "2026-11-10T10:30:00Z");
    assert_eq!(core["activities"][0]["end_at"], "2026-11-10T11:15:00Z");
    assert_eq!(core["activities"][1]["id"], "a2");
    assert_eq!(core["activities"][1]["start_at"], "2026-11-10T14:00:00Z");
}

#[test]
fn cancellation_is_readable_source_without_an_invented_schedule_fact() {
    let core = parse(include_str!("../../../config/priority-2/cancellation.txt"));
    assert_eq!(core["type"], "OPTASK COMMS");
    assert!(core["activities"].as_array().unwrap().is_empty());
    assert_ne!(core["status"], "validated");
}

#[test]
fn conflict_variant_is_distinct_parsed_source_without_implicit_lineage() {
    let core = parse(include_str!(
        "../../../config/priority-2/conflicting-amendment.txt"
    ));
    assert_eq!(core["activities"][0]["start_at"], "2026-11-10T12:00:00Z");
    assert_ne!(
        core["id"],
        parse(include_str!("../../../config/priority-2/amendment.txt"))["id"]
    );
}
