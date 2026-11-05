//! Synthetic contract tests; supplied traffic and expected documents remain external.
use parse_command_core::*;
use parse_command_optask::{OptaskParser, SUPPORTED_MESSAGE_TYPES};
use parse_command_parser_api::*;
use parse_command_types::*;
use serde_json::{Value, json};
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
        vec![Box::new(OptaskParser)],
        SUPPORTED_MESSAGE_TYPES
            .iter()
            .map(|t| t.to_string())
            .collect(),
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
            revision: "optask-test-1",
            recorded_at: &at,
            command_ids: &[],
            security_override: override_security,
            reference_time: None,
            budget: &budget,
        },
    )
}
fn body(kind: &str, sets: &str) -> String {
    let version = match kind {
        "OPTASK AAW" => "B.1.01.13",
        "OPTASK COP-CTP" => "B.1.01.03",
        "OPTASK LINK" => "B.1.02.04",
        _ => "B.1.01.12",
    };
    format!(
        "MSGID/{kind}/MIL-STD-6040(SERIES)/{version}/EXAMPLE UNIT/7/20260101T120000Z/-/-/USA/UNCLASSIFIED//\n{sets}"
    )
}
#[test]
fn every_listed_type_is_explicitly_registered_and_profile_versioned() {
    for kind in SUPPORTED_MESSAGE_TYPES {
        let parsed = run(&body(kind, "PERIOD/011200ZJAN2026/021200ZJAN2026//"), None).unwrap();
        assert_eq!(parsed.core.get().kind, *kind);
        assert_eq!(
            parsed.core.get().periods[0]
                .start_at
                .as_ref()
                .unwrap()
                .as_str(),
            "2026-01-01T12:00:00Z"
        );
        assert_eq!(parsed.core.get().status, MessageStatus::Partial);
    }
    let unknown = body("OPTASK LINK", "").replace("B.1.02.04", "B.9.99.99");
    assert_eq!(
        run(&unknown, None).err().unwrap().kind,
        ErrorKind::UnsupportedProfile
    );
    assert_eq!(
        run(&body("OPTASK LINK EXTRA", ""), None)
            .err()
            .unwrap()
            .kind,
        ErrorKind::UnsupportedProfile
    );
}
#[test]
fn baseline_and_observed_positions_cannot_silently_mix() {
    let security = Security {
        policy: "TEST".into(),
        classification: None,
        release_to: vec![],
        status: SecurityStatus::Unvalidated,
    };
    let text = "MSGID/OPTASK LINK/EXAMPLE UNIT/7/JAN/-/-//\nCRYPTDAT/CALLSIGN DOC/UNIT DOC/KG-TEST/EXAMPLEKEY/0130Z//\nDALKFREQ/DATA/FD:EXAMPLE/ASGN:5.125MHZ/P/B7D/D//";
    assert_eq!(
        run(text, None).err().unwrap().code,
        "baseline_security_context_required"
    );
    let parsed = run(text, Some(&security)).unwrap();
    let core = parsed.core.get();
    assert!(core.issued_at.is_none() && core.expires_at.is_none());
    assert_eq!(core.activities[0].equipment.as_deref(), Some("KG-TEST"));
    assert_eq!(core.activities[0].material.as_deref(), Some("EXAMPLEKEY"));
    assert_eq!(core.activities[0].time.as_deref(), Some("01:30Z"));
    assert_eq!(core.frequencies[0].hz, Some(5_125_000));
    let mixed = run(
        &body(
            "OPTASK LINK",
            "CRYPTDAT/CALLSIGN DOC/UNIT DOC/KG-TEST/EXAMPLEKEY/0130Z//",
        ),
        None,
    )
    .unwrap();
    assert!(mixed.core.get().activities.is_empty());
    assert!(
        mixed
            .core
            .get()
            .review_flags
            .contains(&"record_review".to_string())
    );
}
#[test]
fn plan_groups_hyphens_and_partial_times_stay_distinct() {
    let text = body(
        "OPTASK COMMS",
        "FREQPLAN/EXAMPLE PLAN/F1/A/1.25MHZ/J3E/P/B/-/-/-//\nCOMPLAN/EXAMPLE PLAN/A/1200Z/1800Z/UHF:1//\nCOMCHECK/021400ZJAN2026/UNIT ALPHA/COORD:EXAMPLE/CND:1//",
    );
    let parsed = run(&text, None).unwrap();
    let core = parsed.core.get();
    assert_eq!(core.frequencies.len(), 2);
    assert_eq!(core.frequencies[0].hz, Some(1_250_000));
    assert_eq!(
        core.frequencies[1].status,
        Some(FrequencyStatus::Unavailable)
    );
    assert!(core.activities[0].start_at.is_none());
    assert_eq!(
        core.activities[0].start_status,
        Some(TimeStatus::MissingDate)
    );
    assert_eq!(
        core.activities[1].at.as_ref().unwrap().as_str(),
        "2026-01-02T14:00:00Z"
    );
    assert_eq!(core.activities[1].participants, vec!["UNIT ALPHA"]);
}
#[test]
fn invalid_group_is_atomic_and_does_not_erase_later_good_records() {
    let text = body(
        "OPTASK COMMS",
        "FREQPLAN/EXAMPLE/F1/A/1MHZ/J3E/P/B/BOGUS/J3E/P//\nCOMCHECK/011400ZJAN2026/UNIT ALPHA/COORD:EXAMPLE//",
    );
    let parsed = run(&text, None).unwrap();
    assert!(parsed.core.get().frequencies.is_empty());
    assert_eq!(parsed.core.get().activities.len(), 1);
    assert!(parsed.audit.iter().any(|e| {
        e.get()
            .payload
            .get("detail")
            .is_some_and(|v| v["code"] == "frequency_unit")
    }));
    let reversed = run(
        &body(
            "OPTASK RAS",
            "PERIOD/021200ZJAN2026/011200ZJAN2026//\nRASKED/021300Z/TEST POSITION//",
        ),
        None,
    )
    .unwrap();
    assert!(reversed.core.get().periods.is_empty());
    assert_eq!(reversed.core.get().activities.len(), 1);
}
#[test]
fn period_qualifiers_check_conditional_field_without_fabricating_end() {
    let parsed = run(
        &body(
            "OPTASK GENERAL",
            "PERIOD/011200ZJAN2026/NLT/021800ZJAN2026//",
        ),
        None,
    )
    .unwrap();
    let p = &parsed.core.get().periods[0];
    assert_eq!(p.end_label.as_deref(), Some("NLT"));
    assert!(p.end_at.is_none());
    assert_eq!(
        p.qualifier_at.as_ref().unwrap().as_str(),
        "2026-01-02T18:00:00Z"
    );
    for record in [
        "PERIOD/011200ZJAN2026/NLT//",
        "PERIOD/011200ZJAN2026/UFN/021800ZJAN2026//",
    ] {
        assert!(
            run(&body("OPTASK GENERAL", record), None)
                .unwrap()
                .core
                .get()
                .periods
                .is_empty()
        );
    }
}
#[test]
fn scope_and_contacts_do_not_leak_into_next_segment_or_global_tail() {
    let text = body(
        "OPTASK LINK",
        "INTCOORD/COORDINATION//\nMULCDUTY/SHIP:UNIT ALPHA/PERSON ONE/LT/ICO/TEL:555-0100//\nIVCCN/DCN/P/ASGN:100MHZ/FRQDES:EXAMPLE/KEY/NET//\nMULCDUTY/SHIP:UNIT BRAVO/PERSON TWO/LT/RICO/TEL:555-0101//\nIVCCN/DCN/P/ASGN:200MHZ/FRQDES:EXAMPLE/KEY/NET//\nLNKXI/LINK ELEVEN//\nCRYPTDAT/KG-TEST/EXAMPLEKEY/0130Z//\nGENTEXT/C2 REQUIREMENTS/EXAMPLE GLOBAL TEXT//\nVOICRYPT/EXAMPLEKEY/0230Z//",
    );
    let parsed = run(&text, None).unwrap();
    let core = parsed.core.get();
    assert_eq!(
        core.frequencies[0].scope.as_deref(),
        Some("COORDINATION / UNIT ALPHA")
    );
    assert_eq!(
        core.frequencies[1].scope.as_deref(),
        Some("COORDINATION / UNIT BRAVO")
    );
    assert_eq!(core.activities[0].scope.as_deref(), Some("LINK ELEVEN"));
    assert!(core.activities[1].scope.is_none());
    assert_eq!(core.contacts[0].role.as_deref(), Some("ICO"));
    assert_eq!(core.contacts[1].unit, "UNIT BRAVO");
    assert!(core.command_ids.is_empty());
}
#[test]
fn issue_errors_security_conflicts_and_header_months_remain_visible() {
    let text = body("OPTASK COP-CTP", "")
        .replace("UNCLASSIFIED", "UNCLASSIFED")
        .replace("20260101T120000Z", "20260230T120000Z");
    let parsed = run(&text, None).unwrap();
    let core = parsed.core.get();
    assert!(core.issued_at.is_none() && core.expires_at.is_none());
    assert_eq!(core.security.status, SecurityStatus::Conflict);
    assert!(core.security.classification.is_none());
    assert!(core.review_flags.contains(&"invalid_issue_time".into()));
    assert!(parsed.audit.iter().any(|e| {
        e.get()
            .payload
            .get("source")
            .is_some_and(|v| v["raw_text"].as_str() == Some(&text))
    }));
    let month = body("OPTASK IM", "").replace("20260101T120000Z", "FEB");
    assert!(run(&month, None).unwrap().core.get().issued_at.is_none());
}
#[test]
fn reports_keep_deadline_asof_and_conditions_separate() {
    let parsed=run(&body("OPTASK IM","IDP/MTFID:TEST/ALL UNITS/ASOF:1200/NLT:1400/EMAIL//\nIDP/MTFID:OTHER/UNIT ALPHA/AS REQD/-/CHAT//"),None).unwrap();
    let a = &parsed.core.get().activities;
    assert_eq!(a[0].as_of_time.as_deref(), Some("12:00"));
    assert_eq!(a[0].deadline_time.as_deref(), Some("14:00"));
    assert_eq!(a[0].deadline_status, Some(TimeStatus::MissingDateAndZone));
    assert_eq!(a[1].as_of_status, Some(TimeStatus::ConditionNotScheduled));
    assert_eq!(
        a[1].deadline_status,
        Some(TimeStatus::NotAvailableWithheldOrInapplicable)
    );
}
#[test]
fn deterministic_output_and_audit_spans_are_valid() {
    let text = body(
        "OPTASK ASW",
        "TASMISSN/EXAMPLE TASK/UNIT ALPHA//\nGENTEXT/EXAMPLE/HTTP://EXAMPLE.INVALID/A/B//",
    );
    let first = run(&text, None).unwrap();
    let second = run(&text, None).unwrap();
    assert_eq!(
        serde_json::to_vec(&first.core).unwrap(),
        serde_json::to_vec(&second.core).unwrap()
    );
    assert_eq!(
        serde_json::to_vec(&first.audit).unwrap(),
        serde_json::to_vec(&second.audit).unwrap()
    );
    for entry in &first.audit {
        if let Some(span) = entry.get().payload.get("span") {
            let source = &text[span["start_byte"].as_u64().unwrap() as usize
                ..span["end_byte"].as_u64().unwrap() as usize];
            assert!(source.starts_with(entry.get().payload["set_id"].as_str().unwrap()));
        }
    }
    assert!(first.audit.iter().any(|e| {
        e.get()
            .payload
            .get("detail")
            .is_some_and(|v| v["disposition"] == "preserved_only")
    }));
}

