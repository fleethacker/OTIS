use base64::Engine;
use parse_command_intake::{
    config::{Config, SourceRouting},
    journal::Receipt,
    mime,
    service::Service,
};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
static NEXT: AtomicU64 = AtomicU64::new(1);
struct TestConfig(Config);
impl TestConfig {
    fn new() -> Self {
        let mut c = Config::load(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/demo-intake.json"),
        )
        .unwrap();
        c.opensearch_url = std::env::var("PARSE_COMMAND_TEST_OPENSEARCH_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:9200".into());
        c.custody_index = format!(
            ".parse-command-test-custody-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        Self(c)
    }
}
impl Drop for TestConfig {
    fn drop(&mut self) {
        if std::env::var_os("PARSE_COMMAND_TEST_OPENSEARCH_URL").is_some() {
            let _ = reqwest::blocking::Client::new()
                .delete(format!(
                    "{}/{}",
                    self.0.opensearch_url, self.0.custody_index
                ))
                .send();
        }
    }
}
fn body() -> &'static str {
    "MSGID/OPTASK GENERAL/MIL-STD-6040(SERIES)/B.1.01.12/EXAMPLE UNIT/1/20260101T120000Z/-/-/USA/UNCLASSIFIED//\nPERIOD/011200ZJAN2026/UFN//"
}
fn email(subject: &str, text: &str) -> Vec<u8> {
    format!("From: example@invalid\r\nSubject: {subject}\r\nMessage-ID: <same-id@invalid>\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{}\r\n",base64::engine::general_purpose::STANDARD.encode(text)).into_bytes()
}
fn stage(s: &mut Service, c: &Config, validity: u32, uid: u32, raw: &[u8]) -> bool {
    s.journal
        .accept(
            c,
            Receipt {
                validity,
                uid,
                size: raw.len() as u32,
                raw: Some(raw),
                state: "staged",
                code: None,
                received_at: "2026-01-01T12:00:00Z",
                server_received_at: Some("2026-01-01T12:00:00Z"),
            },
        )
        .unwrap()
}
#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn staged_bytes_survive_reopen_and_parsing_commits_with_outbox() {
    let config = TestConfig::new();
    let c = &config.0;
    let raw = email("SUBJ: Example", body());
    {
        let mut s = Service::open(c.clone()).unwrap();
        assert!(stage(&mut s, c, 10, 1, &raw));
        assert_eq!(s.journal.cursor(c, 10).unwrap(), 1);
        assert_eq!(s.journal.next_job(c).unwrap().unwrap().raw, raw);
    }
    let mut s = Service::open(c.clone()).unwrap();
    assert_eq!(s.process(&AtomicBool::new(false)).unwrap(), 1);
    let status = s.journal.status().unwrap();
    assert_eq!(status["receipts"]["parsed"], 1);
    assert_eq!(status["projections"], 1);
    assert_eq!(
        s.journal
            .store
            .list(
                "receipt",
                vec![serde_json::json!({"term":{"flags":"audit_pending"}})],
                10
            )
            .unwrap()
            .len(),
        1
    );
    drop(s);
    let mut s = Service::open(c.clone()).unwrap();
    assert_eq!(s.process(&AtomicBool::new(false)).unwrap(), 0);
    assert!(!stage(&mut s, c, 10, 1, &raw));
    assert_eq!(s.journal.status().unwrap(), status);
}
#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn duplicate_body_latest_subject_and_uidvalidity_epochs_preserve_every_receipt() {
    let config = TestConfig::new();
    let c = &config.0;
    let mut s = Service::open(c.clone()).unwrap();
    stage(&mut s, c, 10, 1, &email("SUBJ: First", body()));
    s.process(&AtomicBool::new(false)).unwrap();
    stage(
        &mut s,
        c,
        10,
        2,
        &email("SUBJ: Newest: interior colon", body()),
    );
    s.process(&AtomicBool::new(false)).unwrap();
    stage(
        &mut s,
        c,
        11,
        1,
        &email("SUBJ: After mailbox reset", body()),
    );
    s.process(&AtomicBool::new(false)).unwrap();
    let status = s.journal.status().unwrap();
    assert_eq!(status["projections"], 1);
    assert_eq!(status["receipts"]["duplicate"], 2);
    assert_eq!(status["cursors"].as_array().unwrap().len(), 2);
    let mut bytes = Vec::new();
    s.journal.export(&mut bytes).unwrap();
    let doc: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(doc["subject"], "After mailbox reset");
    assert!(
        doc["review_flags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "subject_conflict")
    );
    let mut receipts = Vec::new();
    s.journal.receipts(&mut receipts).unwrap();
    assert_eq!(String::from_utf8(receipts).unwrap().lines().count(), 3);
}

