use parse_command_server::{
    notifications::{self, Request},
    private::Private,
};
use rusqlite::{Connection, params};
use serde_json::{Value, json};

struct Fixture {
    dir: std::path::PathBuf,
    journal: Connection,
    store: Private,
}
impl Fixture {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "notification-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir(&dir).unwrap();
        let journal = Connection::open(dir.join("journal.sqlite")).unwrap();
        journal.execute_batch("CREATE TABLE receipts(id TEXT PRIMARY KEY,body_id TEXT,revision TEXT,subject TEXT);CREATE TABLE custody_events(sequence INTEGER PRIMARY KEY,receipt_id TEXT,state TEXT,code TEXT,at TEXT);CREATE TABLE projections(message_id TEXT,revision TEXT,core TEXT,delivery_state TEXT,PRIMARY KEY(message_id,revision));CREATE TABLE publication_events(sequence INTEGER PRIMARY KEY,message_id TEXT,revision TEXT,stage TEXT,at TEXT,code TEXT,job_id TEXT NOT NULL DEFAULT '');").unwrap();
        let store = Private::open(&dir.join("ui.sqlite"), None).unwrap();
        Self {
            dir,
            journal,
            store,
        }
    }
    fn publish(&self, id: &str, minute: u8) {
        let at = format!("2026-11-04T12:{minute:02}:00Z");
        self.journal.execute("INSERT INTO projections VALUES(?,'r1',?,'published')",params![id,json!({"id":id,"revision":"r1","type":"EXAMPLE","subject":"Exercise traffic","originator":"TRAINING","review_flags":["time_review","geospatial_review","inferred_profile"]}).to_string()]).unwrap();
        self.journal.execute("INSERT INTO publication_events(message_id,revision,stage,at,code) VALUES(?,'r1','message',?,'publication_succeeded')",params![id,at]).unwrap();
    }
    fn sync(&mut self) -> bool {
        notifications::sync(&mut self.store.db, &self.dir.join("journal.sqlite")).unwrap()
    }
    fn list(&mut self, owner: &str) -> Value {
        notifications::execute(&mut self.store.db, owner, "list", Request::default()).unwrap()
    }
    fn mark(&mut self, owner: &str, request: Value) -> Value {
        notifications::execute(
            &mut self.store.db,
            owner,
            "read",
            serde_json::from_value(request).unwrap(),
        )
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn read_state_is_durable_private_and_snapshot_scoped_when_new_traffic_joins_a_burst() {
    let mut f = Fixture::new();
    f.publish("one", 0);
    f.publish("two", 1);
    assert!(!f.sync());
    let first = f.list("watch-one");
    assert_eq!(first["items"].as_array().unwrap().len(), 1);
    assert_eq!(first["items"][0]["count"], 2);
    let id = first["items"][0]["id"].clone();
    let version = first["items"][0]["version"].clone();
    f.mark("watch-one", json!({"id":id,"version":version}));
    assert_eq!(f.list("watch-one")["unread"], 0);
    assert_eq!(f.list("watch-two")["unread"], 1);
    f.publish("three", 2);
    f.sync();
    assert_eq!(f.list("watch-one")["unread"], 1);
    f.mark("watch-one", json!({"through":first["watermark"]}));
    assert_eq!(
        f.list("watch-one")["unread"],
        1,
        "bulk read must not consume arrivals after the displayed snapshot"
    );
    let latest = f.list("watch-one");
    f.mark("watch-one", json!({"through":latest["watermark"]}));
    f.store = Private::open(&f.dir.join("ui.sqlite"), None).unwrap();
    f.sync();
    assert_eq!(f.list("watch-one")["unread"], 0);
    assert_eq!(f.list("watch-two")["items"][0]["count"], 3);
    let members = notifications::execute(
        &mut f.store.db,
        "watch-one",
        "members",
        serde_json::from_value(json!({"id":id})).unwrap(),
    )
    .unwrap();
    assert_eq!(members["items"].as_array().unwrap().len(), 3);
    assert!(
        notifications::execute(
            &mut f.store.db,
            "watch-one",
            "read",
            serde_json::from_value(json!({"through":999999})).unwrap()
        )
        .is_err()
    );
    assert!(serde_json::from_value::<Request>(json!({"owner":"another-user"})).is_err());
    f.journal.execute_batch("INSERT INTO projections SELECT message_id,'r2',core,'published' FROM projections WHERE message_id='one'; INSERT INTO publication_events(message_id,revision,stage,at,code) VALUES('one','r2','message','2026-11-04T12:30:00Z','publication_succeeded');").unwrap();
    f.sync();
    assert_eq!(
        f.list("watch-one")["unread"],
        0,
        "reinterpreting the same body is not new traffic"
    );
}
#[test]
fn actual_failure_recovery_and_replay_do_not_turn_interpretation_flags_into_alerts() {
    let mut f = Fixture::new();
    f.publish("one", 3);
    f.journal.execute_batch("INSERT INTO receipts VALUES('receipt','one','r1','Exercise');
        INSERT INTO custody_events VALUES(1,'receipt','staged',NULL,'2026-11-04T12:00:00Z'),(2,'receipt','retrying','journal_io','2026-11-04T12:00:01Z'),(3,'receipt','retrying','journal_io','2026-11-04T12:00:02Z'),(4,'receipt','parsed',NULL,'2026-11-04T12:00:03Z');").unwrap();
    f.sync();
    f.sync();
    let page = f.list("watch");
    let items = page["items"].as_array().unwrap();
    assert_eq!(items.len(), 3);
    assert_eq!(items.iter().filter(|i| i["kind"] == "failed").count(), 1);
    assert_eq!(items.iter().filter(|i| i["kind"] == "recovered").count(), 1);
    let failed = items.iter().find(|i| i["kind"] == "failed").unwrap();
    assert_eq!(failed["detail"], "Message storage failed");
    assert!(
        failed["resolvedAt"]
            .as_str()
            .unwrap()
            .starts_with("2026-11-04T12:00:03")
    );
    assert!(!page.to_string().contains("review"));
    f.mark("watch", json!({"through":page["watermark"]}));
    assert_eq!(
        f.journal
            .query_row("SELECT count(*) FROM custody_events", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        4
    );
    assert_eq!(
        f.store
            .db
            .query_row("SELECT count(*) FROM preparations", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[test]
fn publication_retries_coalesce_and_only_recorded_success_recovers_them() {
    let mut f = Fixture::new();
    f.journal.execute_batch("INSERT INTO publication_events VALUES(1,'body','r1','enrich','2026-11-04T12:00:01Z','publication_item_failed','job1'),(2,'body','r1','enrich','2026-11-04T12:00:02Z','publication_batch_failed','job1');").unwrap();
    f.sync();
    assert_eq!(f.list("watch")["items"].as_array().unwrap().len(), 1);
    f.journal.execute_batch("INSERT INTO publication_events VALUES(3,'body','r1','enrich','2026-11-04T12:00:03Z','publication_succeeded','job1');").unwrap();
    f.sync();
    let page = f.list("watch");
    assert_eq!(page["items"].as_array().unwrap().len(), 2);
    assert_eq!(page["items"][0]["kind"], "recovered");
    assert_eq!(page["items"][1]["detail"], "Embedding failed");
    f.journal.execute_batch("INSERT INTO publication_events VALUES(4,'body','r1','enrich','2026-11-04T12:00:04Z','publication_item_failed','job2'),(5,'body','r1','enrich','2026-11-04T12:00:05Z','publication_succeeded','job1');").unwrap();
    f.sync();
    let current = f.list("watch");
    assert_eq!(current["items"][0]["kind"], "failed");
    assert!(
        current["items"][0]["resolvedAt"].is_null(),
        "a different job succeeding cannot resolve this failure"
    );
}
#[test]
fn empty_feed_has_no_reminders_and_pages_are_bounded() {
    let mut f = Fixture::new();
    f.sync();
    assert!(f.list("watch")["items"].as_array().unwrap().is_empty());
    for n in 0..22 {
        f.publish(&format!("message{n}"), (n * 2) % 60);
    }
    f.sync();
    // More than one five-minute burst, but never one alert for every message.
    assert!(f.list("watch")["items"].as_array().unwrap().len() < 22);
    for n in 0..25 {
        f.journal.execute("INSERT INTO publication_events(message_id,revision,stage,at,code) VALUES(?,'r1','message','2026-11-04T12:30:00Z','failed')",[format!("failed{n}")]).unwrap();
    }
    f.sync();
    let page = f.list("watch");
    assert_eq!(page["items"].as_array().unwrap().len(), 20);
    assert!(page["nextBefore"].is_number());
    let older = notifications::execute(
        &mut f.store.db,
        "watch",
        "list",
        serde_json::from_value(json!({"before":page["nextBefore"]})).unwrap(),
    )
    .unwrap();
    assert!(older["items"].as_array().unwrap().iter().all(|i| {
        !page["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == i["id"])
    }));
}