#[test]
fn malformed_field_counts_and_unicode_are_bounded_without_panics() {
    let cases = [
        ("OPTASK COMMS", "FREQPLAN"),
        ("OPTASK COMMS", "COMPLAN"),
        ("OPTASK COMMS", "COMCHECK"),
        ("OPTASK COMMS", "COMGUARD"),
        ("OPTASK LINK", "CRYPTDAT"),
        ("OPTASK LINK", "IVCCN"),
        ("OPTASK LINK", "DALKFREQ"),
        ("OPTASK LINK", "POCLINK"),
        ("OPTASK GENERAL", "POC"),
        ("OPTASK GENERAL", "PERIOD"),
        ("OPTASK IM", "IDP"),
        ("OPTASK RAS", "RASKED"),
        ("OPTASK AAW", "AEWEMPL"),
        ("OPTASK ASW", "TASMISSN"),
        ("OPTASK EW", "ESMTASK"),
    ];
    for (kind, set) in cases {
        for count in 0..24 {
            let fields = (0..count)
                .map(|i| ["-", "EXAMPLE", "é", "0123Z", "1.25MHZ"][i % 5])
                .collect::<Vec<_>>()
                .join("/");
            let record = if count == 0 {
                format!("{set}//")
            } else {
                format!("{set}/{fields}//")
            };
            let parsed = run(&body(kind, &record), None).unwrap();
            parsed.core.get().validate().unwrap();
            for event in parsed.audit {
                event.get().validate().unwrap();
            }
        }
    }
}

