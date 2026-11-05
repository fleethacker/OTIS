use parse_command_intake::{config::Config, journal::Receipt, network::Network, service::Service};
use serde_json::json;
use std::sync::atomic::AtomicBool;

#[test]
fn committed_fictional_mail_uses_explicit_envelope_metadata_and_parses() {
    use parse_command_core::{ParserHost, Registry};
    use parse_command_intake::{mime, network::{self, Precedence}};
    use parse_command_parser_api::{DecodedMessage, ParseContext, WorkBudget};
    let config = Config::load(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/xnet-high.json")).unwrap();
    let registry = Registry::new(vec![Box::new(parse_command_optask::OptaskParser)], config.enabled_types.iter().cloned().collect()).unwrap();
    let host = ParserHost::new(registry, config.parser).unwrap();
    let examples: [(&[u8], Option<Precedence>); 4] = [
        (include_bytes!("../../../config/xnet-fixtures/high-01.eml"), Some(Precedence::Priority)),
        (include_bytes!("../../../config/xnet-fixtures/high-02.eml"), Some(Precedence::Immediate)),
        (include_bytes!("../../../config/xnet-fixtures/high-03-unstated.eml"), None),
        (include_bytes!("../../../config/xnet-fixtures/low-01.eml"), Some(Precedence::Routine)),
    ];
    for (raw, precedence) in examples {
        let email = mime::decode(raw, config.mime).unwrap();
        let envelope = network::envelope(raw, config.mime, &config.demo_command_ids).unwrap();
        assert_eq!(envelope.precedence, precedence);
        let cancelled = AtomicBool::new(false);
        let budget = WorkBudget::new(config.parser_work_units, &cancelled);
        let at = parse_command_types::UtcTimestamp::new("2026-11-05T14:12:00Z").unwrap();
        let context = ParseContext { revision: &config.revision, recorded_at: &at, command_ids: &envelope.command_ids, security_override: None, reference_time: None, budget: &budget };
        let parsed = host.parse(DecodedMessage { body: &email.body, subject: email.subject.as_deref() }, &context).unwrap();
        assert_eq!(parsed.core.get().command_ids, ["USS Meridian"]);
        assert_eq!(parsed.core.get().activities.len(), 1);
        assert_eq!(parsed.core.get().activities[0].at.as_ref().unwrap().as_str(), match precedence { Some(Precedence::Priority) => "2026-11-05T16:00:00Z", Some(Precedence::Immediate) => "2026-11-05T17:00:00Z", Some(Precedence::Routine) => "2026-11-05T15:00:00Z", _ => "2026-11-05T18:00:00Z" });
    }
}

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
