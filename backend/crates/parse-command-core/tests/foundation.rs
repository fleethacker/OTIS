//! Constructed contract cases, not the external USMTF sample corpus.
use parse_command_core::*;
use parse_command_parser_api::*;
use parse_command_reference_parser::ReferenceParser;
use parse_command_types::*;
use serde_json::json;
use std::{collections::BTreeSet, sync::atomic::AtomicBool};

fn limits() -> HostLimits {
    HostLimits {
        scan: ScanLimits {
            max_source_bytes: 8192,
            max_records: 32,
            max_set_bytes: 4096,
            max_fields_per_record: 64,
            max_total_fields: 256,
        },
        output: OutputLimits {
            max_core_items: 32,
            max_core_bytes: 8192,
            max_audit_entries: 32,
            max_audit_bytes: 65536,
            max_audit_depth: 16,
            max_audit_nodes: 4096,
        },
        max_subject_bytes: 512,
    }
}
fn host() -> ParserHost {
    ParserHost::new(
        Registry::new(
            vec![Box::new(ReferenceParser)],
            BTreeSet::from(["REFERENCE".into()]),
        )
        .unwrap(),
        limits(),
    )
    .unwrap()
}
fn run(input: DecodedMessage<'_>) -> Result<ParsedMessage, ParseFailure> {
    run_with_host(&host(), input)
}
fn run_with_host(
    host: &ParserHost,
    input: DecodedMessage<'_>,
) -> Result<ParsedMessage, ParseFailure> {
    let cancelled = AtomicBool::new(false);
    let budget = WorkBudget::new(100_000, &cancelled);
    let at = UtcTimestamp::new("2026-01-01T00:00:00Z").unwrap();
    host.parse(
        input,
        &ParseContext {
            revision: "test-1",
            recorded_at: &at,
            command_ids: &[],
            security_override: None,
            reference_time: None,
            budget: &budget,
        },
    )
}
fn input() -> DecodedMessage<'static> {
    DecodedMessage {
        body: "MSGID/REFERENCE//\nTASK/Complete a synthetic check//\n",
        subject: Some("SUBJ: Test: SUBJ: stays inside"),
    }
}

