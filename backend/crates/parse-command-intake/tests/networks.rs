use parse_command_intake::{config::Config, journal::Receipt, network::Network, service::Service};
use serde_json::json;
use std::sync::atomic::AtomicBool;

#[test]
#[ignore = "requires isolated OpenSearch test indices"]
fn two_mailboxes_preserve_arrival_and_explicit_command_context() {
    let mut high = Config::load(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/demo-intake.json")).unwrap();
    high.opensearch_url = std::env::var("PARSE_COMMAND_TEST_OPENSEARCH_URL").unwrap();
    high.custody_index = format!(".parse-command-test-networks-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
    high.account_id = "fictional-high".into();
    high.arrival_network = Some(Network::High);
    high.demo_command_ids = vec!["USS Meridian".into()];
    let mut low = high.clone();
    low.account_id = "fictional-low".into();
    low.arrival_network = Some(Network::Low);
    let body = "MSGID/OPTASK GENERAL/MIL-STD-6040(SERIES)/B.1.01.12/FICTIONAL DESK/1/20261105T120000Z/-/-/USA/UNCLASSIFIED//\nPERIOD/051200ZNOV2026/UFN//";
    let raw = format!("Subject: SUBJ: Fictional only\r\nX-Demo-Command-IDs: USS Meridian\r\nMMHS-Primary-Precedence: IMMEDIATE\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}");
    for config in [&high, &low] {
        let mut service = Service::open(config.clone()).unwrap();
        service.journal.accept(config, Receipt { validity: 1, uid: 1, size: raw.len() as u32, raw: Some(raw.as_bytes()), state: "staged", code: None, received_at: "2026-11-05T14:12:00Z", server_received_at: Some("2026-11-05T14:12:00Z") }).unwrap();
        service.process(&AtomicBool::new(false)).unwrap();
    }
    let service = Service::open(high.clone()).unwrap();
    service.journal.store.refresh().unwrap();
    let projections = service.journal.store.list("projection", vec![], 10).unwrap();
    assert_eq!(projections.len(), 1);
    let row = &projections[0].record;
    assert_eq!(row.payload["core"]["command_ids"], json!(["USS Meridian"]));
    assert_eq!(row.payload["arrivals"]["HIGH"]["precedence"], "IMMEDIATE");
    assert!(row.flags.contains(&"arrival:LOW".into()));
    assert!(row.flags.contains(&"arrival:HIGH".into()));
    let receipts = service.journal.store.list("receipt", vec![], 10).unwrap();
    assert_eq!(receipts.len(), 2);
    assert_ne!(receipts[0].record.payload["arrival_network"], receipts[1].record.payload["arrival_network"]);
    drop(service);
    let mut changed = high.clone();
    changed.arrival_network = Some(Network::Low);
    assert_eq!(Service::open(changed).err().unwrap().0, "journal_identity_changed");
    reqwest::blocking::Client::new().delete(format!("{}/{}", high.opensearch_url, high.custody_index)).send().unwrap().error_for_status().unwrap();
}