#[test]
fn geospatial_default_datum_points_lines_and_closed_polygons_follow_contract() {
    let parsed=run(&body("OPTASK MCM","AREA/0000N00000E/0000N00100E/0100N00000E//\nCHANDAT/EXAMPLE/100000N0200000E/110000N0210000E//\nPIM/101122S7-0203344W6/011200Z3/EXAMPLE//"),None).unwrap();
    let locations = &parsed.core.get().locations;
    assert_eq!(locations.len(), 3);
    assert_eq!(locations[0].datum, "WGS84");
    assert_eq!(locations[0].datum_source, LocationDatumSource::Default);
    let polygon = locations[0].shape.as_ref().unwrap();
    assert_eq!(polygon["type"], "Polygon");
    let ring = polygon["coordinates"][0].as_array().unwrap();
    assert_eq!(ring.first(), ring.last());
    assert_eq!(ring.len(), 4);
    let line = locations[1].shape.as_ref().unwrap();
    assert_eq!(line["type"], "LineString");
    assert_eq!(line["coordinates"], json!([[20.0, 10.0], [21.0, 11.0]]));
    let point = locations[2].point.as_ref().unwrap();
    assert!((point.lat + (10.0 + 11.0 / 60.0 + 22.0 / 3600.0)).abs() < 1e-10);
    assert!(point.lon < 0.0);
    for location in locations {
        assert!(
            parsed
                .audit
                .iter()
                .any(|event| event.get().subject_id.as_ref() == Some(&location.id))
        );
    }
}
#[test]
fn different_datums_bad_checksums_and_crossing_rings_are_reviewable_without_geometry() {
    for record in [
        "GEODATUM/ADI-E//\nAREA/0000N00000E/0000N00100E/0100N00000E//",
        "PIM/101122S7-0203344W5/011200Z3/EXAMPLE//",
        "AREA/0000N00000E/0200N00200E/0200N00000E/0000N00200E//",
    ] {
        let parsed = run(&body("OPTASK MCM", record), None).unwrap();
        let location = &parsed.core.get().locations[0];
        assert_eq!(location.status, LocationStatus::Unresolved);
        assert!(location.shape.is_none() && location.point.is_none());
        assert!(
            parsed
                .core
                .get()
                .review_flags
                .iter()
                .any(|v| v == "geospatial_review")
        );
    }
    assert!(
        GeoPoint {
            lat: f64::NAN,
            lon: 0.0
        }
        .validate()
        .is_err()
    );
    assert!(
        GeoPoint {
            lat: 91.0,
            lon: 0.0
        }
        .validate()
        .is_err()
    );
    let explicit = run(
        &body(
            "OPTASK LINK",
            "GEODATUM/WE//\nAREA/0000N00000E/0000N00100E/0100N00000E//",
        ),
        None,
    )
    .unwrap();
    assert_eq!(explicit.core.get().locations[0].datum, "WGS84");
    assert_eq!(
        explicit.core.get().locations[0].datum_source,
        LocationDatumSource::Explicit
    );
}

