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
    let core = json!({"subject":format!("Fictional {name}"),"type":"OPTASK COMMS","command_ids":commands});
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
    assert_eq!(result["items"][0]["basis"], "first_custody_recording");
    assert_eq!(result["unknownHiddenCount"], 1);
    assert_eq!(result["availability"]["amended"], "not_available");
    assert_eq!(result["availability"]["cancelled"], "not_available");
    request.filters = Filters::default();
    request.since = "2026-11-05T04:00:00.001Z".into();
    let result = read_connection(&db, &request).unwrap();
    assert_eq!(result["returnedNewCount"], 1); // exact 0400 is now before the lower bound
    assert_eq!(result["unknownTime"].as_array().unwrap().len(), 1);
    assert_eq!(result["unknownTime"][0]["recordedAt"], Value::Null);
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
    db.execute("INSERT INTO projections VALUES(?,'r2',?,'published')", params![id,json!({"type":"OPTASK COMMS","command_ids":[]}).to_string()]).unwrap();
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