#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn older_server_receipt_found_during_rescan_cannot_replace_newer_subject() {
    let config = TestConfig::new();
    let c = &config.0;
    let mut s = Service::open(c.clone()).unwrap();
    stage(&mut s, c, 10, 5, &email("SUBJ: Current subject", body()));
    s.process(&AtomicBool::new(false)).unwrap();
    let raw = email("SUBJ: Older archived subject", body());
    s.journal
        .accept(
            c,
            Receipt {
                validity: 11,
                uid: 9,
                size: raw.len() as u32,
                raw: Some(&raw),
                state: "staged",
                code: None,
                received_at: "2026-02-01T00:00:00Z",
                server_received_at: Some("2025-01-01T00:00:00Z"),
            },
        )
        .unwrap();
    s.process(&AtomicBool::new(false)).unwrap();
    let mut out = Vec::new();
    s.journal.export(&mut out).unwrap();
    let doc: serde_json::Value = serde_json::from_slice(&out).unwrap();
    assert_eq!(doc["subject"], "Current subject");
    assert!(
        doc["review_flags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "subject_conflict")
    );
}
#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn capacity_failures_never_advance_cursor_or_consume_job_attempts() {
    let mut config = TestConfig::new();
    let raw = email("SUBJ: Example", body());
    config.0.max_retained_bytes = 1;
    let c = &config.0;
    let mut s = Service::open(c.clone()).unwrap();
    assert!(
        s.journal
            .accept(
                c,
                Receipt {
                    validity: 10,
                    uid: 1,
                    size: raw.len() as u32,
                    raw: Some(&raw),
                    state: "staged",
                    code: None,
                    received_at: "2026-01-01T12:00:00Z",
                    server_received_at: Some("2026-01-01T12:00:00Z"),
                }
            )
            .is_err()
    );
    assert_eq!(s.journal.cursor(c, 10).unwrap(), 0);
    drop(s);
    config.0.max_retained_bytes = 2600;
    let c = &config.0;
    let mut s = Service::open(c.clone()).unwrap();
    stage(&mut s, c, 10, 1, &raw);
    assert_eq!(
        s.process(&AtomicBool::new(false)).err().unwrap().0,
        "custody_capacity"
    );
    s.journal.begin_cycle().unwrap();
    let job = s.journal.next_job(c).unwrap().unwrap();
    assert_eq!(job.attempts, 0);
    assert_eq!(s.journal.status().unwrap()["projections"], 0);
    drop(s);
    config.0.max_retained_bytes = 268435456;
    let mut s = Service::open(config.0.clone()).unwrap();
    assert_eq!(s.process(&AtomicBool::new(false)).unwrap(), 1);
}
#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn poison_email_does_not_block_later_mail_and_cancel_leaves_staged() {
    let config = TestConfig::new();
    let c = &config.0;
    let mut s = Service::open(c.clone()).unwrap();
    stage(&mut s, c, 10, 1, b"not MIME or USMTF");
    stage(&mut s, c, 10, 2, &email("SUBJ: Valid", body()));
    assert_eq!(s.process(&AtomicBool::new(true)).unwrap(), 0);
    assert_eq!(s.journal.status().unwrap()["receipts"]["staged"], 2);
    s.process(&AtomicBool::new(false)).unwrap();
    let st = s.journal.status().unwrap();
    assert_eq!(st["receipts"]["quarantined"], 1);
    assert_eq!(st["receipts"]["parsed"], 1);
}
#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn identity_changes_fail_closed() {
    let mut config = TestConfig::new();
    drop(Service::open(config.0.clone()).unwrap());
    config.0.username = "other@invalid".into();
    assert_eq!(
        Service::open(config.0.clone()).err().unwrap().0,
        "journal_identity_changed"
    );
}

