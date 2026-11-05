//! Applicability is explicit source configuration, bound to the retained parser revision.
use base64::Engine;
use parse_command_intake::{
    config::{Config, SourceRouting},
    journal::{Journal, Receipt},
    service::Service,
};
use parse_command_state::{BlockingStore, Record};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

fn config() -> Config {
    Config::load(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/demo-intake.json"),
    )
    .unwrap()
}
fn routing(ids: &[&str]) -> SourceRouting {
    SourceRouting {
        policy_id: "authored-applicability-v1".into(),
        command_ids: ids.iter().map(|value| value.to_string()).collect(),
    }
}
#[test]
fn optional_routing_is_empty_by_default_and_order_independent() {
    let mut c = config();
    assert!(c.source_routing.is_none());
    assert!(c.command_ids().is_empty());
    let default_fingerprint = c.routing_fingerprint();
    c.source_routing = Some(routing(&["ship-b", "ship-a"]));
    c.validate().unwrap();
    assert_eq!(c.command_ids(), ["ship-a", "ship-b"]);
    let configured = c.routing_fingerprint();
    assert_ne!(configured, default_fingerprint);
    c.source_routing.as_mut().unwrap().command_ids.reverse();
    assert_eq!(c.routing_fingerprint(), configured);
    c.source_routing.as_mut().unwrap().policy_id = "authored-applicability-v2".into();
    assert_ne!(c.routing_fingerprint(), configured);
}
#[test]
fn invalid_or_ambiguous_routing_configuration_is_rejected() {
    let mut c = config();
    for ids in [
        vec![],
        vec!["ship-a", "ship-a"],
        vec![" ship-a"],
        vec!["ship-a\n"],
    ] {
        c.source_routing = Some(routing(&ids));
        assert_eq!(c.validate().unwrap_err().0, "source_routing_command_ids");
    }
    c.source_routing = Some(routing(&["ship-a"]));
    c.source_routing.as_mut().unwrap().policy_id = "bad policy".into();
    assert_eq!(c.validate().unwrap_err().0, "source_routing_policy_id");
    c.source_routing = Some(routing(&["ship-a"]));
    c.source_routing.as_mut().unwrap().command_ids = (0..33).map(|i| format!("ship-{i}")).collect();
    assert_eq!(c.validate().unwrap_err().0, "source_routing_command_ids");
}

static NEXT: AtomicU64 = AtomicU64::new(1);
struct Isolated(Config);
impl Isolated {
    fn new() -> Self {
        let mut c = config();
        c.opensearch_url = std::env::var("PARSE_COMMAND_TEST_OPENSEARCH_URL")
            .expect("Set an isolated OpenSearch test endpoint");
        c.custody_index = format!(
            ".parse-command-test-routing-{}-{}-{}",
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
impl Drop for Isolated {
    fn drop(&mut self) {
        let _ = reqwest::blocking::Client::new()
            .delete(format!(
                "{}/{}",
                self.0.opensearch_url, self.0.custody_index
            ))
            .send();
    }
}
#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn source_routing_is_parsed_audited_and_cannot_change_under_existing_revision() {
    let mut isolated = Isolated::new();
    let c = &mut isolated.0;
    c.source_routing = Some(routing(&["ship-b", "ship-a"]));
    let mut service = Service::open(c.clone()).unwrap();
    let body = "MSGID/OPTASK GENERAL/MIL-STD-6040(SERIES)/B.1.01.12/EXAMPLE UNIT/1/20260101T120000Z/-/-/USA/UNCLASSIFIED//\nPERIOD/011200ZJAN2026/UFN//";
    let raw = format!(
        "Subject: SUBJ: Explicit routing test\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{}\r\n",
        base64::engine::general_purpose::STANDARD.encode(body)
    );
    service
        .journal
        .accept(
            c,
            Receipt {
                validity: 1,
                uid: 1,
                size: raw.len() as u32,
                raw: Some(raw.as_bytes()),
                state: "staged",
                code: None,
                received_at: "2026-01-01T12:00:00Z",
                server_received_at: Some("2026-01-01T12:00:00Z"),
            },
        )
        .unwrap();
    assert_eq!(service.process(&AtomicBool::new(false)).unwrap(), 1);
    let mut projection = Vec::new();
    service.journal.export(&mut projection).unwrap();
    let core: serde_json::Value = serde_json::from_slice(&projection).unwrap();
    assert_eq!(core["command_ids"], json!(["ship-a", "ship-b"]));
    service.journal.store.refresh().unwrap();
    let receipts = service.journal.store.list("receipt", vec![], 10).unwrap();
    let audit = receipts[0].record.payload["audit"].as_array().unwrap();
    let routing_audit = audit
        .iter()
        .find(|entry| entry["kind"] == "source_routing_applied")
        .unwrap();
    assert_eq!(routing_audit["payload"]["grants_access"], false);
    assert_eq!(routing_audit["payload"]["command_ids"], core["command_ids"]);
    drop(service);
    c.source_routing.as_mut().unwrap().command_ids.reverse();
    Service::open(c.clone()).unwrap();
    c.source_routing.as_mut().unwrap().policy_id = "changed-policy".into();
    assert_eq!(
        Journal::open(c).err().unwrap().0,
        "source_routing_revision_conflict"
    );
    c.source_routing = None;
    assert_eq!(
        Journal::open(c).err().unwrap().0,
        "source_routing_revision_conflict"
    );
}
#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn historical_unbound_mailbox_keeps_default_and_rejects_new_routing_policy() {
    let isolated = Isolated::new();
    let mut c = isolated.0.clone();
    let store = BlockingStore::new(&c.opensearch_url, &c.custody_index).unwrap();
    store.provision().unwrap();
    store.put(&Record::new("mailbox_identity", &c.account_id, json!({
        "host":c.host,"port":c.port,"username":c.username,"mailbox":c.mailbox,"revision":c.revision
    })), None).unwrap();
    c.source_routing = Some(routing(&["ship-a"]));
    assert_eq!(
        Journal::open(&c).err().unwrap().0,
        "source_routing_revision_unbound"
    );
    c.source_routing = None;
    Journal::open(&c).unwrap();
    c.source_routing = Some(routing(&["ship-a"]));
    assert_eq!(
        Journal::open(&c).err().unwrap().0,
        "source_routing_revision_conflict"
    );
}
