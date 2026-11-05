use parse_command_server::{api::role_identity, settings, xnet::{self, model::DeskNetwork, Request}};
use parse_command_state::{Record, Store};
use serde_json::{Value, json};
mod support;

async fn projection(store: &Store, key: &str, network: &str, ships: &[&str], precedence: Value) {
    let (id, revision) = key.split_once('@').unwrap();
    let mut row = Record::new("projection", key, json!({"core":{"id":id,"revision":revision,"command_ids":ships,"subject":"Must never reach LOW","originator":"Fictional sender","activities":[{"title":"Hidden event"}]},"arrivals":{network:{"received_at":"2026-11-05T14:12:00Z","precedence":precedence,"command_ids":ships}}}));
    row.state = "published".into(); row.flags.push(format!("arrival:{network}"));
    store.put(&row, None).await.unwrap();
}
async fn preference(store: &Store, owner: &str, network: DeskNetwork) {
    store.update("user", owner, |old| {
        let mut row = old.cloned().unwrap_or_else(|| Record::new("user", owner, json!({})));
        row.payload["deskNetwork"] = json!(network); Ok(row)
    }).await.unwrap();
}
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn published_high_aggregates_per_ship_and_clears_only_after_high_or_all_opens() {
    let store = support::store().await;
    let custody = support::store().await;
    let mut low = role_identity("viewer").unwrap(); low.owner = "low-user".into();
    let mut high = role_identity("viewer").unwrap(); high.owner = "high-user".into();
    preference(&store, &low.owner, DeskNetwork::Low).await;
    preference(&store, &high.owner, DeskNetwork::High).await;
    projection(&custody, "one@r1", "HIGH", &["USS Meridian", "USS Example (fictional)"], json!("IMMEDIATE")).await;
    projection(&custody, "two@r1", "HIGH", &["USS Meridian"], Value::Null).await;
    projection(&custody, "low@r1", "LOW", &["USS Meridian"], json!("FLASH")).await;
    projection(&custody, "unassigned@r1", "HIGH", &[], json!("FLASH")).await;
    for key in ["one@r1", "two@r1", "low@r1", "unassigned@r1", "one@r1"] { xnet::register(&store, &custody, key).await.unwrap(); }
    store.refresh().await.unwrap(); custody.refresh().await.unwrap();
    let list = xnet::list(&store, &low.owner).await.unwrap();
    assert_eq!(list["items"].as_array().unwrap().len(), 2);
    assert!(!list.to_string().contains("Must never")); assert!(!list.to_string().contains("one@r1"));
    let item = list["items"].as_array().unwrap().iter().find(|i| i["payload"]["shipId"] == "USS Meridian").unwrap();
    assert_eq!(item["payload"]["count"], 2);
    assert_eq!(item["payload"]["highestPrecedence"], "IMMEDIATE");
    assert_eq!(xnet::list(&store, &high.owner).await.unwrap()["items"], json!([]));
    let request: Request = serde_json::from_value(json!({"shipId":"USS Meridian","id":item["id"],"version":item["version"]})).unwrap();
    xnet::acknowledge(&store, &low, &request).await.unwrap();
    let mut other = low.clone(); other.owner = "another-viewer".into();
    xnet::acknowledge(&store, &other, &request).await.unwrap();
    let details = xnet::message(&store, &custody, &high.owner, "one@r1").await.unwrap();
    let meridian = details["items"].as_array().unwrap().iter().find(|i| i["shipId"] == "USS Meridian").unwrap();
    assert_eq!(meridian["acknowledgements"].as_array().unwrap().len(), 2);
    assert_eq!(xnet::opened(&store, &custody, &low, "one@r1").await.unwrap()["copied"], false);
    xnet::opened(&store, &custody, &high, "one@r1").await.unwrap();
    let after = xnet::list(&store, &low.owner).await.unwrap();
    let meridian = after["items"].as_array().unwrap().iter().find(|i| i["payload"]["shipId"] == "USS Meridian").unwrap();
    assert!(meridian["clearedAt"].is_null()); assert_eq!(meridian["payload"]["count"], 1);
    assert_eq!(meridian["payload"]["highestPrecedence"], "not stated");
    preference(&store, &high.owner, DeskNetwork::All).await;
    xnet::opened(&store, &custody, &high, "two@r1").await.unwrap();
    xnet::register(&store, &custody, "one@r1").await.unwrap();
    store.refresh().await.unwrap();
    let cleared = xnet::list(&store, &low.owner).await.unwrap();
    assert!(cleared["items"].as_array().unwrap().iter().all(|i| i["clearedAt"].is_string()));
    projection(&custody, "three@r1", "HIGH", &["USS Meridian"], json!("ROUTINE")).await;
    xnet::register(&store, &custody, "three@r1").await.unwrap(); store.refresh().await.unwrap();
    let history = xnet::list(&store, &low.owner).await.unwrap();
    assert_eq!(history["items"].as_array().unwrap().len(), 3);
    assert_eq!(history["items"].as_array().unwrap().iter().filter(|i| i["clearedAt"].is_null()).count(), 1);
    let mut filters = json!([]);
    xnet::view::apply(&store, &custody, &low.owner, &mut filters).await.unwrap();
    assert!(filters.to_string().contains("low")); assert!(!filters.to_string().contains("one"));
    let mut filters = json!([]);
    xnet::view::apply(&store, &custody, &high.owner, &mut filters).await.unwrap();
    assert_eq!(filters, json!([]));
    support::cleanup(&store).await; support::cleanup(&custody).await;
}
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn desk_filters_both_message_and_passage_queries_and_the_ordinary_bell() {
    use parse_command_server::notifications;
    let store = support::store().await;
    let custody = support::store().await;
    projection(&custody, "high@r1", "HIGH", &["USS Meridian"], json!("IMMEDIATE")).await;
    projection(&custody, "low@r1", "LOW", &["USS Meridian"], json!("ROUTINE")).await;
    for (n, key) in [(1, "high@r1"), (2, "low@r1")] {
        let mut event = Record::new("publication_event", &n.to_string(), json!({"at":"2026-11-05T14:12:00Z"}));
        event.source = key.into(); event.category = "message".into(); event.owner = key.into(); event.state = "publication_succeeded".into(); event.order = n;
        custody.put(&event, None).await.unwrap();
    }
    custody.refresh().await.unwrap();
    notifications::sync(&store, &custody).await.unwrap(); store.refresh().await.unwrap();
    preference(&store, "low-watch", DeskNetwork::Low).await;
    preference(&store, "high-watch", DeskNetwork::High).await;
    let low = notifications::execute(&store, "low-watch", "list", notifications::Request::default()).await.unwrap();
    let high = notifications::execute(&store, "high-watch", "list", notifications::Request::default()).await.unwrap();
    assert_eq!(low["items"].as_array().unwrap().len(), 1);
    assert_eq!(low["items"][0]["messageKey"], "low@r1");
    assert_eq!(high["items"][0]["messageKey"], "high@r1");
    assert!(notifications::execute(&store, "low-watch", "members", notifications::Request { id: high["items"][0]["id"].as_i64(), ..Default::default() }).await.is_err());

    // A unique disposable index verifies the same filter against both shapes;
    // never create or overwrite the application's fixed source aliases in tests.
    let index = format!("{}-view", store.index());
    let (status, _) = store.request(reqwest::Method::PUT, &format!("/{index}"), Some(json!({"settings":{"index.hidden":true,"number_of_shards":1,"number_of_replicas":0},"mappings":{"dynamic":"strict","properties":{"id":{"type":"keyword"},"message_id":{"type":"keyword"},"revision":{"type":"keyword"}}}}))).await.unwrap();
    assert!(status.is_success());
    for network in ["high", "low"] {
        for shape in ["message", "passage"] {
            let mut source = json!({"id":network,"revision":"r1"});
            if shape == "passage" { source["id"] = json!(format!("passage-{network}")); source["message_id"] = json!(network); }
            let (status, _) = store.request(reqwest::Method::PUT, &format!("/{index}/_doc/{network}-{shape}?refresh=true"), Some(source)).await.unwrap();
            assert!(status.is_success());
        }
    }
    for (owner, expected) in [("low-watch", "low"), ("high-watch", "high")] {
        let mut filters = json!([]);
        xnet::view::apply(&store, &custody, owner, &mut filters).await.unwrap();
        let (status, result) = store.request(reqwest::Method::POST, &format!("/{index}/_search"), Some(json!({"size":10,"query":{"bool":{"filter":filters}}}))).await.unwrap();
        assert!(status.is_success());
        let hits = result["hits"]["hits"].as_array().unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|h| h["_id"].as_str().unwrap().starts_with(expected)));
    }
    store.request(reqwest::Method::DELETE, &format!("/{index}"), None).await.unwrap();
    support::cleanup(&store).await; support::cleanup(&custody).await;
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn publication_cursor_replay_and_viewer_ownership_are_enforced_at_http_boundary() {
    use axum::{body::Body, http::{Request as HttpRequest, StatusCode}};
    use tower::ServiceExt;
    let app = support::app().await;
    let store = &app.private.state;
    let viewer = role_identity("viewer").unwrap();
    settings::ensure_demo_user(store, &viewer).await.unwrap();
    projection(&app.custody, "source@r1", "HIGH", &["USS Meridian"], json!("PRIORITY")).await;
    let mut event = Record::new("publication_event", "one", json!({"at":"2026-11-05T14:12:00Z"}));
    event.source = "source@r1".into(); event.category = "message".into(); event.state = "publication_succeeded".into(); event.order = 1;
    app.custody.put(&event, None).await.unwrap(); app.custody.refresh().await.unwrap();
    xnet::sync(store, &app.custody).await.unwrap(); store.refresh().await.unwrap();
    let initial = xnet::list(store, &viewer.owner).await.unwrap();
    store.update("xnet_cursor", "publication_event", |old| { let mut r = old.unwrap().clone(); r.order = 0; Ok(r) }).await.unwrap();
    xnet::sync(store, &app.custody).await.unwrap(); store.refresh().await.unwrap();
    assert_eq!(initial, xnet::list(store, &viewer.owner).await.unwrap());
    let item = &initial["items"][0];
    let routes = parse_command_server::http::router(app.clone());
    let body = json!({"shipId":"USS Meridian","id":item["id"],"version":item["version"]});
    for field in ["owner", "user", "username", "acknowledgedAt", "deskNetwork"] {
        let mut malicious = body.clone(); malicious[field] = json!("someone-else");
        let response = routes.clone().oneshot(HttpRequest::post("/api/v1/xnet/acknowledge").header("origin", "http://127.0.0.1:8080").header("content-type", "application/json").body(Body::from(malicious.to_string())).unwrap()).await.unwrap();
        assert!(response.status().is_client_error());
    }
    let response = routes.oneshot(HttpRequest::post("/api/v1/xnet/acknowledge").header("origin", "http://127.0.0.1:8080").header("content-type", "application/json").body(Body::from(body.to_string())).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let row = store.get("xnet_ship", "USS Meridian").await.unwrap().unwrap();
    let acks = row.record.payload["episodes"][0]["acknowledgements"].as_object().unwrap();
    assert_eq!(acks.len(), 1); assert!(acks.contains_key(&viewer.owner));
    support::cleanup(store).await;
}