#[test]
fn independent_crate_runs_without_transport_or_storage() {
    let parsed = run(input()).unwrap();
    let core = parsed.core.get();
    assert_eq!(core.kind, "REFERENCE");
    assert_eq!(core.subject.as_deref(), Some("Test: SUBJ: stays inside"));
    assert_eq!(
        core.activities[0].description.as_deref(),
        Some("Complete a synthetic check")
    );
    assert!(core.issued_at.is_none() && core.expires_at.is_none());
    assert_eq!(core.security.status, SecurityStatus::Unvalidated);
    assert_eq!(core.id, message_id(input().body));
    assert_eq!(parsed.audit.len(), 4);
    let core_json = serde_json::to_value(&parsed.core).unwrap();
    for key in [
        "records",
        "evidence",
        "payload",
        "field_positions",
        "raw_text",
    ] {
        assert!(core_json.get(key).is_none());
    }
    let fact = parsed
        .audit
        .iter()
        .find(|e| e.get().subject_id.as_deref() == Some("a1"))
        .unwrap()
        .get();
    let span = &fact.payload["span"];
    assert_eq!(
        &input().body[span["start_byte"].as_u64().unwrap() as usize
            ..span["end_byte"].as_u64().unwrap() as usize],
        "Complete a synthetic check"
    );
}
#[test]
fn repeated_run_has_stable_ids_and_bytes() {
    let a = run(input()).unwrap();
    let b = run(input()).unwrap();
    assert_eq!(
        serde_json::to_vec(&a.core).unwrap(),
        serde_json::to_vec(&b.core).unwrap()
    );
    assert_eq!(
        serde_json::to_vec(&a.audit).unwrap(),
        serde_json::to_vec(&b.audit).unwrap()
    );
}
#[test]
fn parser_failure_does_not_return_partial_projection() {
    let e = run(DecodedMessage {
        body: "MSGID/REFERENCE//\nTASK//",
        subject: None,
    })
    .err()
    .unwrap();
    assert_eq!(e.kind, ErrorKind::MalformedInput);
}
#[test]
fn enabled_types_are_explicit() {
    let registry = Registry::new(vec![Box::new(ReferenceParser)], BTreeSet::new()).unwrap();
    let scanned = scan(input().body, limits().scan).unwrap();
    assert_eq!(
        registry.select(&scanned.view(None)).err().unwrap().code,
        "type_not_enabled"
    );
    assert!(Registry::new(vec![], BTreeSet::from(["REFERENCE".into()])).is_err());
}
#[test]
fn registry_rejects_duplicate_id() {
    assert_eq!(
        Registry::new(
            vec![Box::new(ReferenceParser), Box::new(ReferenceParser)],
            BTreeSet::new()
        )
        .err()
        .unwrap()
        .kind,
        ErrorKind::RegistryConflict
    );
}
struct Alternative;
static ALT: ParserDescriptor = ParserDescriptor {
    id: "alternative",
    version: "0.1.0",
    icd_major: 1,
    message_types: &["REFERENCE"],
    profiles: &["alternative-v1"],
    fact_categories: &[],
};
impl MessageParser for Alternative {
    fn descriptor(&self) -> &'static ParserDescriptor {
        &ALT
    }
    fn assess(&self, _: &MessageView<'_>) -> MatchOutcome {
        MatchOutcome::Applicable {
            profile: "alternative-v1",
            rule: "synthetic.alternative",
        }
    }
    fn parse(
        &self,
        _: &MessageView<'_>,
        _: &ParseContext<'_>,
        _: &mut dyn ParseSink,
    ) -> Result<ParseSummary, ParseFailure> {
        panic!("must not dispatch ambiguity")
    }
}
#[test]
fn runtime_ambiguity_is_independent_of_registration_order() {
    let scanned = scan(input().body, limits().scan).unwrap();
    for parsers in [
        vec![
            Box::new(ReferenceParser) as Box<dyn MessageParser>,
            Box::new(Alternative),
        ],
        vec![
            Box::new(Alternative) as Box<dyn MessageParser>,
            Box::new(ReferenceParser),
        ],
    ] {
        let registry = Registry::new(parsers, BTreeSet::from(["REFERENCE".into()])).unwrap();
        assert_eq!(
            registry.select(&scanned.view(None)).err().unwrap().kind,
            ErrorKind::AmbiguousProfile
        );
    }
}
#[test]
fn exact_type_does_not_match_supplement_or_prefix() {
    let scanned = scan("MSGID/REFERENCE SUPPLEMENT//", limits().scan).unwrap();
    assert_eq!(
        host()
            .registry()
            .select(&scanned.view(None))
            .err()
            .unwrap()
            .kind,
        ErrorKind::UnsupportedProfile
    );
}