fn contains_expected(actual: &Value, expected: &Value, path: &str) {
    match expected {
        Value::Object(map) => {
            for (key, value) in map {
                contains_expected(&actual[key], value, &format!("{path}.{key}"));
            }
        }
        Value::Array(list) => {
            assert_eq!(actual.as_array().unwrap().len(), list.len(), "{path}");
            for (i, value) in list.iter().enumerate() {
                contains_expected(&actual[i], value, &format!("{path}[{i}]"));
            }
        }
        _ => assert_eq!(actual, expected, "{path}"),
    }
}
#[test]
#[ignore = "requires external sample corpus; no supplied traffic is committed"]
fn external_optask_regression() {
    let root = std::path::PathBuf::from(
        std::env::var_os("PARSE_COMMAND_SAMPLES").expect("set external parsed directory"),
    );
    let messages = std::fs::read_to_string(root.join("messages.ndjson")).unwrap();
    let audit = std::fs::read_to_string(root.join("audit/events.ndjson")).unwrap();
    let mut seen = BTreeSet::new();
    let mut totals = [0usize; 4];
    for line in messages.lines() {
        let expected: Value = serde_json::from_str(line).unwrap();
        let event = audit
            .lines()
            .map(|l| serde_json::from_str::<Value>(l).unwrap())
            .find(|e| e["kind"] == "source_preserved" && e["message_id"] == expected["id"])
            .unwrap();
        let parsed = run(
            event["payload"]["source"]["raw_text"].as_str().unwrap(),
            None,
        )
        .unwrap();
        let actual = serde_json::to_value(&parsed.core).unwrap();
        for key in [
            "id",
            "type",
            "originator",
            "serial",
            "issued_at",
            "expires_at",
            "periods",
            "frequencies",
            "activities",
            "contacts",
        ] {
            contains_expected(
                &actual[key],
                &expected[key],
                &format!("{}.{}", expected["type"], key),
            );
        }
        for (i, key) in ["periods", "frequencies", "activities", "contacts"]
            .iter()
            .enumerate()
        {
            totals[i] += actual[key].as_array().unwrap().len();
        }
        assert!(
            !parsed
                .audit
                .iter()
                .any(|e| e
                    .get()
                    .payload
                    .get("detail")
                    .is_some_and(|v| v["disposition"] == "review_required"
                        && !v["code"]
                            .as_str()
                            .is_some_and(|c| c.starts_with("coordinate_")
                                || c.starts_with("area_")
                                || c.starts_with("circle_")))),
            "{}",
            expected["type"]
        );
        seen.insert(parsed.core.get().kind.clone());
    }
    assert_eq!(
        seen,
        SUPPORTED_MESSAGE_TYPES
            .iter()
            .map(|t| t.to_string())
            .collect()
    );
    assert_eq!(totals, [13, 27, 25, 8]);
    // Counts and subset equality guard loss; new participant and uncertainty fields are intentional.
    let _ = json!({"verified_types":seen.len(),"facts":totals});
}