#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn same_receipt_cannot_silently_replace_its_original_bytes() {
    let config = TestConfig::new();
    let c = &config.0;
    let mut s = Service::open(c.clone()).unwrap();
    let first = email("SUBJ: One", body());
    stage(&mut s, c, 10, 1, &first);
    let different = email("SUBJ: Two", body());
    let result = s.journal.accept(
        c,
        Receipt {
            validity: 10,
            uid: 1,
            size: different.len() as u32,
            raw: Some(&different),
            state: "staged",
            code: None,
            received_at: "2026-01-01T12:00:00Z",
            server_received_at: Some("2026-01-01T12:00:00Z"),
        },
    );
    assert_eq!(result.err().unwrap().0, "receipt_identity_collision");
    assert_eq!(s.journal.next_job(c).unwrap().unwrap().raw, first);
}
#[test]
fn mime_preserves_utf8_subject_and_exact_body_and_bounds_multipart() {
    let config = TestConfig::new();
    let limits = config.0.mime;
    let mail = mime::decode(&email("=?UTF-8?B?U1VCSjogY2Fmw6k=?=", body()), limits).unwrap();
    assert_eq!(mail.subject.as_deref(), Some("SUBJ: café"));
    assert_eq!(mail.body, body());
    let multipart = format!(
        "Subject: SUBJ: Example\r\nContent-Type: multipart/alternative; boundary=BOUNDARY\r\n\r\n--BOUNDARY\r\nContent-Type: text/html\r\n\r\n<p>Example</p>\r\n--BOUNDARY\r\n{}\r\n--BOUNDARY--\r\n",
        String::from_utf8(email("SUBJ: Part", body()))
            .unwrap()
            .trim_end()
    );
    assert_eq!(
        mime::decode(multipart.as_bytes(), limits).unwrap().body,
        body()
    );
    let mut small = limits;
    small.max_depth = 0;
    assert!(mime::decode(multipart.as_bytes(), small).is_err());
    let mut small = limits;
    small.max_decoded_bytes = 4;
    assert!(mime::decode(&email("SUBJ: Example", body()), small).is_err());
    let duplicate = b"Subject: A\r\nSubject: B\r\n\r\nMSGID/TEST//";
    assert!(mime::decode(duplicate, limits).is_err());
}

#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn burst_is_bounded_and_resumes_without_duplicate_receipts() {
    let mut config = TestConfig::new();
    config.0.jobs_per_cycle = 17;
    let c = &config.0;
    let mut service = Service::open(c.clone()).unwrap();
    for uid in 1..=200 {
        let body = body().replace("/EXAMPLE UNIT/1/", &format!("/EXAMPLE UNIT/{uid}/"));
        assert!(stage(
            &mut service,
            c,
            40,
            uid,
            &email("SUBJ: Burst exercise", &body)
        ));
    }
    assert_eq!(service.journal.cursor(c, 40).unwrap(), 200);
    drop(service);
    let mut processed = 0;
    let mut cycles = 0;
    loop {
        let mut service = Service::open(c.clone()).unwrap();
        let count = service.process(&AtomicBool::new(false)).unwrap();
        assert!(count <= 17);
        processed += count;
        cycles += 1;
        if count == 0 {
            break;
        }
        assert!(
            cycles <= 12,
            "queue did not drain within the bounded cycles"
        );
        // Reopen after every cycle to exercise persisted queue recovery.
    }
    assert_eq!(processed, 200);
    let mut service = Service::open(c.clone()).unwrap();
    let status = service.journal.status().unwrap();
    assert_eq!(status["receipts"]["parsed"], 200);
    assert_eq!(status["projections"], 200);
    assert!(!stage(
        &mut service,
        c,
        40,
        1,
        &email("SUBJ: Burst exercise", body())
    ));
    assert_eq!(service.journal.status().unwrap(), status);
}