struct UncoveredFact;
impl MessageParser for UncoveredFact {
    fn descriptor(&self) -> &'static ParserDescriptor {
        ReferenceParser.descriptor()
    }
    fn assess(&self, input: &MessageView<'_>) -> MatchOutcome {
        ReferenceParser.assess(input)
    }
    fn parse(
        &self,
        input: &MessageView<'_>,
        _: &ParseContext<'_>,
        output: &mut dyn ParseSink,
    ) -> Result<ParseSummary, ParseFailure> {
        output.header(HeaderInterpretation {
            message_type: input.message_type.into(),
            originator: "REFERENCE UNIT".into(),
            serial: None,
            issued_at: None,
            security: Security {
                policy: "REFERENCE".into(),
                classification: None,
                release_to: vec![],
                status: SecurityStatus::Unvalidated,
            },
        })?;
        output.activity(serde_json::from_value(json!({"id":"a1","type":"tasking","status":"inferred","task_type":"test","description":"test"})).unwrap())?;
        Ok(ParseSummary {
            profile: "reference-v1",
            completeness: Completeness::Partial,
        })
    }
}
#[test]
fn host_requires_fact_evidence_before_returning_either_stream() {
    let host = ParserHost::new(
        Registry::new(
            vec![Box::new(UncoveredFact)],
            BTreeSet::from(["REFERENCE".into()]),
        )
        .unwrap(),
        limits(),
    )
    .unwrap();
    assert_eq!(
        run_with_host(&host, input()).err().unwrap().code,
        "missing_fact_audit"
    );
}
#[test]
fn final_envelopes_and_host_generated_audit_are_bounded() {
    for (audit_bytes, audit_entries) in [(1, 32), (65536, 1)] {
        let mut limits = limits();
        limits.output.max_audit_bytes = audit_bytes;
        limits.output.max_audit_entries = audit_entries;
        let host = ParserHost::new(
            Registry::new(
                vec![Box::new(ReferenceParser)],
                BTreeSet::from(["REFERENCE".into()]),
            )
            .unwrap(),
            limits,
        )
        .unwrap();
        assert_eq!(
            run_with_host(&host, input()).err().unwrap().kind,
            ErrorKind::ResourceLimit
        );
    }
    let successful = run(input()).unwrap();
    let entries_size: usize = successful
        .audit
        .iter()
        .map(|event| serde_json::to_vec(event).unwrap().len())
        .sum();
    // The final vector's JSON delimiters also count, even when its individual entries fit.
    let mut limits = limits();
    limits.output.max_audit_bytes = entries_size;
    let host = ParserHost::new(
        Registry::new(
            vec![Box::new(ReferenceParser)],
            BTreeSet::from(["REFERENCE".into()]),
        )
        .unwrap(),
        limits,
    )
    .unwrap();
    assert_eq!(
        run_with_host(&host, input()).err().unwrap().code,
        "serialized_bytes"
    );
}
#[test]
fn cancellation_and_work_exhaustion_are_explicit() {
    for (cancelled, units, kind) in [
        (true, 100_000, ErrorKind::Cancelled),
        (false, 0, ErrorKind::ResourceLimit),
    ] {
        let flag = AtomicBool::new(cancelled);
        let budget = WorkBudget::new(units, &flag);
        let at = UtcTimestamp::new("2026-01-01T00:00:00Z").unwrap();
        let context = ParseContext {
            revision: "test",
            recorded_at: &at,
            command_ids: &[],
            security_override: None,
            reference_time: None,
            budget: &budget,
        };
        assert_eq!(host().parse(input(), &context).err().unwrap().kind, kind);
    }
}
#[test]
fn too_long_subject_is_rejected_before_parser() {
    let subject = "X".repeat(limits().max_subject_bytes + 1);
    assert_eq!(
        run(DecodedMessage {
            body: input().body,
            subject: Some(&subject)
        })
        .err()
        .unwrap()
        .code,
        "subject_bytes"
    );
}
#[test]
fn output_limits_are_sticky_even_when_contributor_ignores_error() {
    let mut l = limits().output;
    l.max_core_bytes = 1;
    let mut output = BoundedOutput::new(l).unwrap();
    assert!(output.activity(serde_json::from_value(json!({"id":"a1","type":"tasking","status":"inferred","task_type":"test","description":"large"})).unwrap()).is_err());
    assert!(output.review_flag("review").is_err());
    assert_eq!(
        output.finish().err().unwrap().kind,
        ErrorKind::ResourceLimit
    );
}
#[test]
fn duplicate_fact_ids_and_deep_audit_fail_closed() {
    let mut output = BoundedOutput::new(limits().output).unwrap();
    let activity:Activity=serde_json::from_value(json!({"id":"a1","type":"tasking","status":"inferred","task_type":"test","description":"test"})).unwrap();
    output.activity(activity.clone()).unwrap();
    assert!(output.activity(activity).is_err());
    assert!(output.finish().is_err());
    let mut l = limits().output;
    l.max_audit_depth = 2;
    let mut output = BoundedOutput::new(l).unwrap();
    let payload = serde_json::from_value(json!({"one":{"two":{"three":1}}})).unwrap();
    assert!(
        output
            .audit(AuditEntry {
                kind: "test".into(),
                subject_id: None,
                payload
            })
            .is_err()
    );
    assert_eq!(
        output.finish().err().unwrap().kind,
        ErrorKind::ResourceLimit
    );
}

