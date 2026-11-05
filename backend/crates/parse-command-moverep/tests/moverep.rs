use parse_command_core::*;
use parse_command_moverep::{BASELINE, EXAMPLES, MoverepParser};
use parse_command_parser_api::*;
use parse_command_types::*;
use std::{collections::BTreeSet, sync::atomic::AtomicBool};

fn run(body: &str, security: Option<&Security>) -> Result<ParsedMessage, ParseFailure> {
    let registry = Registry::new(
        vec![Box::new(MoverepParser)],
        BTreeSet::from(["MOVEREP".to_owned()]),
    )
    .unwrap();
    let host = ParserHost::new(
        registry,
        HostLimits {
            scan: ScanLimits {
                max_source_bytes: 1048576,
                max_records: 1024,
                max_set_bytes: 262144,
                max_fields_per_record: 1024,
                max_total_fields: 8192,
            },
            output: OutputLimits {
                max_core_items: 1024,
                max_core_bytes: 1048576,
                max_audit_entries: 2048,
                max_audit_bytes: 4194304,
                max_audit_depth: 32,
                max_audit_nodes: 65536,
            },
            max_subject_bytes: 1024,
        },
    )
    .unwrap();
    let cancelled = AtomicBool::new(false);
    let budget = WorkBudget::new(1000000, &cancelled);
    let recorded_at = UtcTimestamp::new("2026-11-05T00:00:00Z").unwrap();
    host.parse(
        DecodedMessage {
            body,
            subject: None,
        },
        &ParseContext {
            revision: "movement-test-1",
            recorded_at: &recorded_at,
            command_ids: &[],
            security_override: security,
            reference_time: None,
            budget: &budget,
        },
    )
}
fn header() -> &'static str {
    "MSGID/MOVEREP/MIL-STD-6040(SERIES)/B.1.01.12/CTF42/013/20090714T132530Z/-/-/USA/UNCLASSIFIED//\n"
}
fn movement(action: &str) -> String {
    format!(
        "{}REF/A/OPGEN/-/CTF40/061230ZJAN1991//\nMARACT/{action}/ANCHOR/230925ZJUL/NAME:NORFOLK//\nTASKORG/TF40/-/GALATEA/DANAE/DEWEY//\nSAIL/170930Z/PLACE:ESBJERG/190800Z//\n",
        header()
    )
}
#[test]
fn actions_remain_distinct_and_source_linked() {
    for action in ["REQUEST", "INTEND", "ORDER", "APPROVE", "REPORT"] {
        let body = movement(action);
        let parsed = run(&body, None).unwrap();
        let core = parsed.core.get();
        let fact = &core.movements[0];
        assert_eq!(core.kind, "MOVEREP");
        assert_eq!(serde_json::to_value(fact.action).unwrap(), action);
        assert_eq!(
            fact.effective_at.as_ref().unwrap().as_str(),
            "2009-07-23T09:25:00Z"
        );
        assert_eq!(fact.unit_names, ["DANAE", "DEWEY"]);
        assert_eq!(fact.task_org.as_deref(), Some("TF40"));
        assert_eq!(fact.sail_arrival_label.as_deref(), Some("170930Z"));
        assert!(fact.sail_arrival_at.is_none());
        assert_eq!(core.command_ids.len(), 0);
        assert!(
            core.review_flags
                .contains(&"movement_lineage_review".to_owned())
        );
        let audit = parsed
            .audit
            .iter()
            .find(|a| a.get().subject_id.as_deref() == Some("m1"))
            .unwrap();
        assert_eq!(audit.get().payload["profile"], EXAMPLES);
        let span = &audit.get().payload["span"];
        let left = span["start_byte"].as_u64().unwrap() as usize;
        let right = span["end_byte"].as_u64().unwrap() as usize;
        assert!(body[left..right].starts_with("MARACT/"));
    }
}
#[test]
fn source_coordinates_create_bounded_map_points_without_geocoding_names() {
    let body = format!(
        "{}FYPOS/TUD:CTG12.02/3510N07901W/141325Z/270T12KTS/USA//\nROUTE/071435Z/5534N01230E/RH/071441Z/NAME:POINT ALFA//\nAREA/523017N0024810W/523219N0025012W/523423N0025209W//\n",
        movement("INTEND")
    );
    let parsed = run(&body, None).unwrap();
    let locations = &parsed.core.get().locations;
    assert_eq!(locations.len(), 5);
    assert_eq!(locations[0].label, "Reported unit position");
    assert!((locations[0].point.as_ref().unwrap().lat - 35.166_666_666_7).abs() < 1e-8);
    assert!((locations[0].point.as_ref().unwrap().lon + 79.016_666_666_7).abs() < 1e-8);
    assert_eq!(locations[1].label, "Route position 2");
    assert!(
        locations
            .iter()
            .all(|location| location.status == LocationStatus::Inferred)
    );
    assert!(
        parsed
            .audit
            .iter()
            .any(|entry| entry.get().subject_id.as_deref() == Some("g1"))
    );

    let invalid = format!("{}FYPOS/-/9160N07901W//\n", movement("INTEND"));
    let parsed = run(&invalid, None).unwrap();
    assert_eq!(
        parsed.core.get().locations[0].status,
        LocationStatus::Unresolved
    );
    assert!(
        parsed
            .core
            .get()
            .review_flags
            .contains(&"geospatial_review".to_owned())
    );
}
#[test]
fn cancellation_keeps_reference_and_has_no_fabricated_movement() {
    let body = format!(
        "{}REF/A/OPGEN/-/CTF40/061230ZJAN1991//\nCANX/MOVEREP/CTF40/20090714T132530Z/013//\n",
        header()
    );
    let parsed = run(&body, None).unwrap();
    let core = parsed.core.get();
    assert_eq!(core.movements.len(), 1);
    assert_eq!(core.movements[0].kind, MovementKind::Cancellation);
    assert!(core.movements[0].effective_at.is_none());
    assert!(!core.movements[0].references.is_empty());
    assert!(
        run(
            &body.replace("REF/A/OPGEN/-/CTF40/061230ZJAN1991//\n", ""),
            None
        )
        .is_err()
    );
    assert!(
        run(
            &format!(
                "{body}MARACT/REPORT/DEPART/230925ZJUL/NORFOLK//\nTASKORG/TF40/-/-/GALATEA//\n"
            ),
            None
        )
        .is_err()
    );
}
#[test]
fn baseline_requires_security_and_invalid_times_stay_for_review() {
    let baseline = "MSGID/MOVEREP/USS DEMO/001//\nMARACT/REPORT/DEPART/050312Z1MAY/NORFOLK//\nTASKORG/-/-/-/USS DEMO//\n";
    assert_eq!(
        run(baseline, None).err().unwrap().code,
        "baseline_security_context_required"
    );
    let security = Security {
        policy: "TEST".into(),
        classification: Some(SecurityClassification::Unclassified),
        release_to: vec![],
        status: SecurityStatus::Unvalidated,
    };
    let parsed = run(baseline, Some(&security)).unwrap();
    let fact = &parsed.core.get().movements[0];
    assert_eq!(fact.effective_label.as_deref(), Some("050312Z1MAY"));
    assert!(fact.effective_at.is_none());
    assert!(
        parsed
            .core
            .get()
            .review_flags
            .contains(&"movement_time_review".to_owned())
    );
    let audit = parsed
        .audit
        .iter()
        .find(|a| a.get().subject_id.as_deref() == Some("m1"))
        .unwrap();
    assert_eq!(audit.get().payload["profile"], BASELINE);
    assert_eq!(
        run(&movement("REPORT").replace("B.1.01.12", "B.9.99.99"), None)
            .err()
            .unwrap()
            .kind,
        ErrorKind::UnsupportedProfile
    );
    assert_eq!(
        run(
            &movement("REPORT").replace("MSGID/MOVEREP/", "MSGID/GENADMIN/"),
            None
        )
        .err()
        .unwrap()
        .kind,
        ErrorKind::UnsupportedProfile
    );
}

#[test]
#[ignore = "requires the external, untracked MOVEREP example body"]
fn external_authentic_example_preserves_source_and_movement() {
    let path = std::env::var("PARSE_COMMAND_MOVEREP_SAMPLE").expect("external sample path");
    let body = std::fs::read_to_string(path).expect("external sample body");
    let parsed = run(&body, None).unwrap();
    assert_eq!(parsed.core.get().kind, "MOVEREP");
    assert!(!parsed.core.get().movements.is_empty());
    assert_eq!(parsed.core.get().locations.len(), 5);
    assert!(
        parsed
            .audit
            .iter()
            .any(|event| event.get().kind == "source_preserved")
    );
    assert!(
        parsed
            .audit
            .iter()
            .any(|event| event.get().subject_id.as_deref() == Some("m1"))
    );
}