fn routing(policy: &str, ids: &[&str]) -> SourceRouting {
    SourceRouting {
        policy_id: policy.into(),
        command_ids: ids.iter().map(|value| (*value).into()).collect(),
    }
}
fn projections(service: &Service) -> Vec<serde_json::Value> {
    let mut output = Vec::new();
    service.journal.export(&mut output).unwrap();
    String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn source_routing_config_is_explicit_bounded_and_strict() {
    let config = TestConfig::new();
    for source_routing in [
        routing("invalid policy", &["SHIP-A"]),
        routing("policy-v1", &[]),
        routing("policy-v1", &["SHIP-A", "SHIP-A"]),
        routing("policy-v1", &[" SHIP-A"]),
        routing("policy-v1", &["SHIP\nA"]),
        routing("policy-v1", &[&"x".repeat(257)]),
        SourceRouting {
            policy_id: "policy-v1".into(),
            command_ids: (0..33).map(|n| format!("SHIP-{n}")).collect(),
        },
    ] {
        let mut invalid = config.0.clone();
        invalid.source_routing = Some(source_routing);
        assert!(invalid.validate().is_err());
    }
    let mut json: serde_json::Value =
        serde_json::from_str(include_str!("../../../config/demo-intake.json")).unwrap();
    json["sourceRouting"] =
        serde_json::json!({"policyId":"approved-feed-v1","commandIds":["SHIP-A"]});
    let parsed: Config = serde_json::from_value(json.clone()).unwrap();
    parsed.validate().unwrap();
    assert_eq!(parsed.command_ids(), vec!["SHIP-A"]);
    json["sourceRouting"]["inferFromMentions"] = serde_json::json!(true);
    assert!(serde_json::from_value::<Config>(json).is_err());
}

#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn absent_routing_never_promotes_subject_or_originator_to_applicability() {
    let config = TestConfig::new();
    assert!(config.0.source_routing.is_none());
    let c = &config.0;
    let mut service = Service::open(c.clone()).unwrap();
    stage(
        &mut service,
        c,
        10,
        1,
        &email(
            "SUBJ: USS AMERICA engineering",
            &body().replace("EXAMPLE UNIT", "USS AMERICA"),
        ),
    );
    service.process(&AtomicBool::new(false)).unwrap();
    let docs = projections(&service);
    assert_eq!(docs[0]["originator"], "USS AMERICA");
    assert_eq!(docs[0]["command_ids"], serde_json::json!([]));
}

#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn demo_assignments_and_source_routing_cannot_silently_replace_each_other() {
    let mut config = TestConfig::new();
    config.0.demo_fixture_assignments = true;
    let mut invalid = config.0.clone();
    invalid.source_routing = Some(routing("approved-feed-v1", &["SHIP-A"]));
    assert_eq!(
        invalid.validate().unwrap_err().0,
        "conflicting_source_routing_modes"
    );
    let mut service = Service::open(config.0.clone()).unwrap();
    let fixture = include_str!("../../../config/watchdesk-fixtures/shared.txt");
    stage(
        &mut service,
        &config.0,
        70,
        1,
        &email("SUBJ: Fictional shared watch", fixture),
    );
    service.process(&AtomicBool::new(false)).unwrap();
    let original = projections(&service);
    drop(service);
    let mut changed = config.0.clone();
    changed.demo_fixture_assignments = false;
    assert_eq!(
        Service::open(changed).err().unwrap().0,
        "source_routing_revision_conflict"
    );
    let service = Service::open(config.0.clone()).unwrap();
    assert_eq!(projections(&service), original);
}

#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn approved_routing_preserves_policy_and_receipt_audit_across_restart() {
    let mut config = TestConfig::new();
    config.0.source_routing = Some(routing("station-feed-v1", &["SHIP-B", "SHIP-A"]));
    let c = &config.0;
    let mut service = Service::open(c.clone()).unwrap();
    stage(&mut service, c, 80, 1, &email("SUBJ: SHIP-C", body()));
    service.process(&AtomicBool::new(false)).unwrap();
    let original = projections(&service);
    assert_eq!(
        original[0]["command_ids"],
        serde_json::json!(["SHIP-A", "SHIP-B"])
    );
    let receipts = service.journal.store.list("receipt", vec![], 10).unwrap();
    let audits = receipts[0].record.payload["audit"].as_array().unwrap();
    let audit = audits
        .iter()
        .find(|a| a["kind"] == "source_routing_applied")
        .unwrap();
    assert_eq!(audit["payload"]["policy_id"], "station-feed-v1");
    assert_eq!(
        audit["payload"]["policy_fingerprint"],
        c.routing_fingerprint()
    );
    assert_eq!(audit["payload"]["command_ids"], original[0]["command_ids"]);
    assert_eq!(audit["payload"]["grants_access"], false);
    assert_eq!(audit["security"], original[0]["security"]);
    drop(service);
    let mut reordered = c.clone();
    reordered
        .source_routing
        .as_mut()
        .unwrap()
        .command_ids
        .reverse();
    let service = Service::open(reordered).unwrap();
    assert_eq!(projections(&service), original);
    let mut changed = c.clone();
    changed.account_id = "different-source".into();
    changed.source_routing = Some(routing("different-policy", &["SHIP-C"]));
    assert_eq!(
        Service::open(changed.clone()).err().unwrap().0,
        "source_routing_revision_conflict"
    );
    changed.revision = "routing-v2".into();
    let mut next = Service::open(changed.clone()).unwrap();
    stage(&mut next, &changed, 80, 1, &email("SUBJ: Replay", body()));
    next.process(&AtomicBool::new(false)).unwrap();
    let docs = projections(&next);
    assert_eq!(docs.len(), 2);
    assert_eq!(
        docs.iter().find(|d| d["revision"] == c.revision).unwrap(),
        &original[0]
    );
}