#[test]
fn identifiers_and_nullable_field_presence_follow_icd() {
    let core = serde_json::to_value(run(input()).unwrap().core).unwrap();
    let mut missing = core.clone();
    missing.as_object_mut().unwrap().remove("subject");
    assert!(serde_json::from_value::<Message>(missing).is_err());
    let mut leak = core.clone();
    leak["evidence"] = json!({});
    assert!(serde_json::from_value::<Message>(leak).is_err());
    let mut bad = core;
    bad["revision"] = json!(" ");
    assert!(decode_document::<Message>(&serde_json::to_vec(&bad).unwrap(), 8192).is_err());
    assert!(UtcTimestamp::new("2026-01-01T00:00:00+00:00").is_err());
    assert!(UtcTimestamp::new("2026-02-30T00:00:00Z").is_err());
    assert_eq!(
        UtcTimestamp::new("2024-02-29T12:00:00Z")
            .unwrap()
            .add_days(365)
            .unwrap()
            .as_str(),
        "2025-02-28T12:00:00Z"
    );
}
#[test]
fn optional_nonnullable_fields_reject_json_null() {
    assert!(
        serde_json::from_value::<Activity>(
            json!({"id":"a1","type":"test","status":"inferred","scope":null})
        )
        .is_err()
    );
    let frequency: Frequency = serde_json::from_value(json!({"id":"f1","hz":null})).unwrap();
    assert!(frequency.validate().is_err());
    let frequency: Frequency =
        serde_json::from_value(json!({"id":"f1","hz":20,"upper_hz":10})).unwrap();
    assert!(frequency.validate().is_err());
}

#[test]
#[ignore = "requires the external corpus; never committed into the repository"]
fn external_fixture_conformance() {
    let path = std::env::var_os("PARSE_COMMAND_SAMPLES")
        .expect("set PARSE_COMMAND_SAMPLES to external parsed directory");
    let root = std::path::PathBuf::from(path);
    for file in ["messages.ndjson", "passages.ndjson", "audit/events.ndjson"] {
        let data = std::fs::read_to_string(root.join(file)).unwrap();
        for line in data.lines() {
            match file {
                "messages.ndjson" => {
                    let value: Message = decode_document(line.as_bytes(), 1_048_576).unwrap();
                    let round: serde_json::Value = serde_json::to_value(value).unwrap();
                    assert_eq!(
                        round,
                        serde_json::from_str::<serde_json::Value>(line).unwrap()
                    );
                }
                "passages.ndjson" => {
                    let value: Passage = decode_document(line.as_bytes(), 1_048_576).unwrap();
                    assert_eq!(
                        serde_json::to_value(value).unwrap(),
                        serde_json::from_str::<serde_json::Value>(line).unwrap()
                    );
                }
                _ => {
                    let value: AuditEvent = decode_document(line.as_bytes(), 1_048_576).unwrap();
                    assert_eq!(
                        serde_json::to_value(value).unwrap(),
                        serde_json::from_str::<serde_json::Value>(line).unwrap()
                    );
                }
            }
        }
    }
    let events = std::fs::read_to_string(root.join("audit/events.ndjson")).unwrap();
    let mut count = 0;
    for line in events.lines() {
        let e: AuditEvent = serde_json::from_str(line).unwrap();
        if e.kind == "source_preserved" {
            let body = e.payload["source"]["raw_text"].as_str().unwrap();
            let scanned = scan(
                body,
                ScanLimits {
                    max_source_bytes: 1_048_576,
                    max_records: 4096,
                    max_set_bytes: 1_048_576,
                    max_fields_per_record: 8192,
                    max_total_fields: 65536,
                },
            )
            .unwrap();
            let message = std::fs::read_to_string(root.join("messages.ndjson")).unwrap();
            let parent = message
                .lines()
                .map(|l| serde_json::from_str::<Message>(l).unwrap())
                .find(|m| m.id == e.message_id)
                .unwrap();
            assert_eq!(scanned.message_type(), parent.kind);
            assert_eq!(message_id(body), parent.id);
            count += 1;
        }
    }
    assert_eq!(count, 14);
}