#[test]
fn missing_year_uses_intake_year_and_named_locations_are_valid_without_map_geometry() {
    let parsed = run(
        &body("OPTASK COMMS", "PERIOD/011200ZJAN/021200ZJAN//"),
        None,
    )
    .unwrap();
    assert_eq!(
        parsed.core.get().periods[0]
            .start_at
            .as_ref()
            .unwrap()
            .as_str(),
        "2026-01-01T12:00:00Z"
    );
    assert!(
        parsed
            .audit
            .iter()
            .any(|event| event.get().payload.get("rule_id")
                == Some(&json!("optask.intake_year_default.v1"))
                && event.get().payload["detail"]["applied_year"] == 2026)
    );
    let named = run(&body("OPTASK AAW", "AREA/W123//"), None).unwrap();
    let location = &named.core.get().locations[0];
    assert_eq!(location.label, "W123");
    assert!(location.point.is_none() && location.shape.is_none());
    assert!(
        !named
            .core
            .get()
            .review_flags
            .iter()
            .any(|v| v == "geospatial_review")
    );
    let explicit = run(
        &body("OPTASK COMMS", "PERIOD/011200ZJAN2008/021200ZJAN2008//"),
        None,
    )
    .unwrap();
    assert_eq!(
        explicit.core.get().periods[0]
            .start_at
            .as_ref()
            .unwrap()
            .as_str(),
        "2008-01-01T12:00:00Z"
    );
    let no_month = run(
        &body("OPTASK RAS", "RASKED/011200Z/NAME:EXERCISE HARBOR//"),
        None,
    )
    .unwrap();
    assert!(no_month.core.get().activities[0].at.is_none());
}

#[test]
fn priority_one_scenario_has_real_source_evidence_and_known_and_unresolved_windows() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/priority-1");
    let sources: Vec<Value> =
        serde_json::from_slice(&std::fs::read(root.join("sources.json")).unwrap()).unwrap();
    for source in sources {
        let body = std::fs::read_to_string(root.join(source["file"].as_str().unwrap())).unwrap();
        let parsed = run(&body, None).unwrap();
        let core = serde_json::to_value(parsed.core.get()).unwrap();
        assert_eq!(
            source["sourceKey"]
                .as_str()
                .unwrap()
                .split('@')
                .next()
                .unwrap(),
            core["id"]
        );
        assert_eq!(core["status"], "partial");
        assert!(
            parsed
                .audit
                .iter()
                .any(|entry| entry.get().kind == "source_preserved")
        );
        if source["name"] == "unrelated" {
            assert!(parsed.core.get().activities.is_empty());
        } else {
            assert_eq!(core["activities"][0]["type"], "communications_plan_window");
            assert_eq!(core["activities"][0]["id"], "a1");
            if source["name"] == "original" {
                assert_eq!(core["activities"][0]["start_at"], "2026-11-10T09:00:00Z");
                assert_eq!(core["activities"][0]["end_at"], "2026-11-10T09:45:00Z");
                assert_eq!(core["contacts"][0]["unit"], "EXTERNAL UNIT");
            } else if source["name"] == "unknown-deadline" {
                assert!(core["activities"][0]["start_at"].is_null());
                assert!(core["activities"][0]["end_at"].is_null());
            }
        }
    }
}
