use parse_command_server::changes::{read_connection, Filters, Request};
use rusqlite::{Connection, params};
use serde_json::{json, Value};

fn db() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE projections(message_id TEXT,revision TEXT,core TEXT,delivery_state TEXT); CREATE TABLE receipts(sequence INTEGER PRIMARY KEY,id TEXT,body_id TEXT,revision TEXT,received_at TEXT,subject TEXT)").unwrap();
    db
}
fn add(db: &Connection, name: &str, sequence: Option<i64>, at: Option<&str>, commands: &[&str]) -> String {
    let id = parse_command_types::message_id(name);
    let core = json!({"subject":format!("Fictional {name}"),"type":"OPTASK COMMS","command_ids":commands,"issued_at":at});
    db.execute("INSERT INTO projections VALUES(?,'r1',?,'published')", params![id,core.to_string()]).unwrap();
    if let Some(sequence) = sequence {
        db.execute("INSERT INTO receipts VALUES(?,?,?,'r1',?,?)", params![sequence,format!("receipt-{sequence}"),id,at,format!("Fictional {name}")]).unwrap();
    }
    id
}
fn request() -> Request {
    Request { since: "2026-11-05T04:00:00Z".into(), until: "2026-11-05T08:00:00Z".into(), filters: Filters::default(), before: None, watermark: None }
}
#[test]
fn boundaries_hidden_records_and_unknown_times_are_distinct() {
    let db = db();
    let exact = add(&db, "exact boundary", Some(1), Some("2026-11-05T04:00:00Z"), &["demo-tern"]);
    add(&db, "hidden", Some(2), Some("2026-11-05T07:00:00Z"), &["demo-halyard"]);
    add(&db, "upper excluded", Some(3), Some("2026-11-05T08:00:00Z"), &[]);
    add(&db, "before excluded", Some(4), Some("2026-11-05T03:59:59Z"), &[]);
    add(&db, "unknown timestamp", None, None, &[]);
    let mut request = request();
    request.filters.command_ids = vec!["demo-tern".into()];
    let result = read_connection(&db, &request).unwrap();
    assert_eq!(result["returnedNewCount"], 2);
    assert_eq!(result["hiddenCount"], 1);
    assert_eq!(result["items"][0]["id"], exact);
    assert_eq!(result["items"][0]["basis"], "source_issue_time");
    assert_eq!(result["unknownHiddenCount"], 1);
    assert_eq!(result["availability"]["amended"], "not_available");
    assert_eq!(result["availability"]["cancelled"], "not_available");
    request.filters = Filters::default();
    request.since = "2026-11-05T04:00:00.001Z".into();
    let result = read_connection(&db, &request).unwrap();
    assert_eq!(result["returnedNewCount"], 1); // exact 0400 is now before the lower bound
    assert_eq!(result["unknownTime"].as_array().unwrap().len(), 1);
    assert_eq!(result["unknownTime"][0]["issuedAt"], Value::Null);
    request.filters.no_commands = true;
    let result = read_connection(&db, &request).unwrap();
    assert_eq!(result["items"], json!([]));
    assert_eq!(result["hiddenCount"], 1);
}
#[test]
fn exact_comparison_does_not_round_submillisecond_receipt_times_into_the_window() {
    let db = db();
    add(&db, "before precise boundary", Some(1), Some("2026-11-05T04:00:00.0006Z"), &[]);
    let exact = add(&db, "at precise boundary", Some(2), Some("2026-11-05T04:00:00.001Z"), &["demo-tern", "demo-halyard"]);
    let mut request = request(); request.since = "2026-11-05T04:00:00.001Z".into();
    request.filters.command_ids = vec!["demo-tern".into()];
    let result = read_connection(&db, &request).unwrap();
    assert_eq!(result["returnedNewCount"], 1);
    assert_eq!(result["hiddenCount"], 0);
    assert_eq!(result["items"][0]["id"], exact);
    assert_eq!(result["items"][0]["commandIds"], json!(["demo-tern", "demo-halyard"]));
}
#[test]
fn duplicate_receipts_and_parser_revisions_do_not_create_new_custody_records() {
    let db = db();
    let id = add(&db, "old body", Some(1), Some("2026-11-05T03:00:00Z"), &[]);
    db.execute("INSERT INTO receipts VALUES(2,'duplicate',?,'r2','2026-11-05T06:00:00Z','Later subject')", [&id]).unwrap();
    db.execute("INSERT INTO projections VALUES(?,'r2',?,'published')", params![id,json!({"type":"OPTASK COMMS","command_ids":[],"issued_at":"2026-11-05T03:00:00Z"}).to_string()]).unwrap();
    assert_eq!(read_connection(&db, &request()).unwrap()["returnedNewCount"], 0);
    let mut scope = request(); scope.since = "2026-11-05T02:00:00Z".into();
    let value = read_connection(&db, &scope).unwrap();
    assert_eq!(value["items"][0]["messageKey"], format!("{id}@r1")); // first receipt's actual revision
    db.execute("DELETE FROM projections WHERE revision='r1'", []).unwrap();
    assert_eq!(read_connection(&db, &scope).unwrap()["items"][0]["messageKey"], Value::Null);
}
#[test]
fn bounded_pages_keep_a_receipt_watermark_and_reject_invalid_requests() {
    let db = db();
    for sequence in 1..=201 { add(&db, &format!("page-{sequence}"), Some(sequence), Some("2026-11-05T04:00:00Z"), &[]); }
    let mut request = request();
    let first = read_connection(&db, &request).unwrap();
    assert_eq!(first["items"].as_array().unwrap().len(), 200);
    request.before = first["nextBefore"].as_i64();
    request.watermark = first["watermark"].as_i64();
    add(&db, "later arrival", Some(202), Some("2026-11-05T07:00:00Z"), &[]);
    let next = read_connection(&db, &request).unwrap();
    assert_eq!(next["items"].as_array().unwrap().len(), 1);
    assert_eq!(next["nextBefore"], Value::Null);
    request.until = request.since.clone();
    assert!(read_connection(&db, &request).is_err());
    assert!(serde_json::from_str::<Request>(r#"{"since":"2026-11-05T04:00:00Z","until":"2026-11-05T08:00:00Z","actor":"spoof"}"#).is_err());
}
#[test]
fn sent_time_not_receipt_time_places_and_orders_messages() {
    let db = db();
    // Sent 0500Z but received after the window; sent before the window but received inside it.
    let late = add(&db, "sent in window", Some(1), Some("2026-11-05T05:00:00Z"), &[]);
    db.execute("UPDATE receipts SET received_at='2026-11-05T09:30:00Z' WHERE sequence=1", []).unwrap();
    add(&db, "sent before window", Some(2), Some("2026-11-05T02:00:00Z"), &[]);
    db.execute("UPDATE receipts SET received_at='2026-11-05T06:00:00Z' WHERE sequence=2", []).unwrap();
    let newest = add(&db, "sent later", Some(3), Some("2026-11-05T07:00:00Z"), &[]);
    let result = read_connection(&db, &request()).unwrap();
    assert_eq!(result["returnedNewCount"], 2);
    assert_eq!(result["items"][0]["id"], newest);
    assert_eq!(result["items"][1]["id"], late);
    assert_eq!(result["items"][1]["issuedAt"], "2026-11-05T05:00:00.000000000Z");
    assert_eq!(result["items"][1]["recordedAt"], "2026-11-05T09:30:00.000000000Z");
}
mod support;
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn custody_store_reads_published_projections_for_turnover_and_suggestions() {
    let store = support::store().await;
    let raw = "MSGID/FICTIONAL//\nEXER/FICTIONAL COPPER//";
    let id = parse_command_types::message_id(raw);
    let start = raw.find("FICTIONAL COPPER").unwrap();
    let field = json!({"position":1,"raw_text":"FICTIONAL COPPER","start_byte":start,"end_byte":start+16});
    let audits: Vec<Value> = [
        ("source_preserved", json!({"source":{"raw_text":raw,"sha256":id.trim_start_matches("sha256:")}})),
        ("parse_completed", json!({"profile":"observed-optask-extensions-v1","records":[{"set_id":"EXER","fields":[field]}]})),
    ].into_iter().map(|(kind, payload)| json!({"id":parse_command_types::event_id(&[&id, kind]),"kind":kind,"recorded_at":"2026-11-05T05:00:00Z","payload":payload})).collect();
    for (key, state, order) in [(format!("{id}@r1"), "published", 3), ("sha256:pending@r1".to_owned(), "pending", 4)] {
        let mut row = Record::new("projection", &key, json!({"core":{"id":id,"revision":"r1","subject":"Fictional copper","command_ids":["demo-tern"],"issued_at":"2026-11-05T05:00:00Z"},"audits":audits,"first_receipt":"receipt-3","selected_received_at":"2026-11-05T05:01:00Z"}));
        row.state = state.into();
        row.order = order;
        store.put(&row, None).await.unwrap();
    }
    store.refresh().await.unwrap();
    let value = parse_command_server::changes::read(&store, &request()).await.unwrap();
    assert_eq!(value["returnedNewCount"], 1);
    assert_eq!(value["watermark"], 3); // pending projections are not custody evidence yet
    assert_eq!(value["items"][0]["messageKey"], format!("{id}@r1"));
    assert_eq!(value["items"][0]["recordedAt"], "2026-11-05T05:01:00.000000000Z");
    let metadata = parse_command_server::context_metadata::read(&store).await.unwrap();
    assert_eq!(metadata.suggestions.len(), 1);
    assert_eq!(metadata.suggestions[0].sources[0].line_start, 2);
    support::cleanup(&store).await;
}
