use parse_command_server::{
    api::Filters,
    preparation::prepare,
    presentation,
    private::{Private, timestamp},
};
use serde_json::json;
fn directory() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "parse-command-private-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&path).unwrap();
    path
}
#[test]
fn private_state_is_owner_and_revision_scoped_and_survives_reopen() {
    let dir = directory();
    let path = dir.join("ui.sqlite");
    let mut db = Private::open(&path, None).unwrap();
    db.save_draft("dev-user", "id@r1", "unsent draft").unwrap();
    assert!(
        db.draft("dev-admin", "id@r1")
            .unwrap()
            .get("draft")
            .is_none()
    );
    assert!(
        db.draft("dev-user", "id@r2")
            .unwrap()
            .get("draft")
            .is_none()
    );
    assert!(
        db.acknowledge("dev-user", "id@r1", true, false, "", "")
            .is_err()
    );
    db.acknowledge(
        "dev-user",
        "id@r1",
        true,
        true,
        "reported externally",
        "2026-11-04T10:00:00Z",
    )
    .unwrap();
    drop(db);
    let db = Private::open(&path, None).unwrap();
    assert_eq!(
        db.draft("dev-user", "id@r1").unwrap()["draft"]["text"],
        "unsent draft"
    );
    assert_eq!(
        db.preparation("dev-user", "id@r1").unwrap()["acknowledged"],
        true
    );
    assert_eq!(
        db.preparation("dev-admin", "id@r1").unwrap()["acknowledged"],
        false
    );
    drop(db);
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn sessions_are_random_revocable_and_not_saved_as_bearer_tokens() {
    let dir = directory();
    let db = Private::open(&dir.join("ui.sqlite"), None).unwrap();
    let a = db.create_session("user").unwrap();
    let b = db.create_session("user").unwrap();
    assert_ne!(a, b);
    assert_eq!(db.session(&a).unwrap(), Some("user".into()));
    let stored: String = db
        .db
        .query_row("SELECT token_hash FROM sessions LIMIT 1", [], |r| r.get(0))
        .unwrap();
    assert_ne!(stored, a);
    db.logout(&a).unwrap();
    assert_eq!(db.session(&a).unwrap(), None);
    drop(db);
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn preparation_rejects_injection_and_requires_authority() {
    assert!(prepare(r#"{"outgoing":"SHIP//INJECT"}"#, false).is_err());
    assert!(prepare(r#"{"outgoing":"A","outgoing":"B"}"#, false).is_err());
    assert!(prepare("{}", true).is_err());
    assert!(prepare(r#"{"outgoing":null}"#, false).is_err());
    let value = json!({"outgoing":"SHIP","letter":"A","type":"MSG","originator":"COMMAND","dtg":"041000ZNOV2026","authority":"OPS","family":"ACTAGCY","response":"ACK","confirmed":true});
    let (_, text) = prepare(&value.to_string(), true).unwrap();
    assert!(text.contains("MSGID/AKNLDG/SHIP//"));
    assert!(text.ends_with("ACTAGCY/OPS/ACK/A//"));
}
#[test]
fn timestamp_comparisons_and_timeline_preserve_points_and_intervals() {
    assert!(
        timestamp("2026-11-04T10:00:00.1Z").unwrap() > timestamp("2026-11-04T10:00:00Z").unwrap()
    );
    assert!(timestamp("2026-11-04").is_err());
    let source = json!({"id":"source","revision":"r1","activities":[{"id":"point","type":"crypto","at":"2026-11-04T10:00:00Z"},{"id":"range","type":"event","start_at":"2026-11-04T09:00:00Z","end_at":"2026-11-04T11:00:00Z"},{"id":"missing","type":"event","start_at":"2026-11-04T09:00:00Z"}]});
    let (items, review) = presentation::timeline(
        &source,
        &timestamp("2026-11-04T00:00:00Z").unwrap(),
        &timestamp("2026-11-05T00:00:00Z").unwrap(),
    )
    .unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["kind"], "point");
    assert!(items[0].get("end").is_none());
    assert_eq!(review.len(), 1);
    assert!(items.iter().all(|i| i["reviewRequired"] == true));
}
#[test]
fn filter_contract_rejects_unknown_fields_and_bad_intervals() {
    assert!(serde_json::from_value::<Filters>(json!({"script":"arbitrary"})).is_err());
    let f: Filters = serde_json::from_value(
        json!({"issuedFrom":"2026-11-05T00:00:00Z","issuedTo":"2026-11-04T00:00:00Z"}),
    )
    .unwrap();
    assert!(f.validate().is_err());
}
#[test]
fn migration_preserves_owners_history_and_orphans_and_is_idempotent() {
    let dir = directory();
    let legacy = dir.join("old.sqlite");
    let db = rusqlite::Connection::open(&legacy).unwrap();
    db.execute_batch("CREATE TABLE message_records(id INTEGER PRIMARY KEY,source_message_id TEXT);CREATE TABLE extracted_events(id INTEGER PRIMARY KEY,message_record_events INTEGER);CREATE TABLE event_revisions(id INTEGER PRIMARY KEY,extracted_event_revisions INTEGER);CREATE TABLE draft_acknowledgements(id INTEGER PRIMARY KEY,message_record_drafts INTEGER,owner_subject TEXT,text TEXT,status TEXT,saved_at TEXT);CREATE TABLE acknowledgement_preparations(id INTEGER PRIMARY KEY,message_record_preparations INTEGER,owner_subject TEXT,fields_json TEXT,generated_text TEXT,acknowledged INTEGER);CREATE TABLE acknowledgement_activities(id INTEGER PRIMARY KEY,message_record_acknowledgement_activities INTEGER,owner_subject TEXT,kind TEXT,note TEXT,recorded_at TEXT,occurred_at TEXT);INSERT INTO message_records VALUES(1,'old-source');INSERT INTO extracted_events VALUES(7,1);INSERT INTO event_revisions VALUES(9,7);INSERT INTO draft_acknowledgements VALUES(1,1,'dev-user','keep me','unsent','2026-11-04T10:00:00Z');INSERT INTO draft_acknowledgements VALUES(2,1,'dev-admin','admin text','unsent','2026-11-04T10:00:00Z');INSERT INTO draft_acknowledgements VALUES(3,1,'','unowned preserved','unsent','2026-11-04T10:00:00Z');INSERT INTO acknowledgement_preparations VALUES(1,1,'dev-user','{}','old generated',1);INSERT INTO acknowledgement_activities VALUES(1,1,'dev-user','acknowledged','old note','2026-11-04T10:00:00Z',NULL);").unwrap();
    drop(db);
    let path = dir.join("new/ui.sqlite");
    let db = Private::open(&path, Some(&legacy)).unwrap();
    assert_eq!(
        db.draft("dev-user", "legacy:old-source").unwrap()["draft"]["text"],
        "keep me"
    );
    assert_eq!(
        db.draft("dev-admin", "legacy:old-source").unwrap()["draft"]["text"],
        "admin text"
    );
    let prep = db.preparation("dev-user", "legacy:old-source").unwrap();
    assert_eq!(prep["generatedText"], "old generated");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(prep["historyJson"].as_str().unwrap()).unwrap()
            [0]["note"],
        "old note"
    );
    assert_eq!(
        db.legacy("legacy:old-source").unwrap()["events"][0]["revisions"][0]["id"],
        9
    );
    let orphans: i64 = db
        .db
        .query_row("SELECT count(*) FROM legacy_orphans", [], |r| r.get(0))
        .unwrap();
    assert_eq!(orphans, 1);
    drop(db);
    let db = Private::open(&path, Some(&legacy)).unwrap();
    let n: i64 = db
        .db
        .query_row("SELECT count(*) FROM activity", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1);
    drop(db);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn search_headers_expose_only_source_type_originator_and_issue_time() {
    let core = json!({"id":"internal","revision":"parser-v1","type":"OPTASK COMMS","originator":"TRAINING COMMAND","issued_at":"2008-03-31T18:00:30Z","subject":"Example","review_flags":["internal_flag"],"activities":[{"type":"example"}]});
    assert_eq!(
        presentation::message_header(&core),
        json!({"type":"OPTASK COMMS","originator":"TRAINING COMMAND","issuedAt":"2008-03-31T18:00:30Z"})
    );
    assert_eq!(
        presentation::message_header(&json!({"type":null,"issued_at":null})),
        json!({})
    );
}
