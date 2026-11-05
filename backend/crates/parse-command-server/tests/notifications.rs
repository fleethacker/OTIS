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

// This regression seeds synthetic canonical/notification records in the actual
// isolated service. It tests authorization projection, not parser acceptance.
#[tokio::test]
#[ignore = "requires isolated OpenSearch with canonical index/templates provisioned"]
async fn notification_http_filters_sources_before_groups_counts_members_and_reads() {
    use axum::{
        body::{Body, to_bytes},
        http::{Request as HttpRequest, StatusCode},
    };
    use parse_command_server::{api::role_identity, http, search::MESSAGES, settings};
    use serde_json::Value;
    use sha2::{Digest, Sha256};
    use tower::ServiceExt;
    let app = support::app().await;
    let viewer = role_identity("viewer").unwrap();
    settings::ensure_demo_user(&app.private.state, &viewer)
        .await
        .unwrap();
    let suffix = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let mut source_keys = Vec::new();
    let mut document_ids = Vec::new();
    for (n, command, label, at) in [
        (1, "notification-allowed", "ALLOWED", "2026-11-04T10:00:00Z"),
        (
            2,
            "notification-forbidden",
            "FORBIDDEN MIXED",
            "2026-11-04T10:00:00Z",
        ),
        (
            3,
            "notification-forbidden",
            "FORBIDDEN ONLY",
            "2026-11-04T11:00:00Z",
        ),
    ] {
        let id = format!(
            "sha256:{:x}",
            Sha256::digest(format!("notification scope fixture {suffix} {n}"))
        );
        let revision = "notification-scope-test-v1";
        let key = format!("{id}@{revision}");
        let document_id = format!("{id}:{revision}");
        let core = json!({"id":id,"revision":revision,"type":"OPTASK COMMS","originator":label,"subject":format!("Synthetic {label} subject"),"command_ids":[command],"status":"partial","review_flags":[],"activities":[]});
        app.search
            .post(
                &format!("/{MESSAGES}/_doc/{document_id}?refresh=true"),
                core.clone(),
            )
            .await
            .unwrap();
        let mut projection = Record::new("projection", &key, json!({"core":core}));
        projection.state = "published".into();
        app.custody.put(&projection, None).await.unwrap();
        let mut event = Record::new("publication_event", &n.to_string(), json!({"at":at}));
        event.source = key.clone();
        event.category = "message".into();
        event.owner = n.to_string();
        event.order = n;
        event.state = "publication_succeeded".into();
        app.custody.put(&event, None).await.unwrap();
        source_keys.push(key);
        document_ids.push(document_id);
    }
    app.custody.refresh().await.unwrap();
    notifications::sync(&app.private.state, &app.custody)
        .await
        .unwrap();
    // A source-less incident may have retained context before publication; no
    // linked canonical evidence means a restricted account cannot authorize it.
    let incident_id = app.private.state.next("notifications").await.unwrap();
    let mut incident = Record::new(
        "notification",
        "source-less",
        json!({"id":incident_id,"kind":"failed","context":"FORBIDDEN UNPUBLISHED","messageKey":"","at":"2026-11-04T12:00:00Z","detail":"Synthetic source failure","resolvedAt":null,"count":1,"members":{}}),
    );
    incident.order = incident_id;
    app.private.state.put(&incident, None).await.unwrap();
    app.private
        .state
        .put(
            &Record::new(
                "notification_id",
                &incident_id.to_string(),
                json!({"key":"source-less"}),
            ),
            None,
        )
        .await
        .unwrap();
    app.private.state.refresh().await.unwrap();
    let routes = http::router(app.clone());
    async fn post(routes: &axum::Router, path: &str, body: Value) -> (StatusCode, Value) {
        let reply = routes
            .clone()
            .oneshot(
                HttpRequest::post(path)
                    .header("origin", "http://127.0.0.1:8080")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = reply.status();
        let body = to_bytes(reply.into_body(), 2_097_152).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }
    let (status, unrestricted) = post(&routes, "/api/v1/notifications/list", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(unrestricted["items"].as_array().unwrap().len(), 3);
    assert_eq!(unrestricted["unread"], 3);
    let mixed = unrestricted["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["count"] == 2)
        .unwrap()["id"]
        .clone();
    let denied = unrestricted["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["messageKey"] == source_keys[2])
        .unwrap()["id"]
        .clone();
    app.private.state.update("user", &viewer.owner, |old| {
        let mut row=old.unwrap().clone();
        row.payload["accountSettings"] = json!({"messageScope":{"allCommands":false,"commandIds":["notification-allowed"],"includeUnassigned":false,"responsibilityIds":[]}});
        Ok(row)
    }).await.unwrap();
    let (status, scoped) = post(&routes, "/api/v1/notifications/list", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(scoped["items"].as_array().unwrap().len(), 1);
    assert_eq!(scoped["items"][0]["count"], 1);
    assert_eq!(scoped["items"][0]["messageKey"], source_keys[0]);
    assert_eq!(scoped["unread"], 1);
    assert_eq!(scoped["watermark"], scoped["items"][0]["version"]);
    assert!(scoped["watermark"].as_i64().unwrap() < unrestricted["watermark"].as_i64().unwrap());
    assert!(!scoped.to_string().contains("FORBIDDEN"));
    for key in &source_keys[1..] {
        assert!(!scoped.to_string().contains(key));
    }
    let (status, members) = post(
        &routes,
        "/api/v1/notifications/members",
        json!({"id":mixed}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(members["items"].as_array().unwrap().len(), 1);
    assert_eq!(members["items"][0]["messageKey"], source_keys[0]);
    assert!(!members.to_string().contains("FORBIDDEN"));
    for id in [denied.clone(), json!(incident_id)] {
        assert_eq!(
            post(&routes, "/api/v1/notifications/members", json!({"id":id}))
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            post(
                &routes,
                "/api/v1/notifications/read",
                json!({"id":id,"version":unrestricted["watermark"]})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        post(
            &routes,
            "/api/v1/notifications/read",
            json!({"through":unrestricted["watermark"]})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    // Opening a denied notification's known source key cannot bypass the reader.
    assert_eq!(
        post(
            &routes,
            "/api/v1/messages/detail",
            json!({"key":source_keys[1]})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        post(
            &routes,
            "/api/v1/notifications/read",
            json!({"through":scoped["watermark"]})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        post(&routes, "/api/v1/notifications/list", json!({}))
            .await
            .1["unread"],
        0
    );
    app.private
        .state
        .update("user", &viewer.owner, |old| {
            let mut row = old.unwrap().clone();
            row.payload["accountSettings"]["messageScope"]["commandIds"] =
                json!(["no-source-in-scope"]);
            Ok(row)
        })
        .await
        .unwrap();
    let (_, denied_all) = post(&routes, "/api/v1/notifications/list", json!({})).await;
    assert!(denied_all["items"].as_array().unwrap().is_empty());
    assert_eq!(denied_all["unread"], 0);
    assert_eq!(denied_all["watermark"], 0);
    assert_eq!(
        post(
            &routes,
            "/api/v1/notifications/members",
            json!({"id":mixed})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    app.private
        .state
        .update("user", &viewer.owner, |old| {
            let mut row = old.unwrap().clone();
            row.payload["accountSettings"] = json!({});
            Ok(row)
        })
        .await
        .unwrap();
    let (_, restored) = post(&routes, "/api/v1/notifications/list", json!({})).await;
    assert_eq!(
        restored, unrestricted,
        "restricted read markers cannot change the native unrestricted inbox"
    );
    for id in document_ids {
        app.search
            .request(
                reqwest::Method::DELETE,
                &format!("/{MESSAGES}/_doc/{id}?refresh=true"),
                None,
            )
            .await
            .unwrap();
    }
    support::cleanup(&app.private.state).await;
}
