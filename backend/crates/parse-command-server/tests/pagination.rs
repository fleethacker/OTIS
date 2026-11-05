use parse_command_server::{
    api::{Filters, ReadRequest},
    pagination::{self, Sort},
    private::Private,
};
use serde_json::json;
fn directory() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "parse-command-pagination-{}-{}",
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
fn query_bound_windows_survive_restart_reject_other_queries_and_expire() {
    let dir = directory();
    let path = dir.join("private.sqlite");
    let db = Private::open(&path, None).unwrap();
    let value = json!({"kind":"search","documents":[{"id":"a"},{"id":"b"}]});
    let id = db
        .put_read_window("owner-query-sort-filter", &value)
        .unwrap();
    drop(db);
    let db = Private::open(&path, None).unwrap();
    assert_eq!(
        db.read_window(&id, "owner-query-sort-filter").unwrap(),
        value
    );
    assert!(db.read_window(&id, "other-owner").is_err());
    assert!(db.read_window(&id, "other-query-sort-filter").is_err());
    db.db
        .execute("UPDATE read_windows SET expires=0", [])
        .unwrap();
    assert!(db.read_window(&id, "owner-query-sort-filter").is_err());
    assert!(
        db.save_read_window(&id, "owner-query-sort-filter", &value)
            .is_err()
    );
    drop(db);
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn result_windows_have_explicit_count_and_byte_bounds_without_blocking_private_drafts() {
    let dir = directory();
    let mut db = Private::open(&dir.join("private.sqlite"), None).unwrap();
    assert!(
        db.put_read_window("f", &json!({"oversized":"x".repeat(524289)}))
            .is_err()
    );
    for _ in 0..64 {
        db.put_read_window("f", &json!({})).unwrap();
    }
    assert!(db.put_read_window("f", &json!({})).is_err());
    db.save_draft("owner", "source@revision", "private draft")
        .unwrap();
    assert_eq!(
        db.draft("owner", "source@revision").unwrap()["draft"]["text"],
        "private draft"
    );
    drop(db);
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn date_sort_orders_the_complete_window_with_unknown_times_last_and_preserves_relevance() {
    let original = vec![
        json!({"id":"b","revision":"r1","issued_at":"2009-01-01T00:00:00Z"}),
        json!({"id":"missing","revision":"r1","issued_at":null}),
        json!({"id":"a","revision":"r1","issued_at":"2008-01-01T00:00:00Z"}),
    ];
    let mut docs = original.clone();
    pagination::sort_documents(&mut docs, Sort::Relevance).unwrap();
    assert_eq!(docs, original);
    pagination::sort_documents(&mut docs, Sort::IssuedAsc).unwrap();
    assert_eq!(
        docs.iter()
            .map(|v| v["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["a", "b", "missing"]
    );
    pagination::sort_documents(&mut docs, Sort::IssuedDesc).unwrap();
    assert_eq!(
        docs.iter()
            .map(|v| v["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["b", "a", "missing"]
    );
}
#[test]
fn pagination_tokens_and_metadata_are_bounded_and_filters_are_literal() {
    let id = "a".repeat(64);
    let token = pagination::token(&id, 1);
    assert_eq!(pagination::split_token(&token).unwrap(), (id.as_str(), 1));
    for bad in ["bad@1", &format!("{}@10001", id), &format!("{}@-1", id)] {
        assert!(pagination::split_token(bad).is_err());
    }
    let meta = pagination::metadata(&id, 0, 27, "eq", true, "records");
    assert_eq!(meta["pageSize"], 20);
    assert_eq!(meta["totalPages"], 2);
    assert!(meta["previousPageToken"].is_null());
    let filter: Filters =
        serde_json::from_value(json!({"originators":["CCG 7"],"messageTypes":["OPTASK COMMS"]}))
            .unwrap();
    let clauses = filter.validate().unwrap();
    assert!(
        clauses
            .as_array()
            .unwrap()
            .contains(&json!({"terms":{"originator":["CCG 7"]}}))
    );
    assert!(serde_json::from_value::<ReadRequest>(json!({"sort":"arbitrary_script"})).is_err());
}
