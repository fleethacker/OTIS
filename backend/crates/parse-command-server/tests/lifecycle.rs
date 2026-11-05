use parse_command_server::lifecycle;
use rusqlite::Connection;
use serde_json::json;
#[test]
fn custody_timeline_retains_failures_after_recovery_and_scopes_to_exact_body_revision() {
    let path = std::env::temp_dir().join(format!(
        "lifecycle-{}-{}.sqlite",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE receipts(id TEXT,body_id TEXT,revision TEXT);CREATE TABLE custody_events(sequence INTEGER PRIMARY KEY,receipt_id TEXT,state TEXT,code TEXT,at TEXT);CREATE TABLE publication_jobs(kind TEXT,id TEXT,source TEXT,state TEXT,published_at TEXT);
    INSERT INTO receipts VALUES('one','body','r1'),('two','other','r1'),('old','body','r0');
    INSERT INTO custody_events VALUES(8,'one','staged',NULL,'2026-11-04T12:00:00Z'),(9,'one','retrying','journal_io','2026-11-04T12:00:01Z'),(10,'one','parsed',NULL,'2026-11-04T12:00:01Z'),(4,'two','quarantined','other_error','2026-11-04T12:00:01Z'),(5,'old','quarantined','old_error','2026-11-04T12:00:01Z');
    INSERT INTO publication_jobs VALUES('message','body:r1','{\"id\":\"body\",\"revision\":\"r1\"}','published','2026-11-04T12:00:04Z');").unwrap();
    lifecycle::initialize(&db).unwrap();
    lifecycle::publication_failure(
        &db,
        "message",
        &json!({"id":"body","revision":"r1"}).to_string(),
        "publication_item_failed",
    )
    .unwrap();
    let result = lifecycle::read(&path, "body", "r1").unwrap();
    let entries = result["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 5);
    assert_eq!(entries[0]["milestone"], "ingested");
    assert_eq!(entries[1]["milestone"], "ingest_failed");
    assert_eq!(entries[1]["detail"], "journal_io");
    assert!(entries.iter().any(|e| e["milestone"] == "indexed"));
    assert!(
        entries
            .iter()
            .any(|e| e["detail"] == "Message indexing failed")
    );
    assert!(!result.to_string().contains("other_error"));
    assert!(!result.to_string().contains("old_error"));
    assert!(!result.to_string().contains("acknowledgement_sent"));
    assert_eq!(result["limited"], false);
    drop(db);
    std::fs::remove_file(path).unwrap();
}
