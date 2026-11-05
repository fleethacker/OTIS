use parse_command_server::notifications::{self, Request};
use parse_command_state::Record;
use serde_json::json;
mod support;
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn notifications_replay_without_duplicates_and_read_state_is_owner_scoped() {
    let store = support::store().await;
    let custody = support::store().await;
    for n in 1..=2 {
        let source = format!("body{n}@r1");
        let mut row = Record::new(
            "projection",
            &source,
            json!({"core":{"type":"OPTASK COMMS","originator":"EXAMPLE","subject":"Example"}}),
        );
        row.state = "published".into();
        custody.put(&row, None).await.unwrap();
        let mut event = Record::new(
            "publication_event",
            &n.to_string(),
            json!({"at":"2026-11-04T10:00:00Z"}),
        );
        event.source = source;
        event.category = "message".into();
        event.owner = n.to_string();
        event.order = n;
        event.state = "publication_succeeded".into();
        custody.put(&event, None).await.unwrap();
    }
    custody.refresh().await.unwrap();
    notifications::sync(&store, &custody).await.unwrap();
    store.refresh().await.unwrap();
    let initial = notifications::execute(&store, "one", "list", Request::default())
        .await
        .unwrap();
    assert_eq!(initial["items"].as_array().unwrap().len(), 1);
    assert_eq!(initial["items"][0]["count"], 2);
    assert_eq!(initial["unread"], 1);
    assert_eq!(initial["catchingUp"], false);
    assert_eq!(
        store
            .list("notification_id", vec![], 10)
            .await
            .unwrap()
            .len(),
        1
    );
    store
        .update("notification_cursor", "publication_event", |old| {
            let mut row = old.unwrap().clone();
            row.order = 0;
            Ok(row)
        })
        .await
        .unwrap();
    notifications::sync(&store, &custody).await.unwrap();
    store.refresh().await.unwrap();
    let repeated = notifications::execute(&store, "one", "list", Request::default())
        .await
        .unwrap();
    assert_eq!(initial, repeated);
    notifications::execute(
        &store,
        "one",
        "read",
        Request {
            through: initial["watermark"].as_i64(),
            ..Request::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        notifications::execute(&store, "one", "list", Request::default())
            .await
            .unwrap()["unread"],
        0
    );
    assert_eq!(
        notifications::execute(&store, "two", "list", Request::default())
            .await
            .unwrap()["unread"],
        1
    );
    support::cleanup(&store).await;
    support::cleanup(&custody).await;
}
