use parse_command_server::{
    api::{Filters, ReadRequest},
    pagination::{self, Sort},
    private::Private,
};
use serde_json::json;
mod support;
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn result_windows_are_bounded_owner_scoped_and_survive_reopen() {
    let store = support::store().await;
    let db = Private::new(store.clone());
    let value = json!({"kind":"search","documents":[{"id":"a"}]});
    let id = db
        .put_read_window("owner-query-sort-filter", &value)
        .await
        .unwrap();
    drop(db);
    let db = Private::new(store.clone());
    assert_eq!(
        db.read_window(&id, "owner-query-sort-filter")
            .await
            .unwrap(),
        value
    );
    assert!(db.read_window(&id, "other-owner").await.is_err());
    assert!(
        db.put_read_window("f", &json!({"oversized":"x".repeat(524289)}))
            .await
            .is_err()
    );
    for _ in 0..63 {
        db.put_read_window("f", &json!({})).await.unwrap();
    }
    assert!(db.put_read_window("f", &json!({})).await.is_err());
    db.save_draft("owner", "id@r1", "still writable")
        .await
        .unwrap();
    store
        .update("read_window", &id, |old| {
            let mut row = old.unwrap().clone();
            row.expires = 1;
            Ok(row)
        })
        .await
        .unwrap();
    assert!(
        db.read_window(&id, "owner-query-sort-filter")
            .await
            .is_err()
    );
    support::cleanup(&store).await;
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