#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn unbound_historical_revision_requires_explicit_migration() {
    let config = TestConfig::new();
    let c = &config.0;
    let store =
        parse_command_state::BlockingStore::new(&c.opensearch_url, &c.custody_index).unwrap();
    store.provision().unwrap();
    let old = parse_command_state::Record::new(
        "mailbox_identity",
        "old-account",
        serde_json::json!({"revision":c.revision}),
    );
    store.put(&old, None).unwrap();
    assert_eq!(
        Service::open(c.clone()).err().unwrap().0,
        "source_routing_revision_unbound"
    );
    assert!(
        store
            .get("source_routing_revision", &c.revision)
            .unwrap()
            .is_none()
    );
}

#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn demo_recurrence_security_and_assignment_evidence_survive_opensearch_staging() {
    let mut config = TestConfig::new();
    config.0.demo_fixture_assignments = true;
    let fixtures = [
        include_str!("../../../config/watchdesk-fixtures/shared.txt"),
        include_str!("../../../config/watchdesk-fixtures/recurring-radio.txt"),
        include_str!("../../../config/watchdesk-fixtures/baseline-crypto.txt"),
    ];
    let mut service = Service::open(config.0.clone()).unwrap();
    for (index, body) in fixtures.iter().enumerate() {
        stage(
            &mut service,
            &config.0,
            90,
            index as u32 + 1,
            &email("SUBJ: Fictional Watch Desk", body),
        );
    }
    service.process(&AtomicBool::new(false)).unwrap();
    let docs = projections(&service);
    assert_eq!(docs.len(), 3);
    let recurring: Vec<_> = docs
        .iter()
        .filter(|d| d.get("recurrences").is_some())
        .collect();
    assert_eq!(recurring.len(), 2);
    for doc in recurring {
        assert_eq!(doc["recurrences"][0]["dtstart"], "2026-11-05T00:00:00Z");
        assert_eq!(doc["recurrences"][0]["until"], "2026-11-08T23:59:00Z");
    }
    let baseline = docs.iter().find(|d| d["type"] == "OPTASK LINK").unwrap();
    assert_eq!(baseline["security"]["policy"], "FICTIONAL_DEMO_ONLY");
    assert!(baseline["activities"][0].get("at").is_none());
    let records = service
        .journal
        .store
        .list("projection", vec![], 10)
        .unwrap();
    for record in records {
        let audits = record.record.payload["audits"].as_array().unwrap();
        let evidence = audits
            .iter()
            .find(|a| a["kind"] == "demo_command_assignment")
            .unwrap();
        assert_eq!(evidence["payload"]["version"], "watchdesk-demo-v3");
        assert_eq!(
            evidence["payload"]["command_ids"],
            record.record.payload["core"]["command_ids"]
        );
    }
    let disabled = TestConfig::new();
    let mut service = Service::open(disabled.0.clone()).unwrap();
    for (index, body) in fixtures[1..].iter().enumerate() {
        stage(
            &mut service,
            &disabled.0,
            90,
            index as u32 + 1,
            &email("SUBJ: No implicit policy", body),
        );
    }
    service.process(&AtomicBool::new(false)).unwrap();
    let docs = projections(&service);
    assert_eq!(docs.len(), 1);
    assert!(docs[0].get("recurrences").is_none());
    assert_eq!(docs[0]["command_ids"], serde_json::json!([]));
    assert_eq!(
        service.journal.status().unwrap()["receipts"]["quarantined"],
        1
    );
}
