//! Synthetic contract tests; supplied traffic and expected documents remain external.
use parse_command_casrep::{BASELINE, CasrepParser, EXAMPLES};
use parse_command_core::*;
use parse_command_parser_api::*;
use parse_command_types::*;
use serde_json::json;
use std::{collections::BTreeSet, sync::atomic::AtomicBool};

fn limits() -> HostLimits {
    HostLimits {
        scan: ScanLimits {
            max_source_bytes: 1_048_576,
            max_records: 4096,
            max_set_bytes: 262144,
            max_fields_per_record: 8192,
            max_total_fields: 65536,
        },
        output: OutputLimits {
            max_core_items: 4096,
            max_core_bytes: 1_048_576,
            max_audit_entries: 8192,
            max_audit_bytes: 8_388_608,
            max_audit_depth: 32,
            max_audit_nodes: 262144,
        },
        max_subject_bytes: 4096,
    }
}
fn run(body: &str, override_security: Option<&Security>) -> Result<ParsedMessage, ParseFailure> {
    let registry = Registry::new(
        vec![Box::new(CasrepParser)],
        BTreeSet::from(["CASREP".to_owned()]),
    )
    .unwrap();
    let host = ParserHost::new(registry, limits()).unwrap();
    let cancelled = AtomicBool::new(false);
    let budget = WorkBudget::new(4_000_000, &cancelled);
    let at = UtcTimestamp::new("2026-01-01T00:00:00Z").unwrap();
    host.parse(
        DecodedMessage {
            body,
            subject: Some("SUBJ: Constructed contract case"),
        },
        &ParseContext {
            revision: "casrep-test-1",
            recorded_at: &at,
            command_ids: &[],
            security_override: override_security,
            reference_time: None,
            budget: &budget,
        },
    )
}
fn body(sets: &str) -> String {
    format!(
        "EXER/DEMO//\nMSGID/CASREP/MIL-STD-6040(SERIES)/B.1.01.12/DEMO SHIP/001/20261105T120000Z/-/-/USA/UNCLASSIFIED//\n{sets}"
    )
}
fn initial() -> String {
    body(
        "CASLTY/INITIAL/2026001/-/TEST RADAR/EIC:AB12/CAT:2/CAUSE:1/N54321/-/7//\nESTIMATE/20261120/AWAITING PARTS//\nASSIST/INIT/TECHNICAL/DEMO PORT//\nGENTEXT/ASSIST/REQUEST TECHNICAL SUPPORT//\nASSIST/INIT/NONE//\nTECHDATA/INIT/APL:1234567/CID:1234/JCN:N54321-EM01-0001/TECHPUB:DEMO 1/PUBAV:Y/TECHPUB:DEMO 2/PUBAV:N//\nPARTS/001/COG:1H/NSN:1234-01-123-4567/2/C:1/0/-/A//\nPARTS/002/CAGE:12345/C:DEMO-2/1/C:1/0/C/C//\nREQNDATA/001/R:N54321-6001-W001/2/13/9AU/J:014/RI:NDZ/-/051200ZNOV2026//\nGENTEXT/IMPACT/DEGRADED DETECTION//\nGENTEXT/OPSKED/LOCAL OPERATIONS CONTINUE//\nGENTEXT/CO COMMENTS/REPAIR REQUIRED//",
    )
}
#[test]
fn initial_preserves_relationships_date_precision_and_audit_spans() {
    let text = initial();
    let parsed = run(&text, None).unwrap();
    let core = parsed.core.get();
    let c = core.casualty.as_ref().unwrap();
    assert_eq!(core.kind, "CASREP");
    assert_eq!(c.serial, "2026001");
    assert_eq!(c.reporting_uic, "N54321");
    assert_eq!(c.repair_estimate_date.as_deref(), Some("2026-11-20"));
    assert_eq!(c.parts.len(), 2);
    assert_eq!(c.requisitions[0].parts_sequence, "001");
    assert_eq!(c.technical_data[0].publications.len(), 2);
    assert_eq!(c.assistance.len(), 2);
    assert!(core.activities.is_empty());
    assert!(core.periods.is_empty());
    assert!(c.identifiers.contains(&"1234-01-123-4567".to_owned()));
    assert!(c.identifiers.contains(&"N54321-6001-W001".to_owned()));
    let audits = parsed.audit.iter().map(|a| a.get()).collect::<Vec<_>>();
    assert!(audits.iter().any(|a| a.subject_id.as_deref() == Some("q1")));
    for a in audits
        .iter()
        .filter(|a| a.kind == "record_interpreted" || a.kind == "fact_interpreted")
    {
        let p = &a.payload;
        let span = &p["span"];
        let source = &text[span["start_byte"].as_u64().unwrap() as usize
            ..span["end_byte"].as_u64().unwrap() as usize];
        assert!(source.starts_with(p["set_id"].as_str().unwrap()));
        assert!(source.ends_with("//"));
        assert_eq!(p["profile"], EXAMPLES);
    }
}
#[test]
fn all_report_actions_enforce_their_own_required_sets() {
    for (action, seq, sets) in [
        (
            "UPDATE",
            "01",
            "ESTIMATE/20261121//\nGENTEXT/OPSKED/DELAYED//",
        ),
        (
            "CORRECT",
            "-",
            "GENTEXT/CASLTY/REPAIR COMPLETE//\nCORRSTAT/HRFAIL:100/U/HREPAIR:8/HRPARTS:24//",
        ),
        ("CANCEL", "-", "GENTEXT/CASLTY/REPORT WITHDRAWN//"),
    ] {
        let text = body(&format!(
            "CASLTY/{action}/2026001/{seq}/TEST RADAR/EIC:AB12/CAT:2/CAUSE:1/N54321/051200ZNOV2026//\n{sets}"
        ));
        let parsed = run(&text, None).unwrap();
        let value = serde_json::to_value(parsed.core.get().casualty.as_ref().unwrap()).unwrap();
        assert_eq!(value["report_type"], action);
        assert!(parsed.core.get().activities.is_empty());
        assert!(run(&text.replace("/051200ZNOV2026", "/-"), None).is_err());
        if action == "UPDATE" {
            assert!(run(&text.replace("/01/", "/-/"), None).is_err());
        }
        if action == "CORRECT" {
            assert!(
                run(
                    &text.replace("CORRSTAT/HRFAIL:100/U/HREPAIR:8/HRPARTS:24//", ""),
                    None
                )
                .is_err()
            );
        }
        if action == "CANCEL" {
            assert!(run(&format!("{text}\nESTIMATE/20261121//"), None).is_err());
        }
    }
}
#[test]
fn incomplete_or_malformed_initial_never_emits_valid_looking_casualty() {
    let text = initial();
    for (old, new) in [
        ("ESTIMATE/20261120/AWAITING PARTS//", ""),
        (
            "ASSIST/INIT/TECHNICAL/DEMO PORT//\nGENTEXT/ASSIST/REQUEST TECHNICAL SUPPORT//\nASSIST/INIT/NONE//",
            "",
        ),
        ("GENTEXT/ASSIST/REQUEST TECHNICAL SUPPORT//", ""),
        ("GENTEXT/IMPACT/DEGRADED DETECTION//", ""),
        ("GENTEXT/OPSKED/LOCAL OPERATIONS CONTINUE//", ""),
        ("GENTEXT/CO COMMENTS/REPAIR REQUIRED//", ""),
        ("/2026001/", "/ABC/"),
        ("/CAT:2/", "/CAT:9/"),
        ("/INITIAL/2026001/-/", "/INITIAL/2026001/01/"),
        ("ESTIMATE/20261120", "ESTIMATE/20260230"),
        ("/TECHPUB:DEMO 2/PUBAV:N", "/TECHPUB:DEMO 2"),
    ] {
        assert!(
            run(&text.replace(old, new), None).is_err(),
            "accepted {old} -> {new}"
        );
    }
    assert!(
        run(
            &format!("{text}\nCASLTY/INITIAL/2026001/-/RADAR/EIC:AB12/CAT:2/CAUSE:1/N54321/-//"),
            None
        )
        .is_err()
    );
    assert!(run(&text.replace("PARTS/002/", "PARTS/001/"), None).is_err());
}
#[test]
fn editions_and_genadmin_never_silently_fall_back() {
    assert_eq!(
        run(&initial().replace("MSGID/CASREP/", "MSGID/GENADMIN/"), None)
            .err()
            .unwrap()
            .kind,
        ErrorKind::UnsupportedProfile
    );
    assert_eq!(
        run(&initial().replace("B.1.01.12", "B.9.99.99"), None)
            .err()
            .unwrap()
            .kind,
        ErrorKind::UnsupportedProfile
    );
    let legacy = initial().replace(
        "MIL-STD-6040(SERIES)/B.1.01.12/DEMO SHIP/001/20261105T120000Z/-/-/USA/UNCLASSIFIED",
        "DEMO SHIP/001",
    );
    assert_eq!(
        run(&legacy, None).err().unwrap().code,
        "baseline_security_context_required"
    );
    let security = Security {
        policy: "TEST".into(),
        classification: Some(SecurityClassification::Unclassified),
        release_to: vec![],
        status: SecurityStatus::Unvalidated,
    };
    let parsed = run(&legacy, Some(&security)).unwrap();
    assert!(parsed.core.get().issued_at.is_none());
    assert!(
        parsed
            .audit
            .iter()
            .any(|a| a.get().payload.get("profile") == Some(&json!(BASELINE)))
    );
    assert!(
        run(
            &initial().replace("EXER/DEMO//", "EXER/DEMO//\nOPER/DEMO//"),
            None
        )
        .is_err()
    );
}
#[test]
fn unknown_sets_and_inconsistent_source_dates_remain_visible() {
    let parsed = run(
        &format!(
            "{}\nUNKNOWN/SOURCE DATA//",
            initial().replace("20261120", "19950625")
        ),
        None,
    )
    .unwrap();
    assert_eq!(parsed.core.get().status, MessageStatus::Partial);
    assert!(
        parsed
            .core
            .get()
            .review_flags
            .contains(&"casualty_time_conflict".to_owned())
    );
    assert_eq!(
        parsed
            .core
            .get()
            .casualty
            .as_ref()
            .unwrap()
            .repair_estimate_date
            .as_deref(),
        Some("1995-06-25")
    );
}
#[test]
#[ignore = "requires the externally supplied PDF-derived fixture; never committed"]
fn authentic_page_52_acceptance() {
    let path = std::env::var("CASREP_PAGE_52_FIXTURE").expect("Set external fixture path");
    let text = std::fs::read_to_string(path).unwrap();
    let parsed = run(&text, None).unwrap();
    let c = parsed.core.get().casualty.as_ref().unwrap();
    assert_eq!(c.serial, "1995001");
    assert_eq!(c.eic, "H015");
    assert_eq!(c.reporting_uic, "N12345");
    assert_eq!(c.equipment, "N03 FFP");
    assert_eq!(c.parts.len(), 2);
    assert_eq!(c.requisitions.len(), 2);
    assert_eq!(c.assistance.len(), 2);
    assert_eq!(c.technical_data[0].publications.len(), 2);
    assert_eq!(c.repair_estimate_date.as_deref(), Some("1995-06-25"));
    assert!(
        parsed
            .core
            .get()
            .review_flags
            .contains(&"casualty_time_conflict".to_owned())
    );
}

#[test]
fn nested_casualty_output_obeys_the_host_byte_budget() {
    let parsed = run(&initial(), None).unwrap();
    let mut output_limits = limits().output;
    output_limits.max_core_bytes = 32;
    let mut sink = BoundedOutput::new(output_limits).unwrap();
    assert_eq!(
        sink.casualty(parsed.core.get().casualty.clone().unwrap())
            .err()
            .unwrap()
            .kind,
        ErrorKind::ResourceLimit
    );
    assert_eq!(sink.finish().err().unwrap().kind, ErrorKind::ResourceLimit);
}
