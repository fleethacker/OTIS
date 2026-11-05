use axum::{
    body::{Body, to_bytes},
    http::Request as HttpRequest,
};
use chrono::{DateTime, Duration, Utc};
use parse_command_server::watch::{self, LAST_SEEN};
use parse_command_state::Record;
use serde_json::{Value, json};
use tower::ServiceExt;
mod support;

fn at(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&Utc)
}
fn turnovers() -> Vec<String> {
    ["0000Z", "0400Z", "0800Z", "1200Z", "1600Z", "2000Z"].map(str::to_owned).to_vec()
}

#[test]
fn last_seen_updates_at_most_once_per_five_minutes() {
    let now = at("2026-11-05T12:00:00Z");
    assert!(watch::seen_due(&json!({}), now));
    assert!(!watch::seen_due(&json!({LAST_SEEN: "2026-11-05T11:55:00.001Z"}), now));
    assert!(watch::seen_due(&json!({LAST_SEEN: "2026-11-05T11:55:00.000Z"}), now));
    assert!(watch::seen_due(&json!({LAST_SEEN: "2026-11-05T12:10:00.000Z"}), now)); // clock went back
    assert!(watch::seen_due(&json!({LAST_SEEN: "not a time"}), now));
}

#[test]
fn first_session_falls_back_to_latest_turnover_then_24_hours() {
    let now = at("2026-11-05T13:15:00Z");
    assert_eq!(
        watch::pin(&json!({LAST_SEEN: "2026-11-05T08:12:00.000Z"}), &turnovers(), now),
        json!({"since":"2026-11-05T08:12:00.000Z","basis":"last_seen"})
    );
    assert_eq!(
        watch::pin(&json!({}), &turnovers(), now),
        json!({"since":"2026-11-05T12:00:00.000Z","basis":"turnover"})
    );
    // Before today's only turnover: the previous day's.
    assert_eq!(
        watch::pin(&json!({}), &["2000Z".to_owned()], now),
        json!({"since":"2026-11-04T20:00:00.000Z","basis":"turnover"})
    );
    assert_eq!(
        watch::pin(&json!({}), &[], now),
        json!({"since":"2026-11-04T13:15:00.000Z","basis":"default_24h"})
    );
}

async fn session(routes: &axum::Router, cookie: &str) -> Value {
    let response = routes
        .clone()
        .oneshot(
            HttpRequest::get("/auth/session")
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap()
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn session_since_is_pinned_at_session_start_and_new_sessions_move_on() {
    let app = support::app().await;
    let store = app.private.state.clone();
    let routes = parse_command_server::http::router(app.clone());
    // First session ever: latest turnover.
    let first = format!("parse_command_session={}", app.private.create_session("viewer").await.unwrap());
    let value = session(&routes, &first).await;
    assert_eq!(value["basis"], "turnover");
    let pinned = value["since"].clone();
    // lastSeenAt changes (as later requests record it); this session's boundary does not.
    let user = store.get("user", "demo:dev-user").await.unwrap().unwrap();
    let seen = watch::millis(Utc::now() - Duration::hours(3));
    let mut row = user.record.clone();
    row.payload[LAST_SEEN] = json!(seen);
    store.put(&row, Some(&user)).await.unwrap();
    // A new session pins the stored lastSeenAt before any of its requests.
    let second = format!("parse_command_session={}", app.private.create_session("viewer").await.unwrap());
    let value = session(&routes, &second).await;
    assert_eq!(value["basis"], "last_seen");
    assert_eq!(value["since"], seen);
    for _ in 0..2 {
        let value = session(&routes, &first).await;
        assert_eq!((value["since"].clone(), value["basis"].clone()), (pinned.clone(), json!("turnover")));
    }
    assert_eq!(session(&routes, &second).await["since"], seen);
    support::cleanup(&store).await;
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn reviews_are_caller_scoped_and_review_all_stops_at_the_watermark() {
    let app = support::app().await;
    let store = app.private.state.clone();
    let routes = parse_command_server::http::router(app.clone());
    let post = |path: &str, cookie: &str, body: Value| {
        HttpRequest::post(path)
            .header("origin", "http://127.0.0.1:8080")
            .header("cookie", cookie)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    };
    let call = |request: HttpRequest<Body>| {
        let routes = routes.clone();
        async move {
            let response = routes.oneshot(request).await.unwrap();
            let status = response.status();
            let body: Value = serde_json::from_slice(&to_bytes(response.into_body(), 2_097_152).await.unwrap()).unwrap_or(Value::Null);
            (status, body)
        }
    };
    let add = |name: &str, order: i64| {
        let id = parse_command_types::message_id(name);
        let mut row = Record::new("projection", &format!("{id}@r1"), json!({"core":{"id":id,"revision":"r1","subject":name,"command_ids":[],"issued_at":watch::millis(Utc::now() - Duration::minutes(30))},"audits":[]}));
        row.state = "published".into();
        row.order = order;
        (row, format!("{id}@r1"))
    };
    let (row, first) = add("Fictional first", 1);
    store.put(&row, None).await.unwrap();
    store.refresh().await.unwrap();
    let admin = format!("parse_command_session={}", app.private.create_session("admin").await.unwrap());
    let viewer = format!("parse_command_session={}", app.private.create_session("viewer").await.unwrap());
    let since = watch::millis(Utc::now() - Duration::hours(2));
    let (status, list) = call(post("/api/v1/changes/list", &admin, json!({"since":since}))).await;
    assert_eq!(status, 200, "{list}");
    assert_eq!(list["basis"], "explicit");
    assert_eq!(list["items"][0]["messageKey"], first);
    let (_, default) = call(post("/api/v1/changes/list", &admin, json!({}))).await;
    assert_eq!(default["basis"], "turnover");
    let (status, _) = call(post("/api/v1/changes/review", &admin, json!({"messageKeys":[first]}))).await;
    assert_eq!(status, 200);
    let (_, mine) = call(post("/api/v1/changes/list", &admin, json!({"since":since}))).await;
    assert!(mine["items"][0]["reviewedAt"].is_string());
    let (_, theirs) = call(post("/api/v1/changes/list", &viewer, json!({"since":since}))).await;
    assert_eq!(theirs["items"][0]["reviewedAt"], Value::Null);
    let (status, _) = call(post("/api/v1/changes/review", &viewer, json!({"messageKeys":[first],"actor":"demo:dev-admin"}))).await;
    assert_eq!(status, 422);
    // Mark all with the viewer's earlier watermark; a later arrival stays unreviewed.
    let watermark = theirs["watermark"].clone();
    let (row, late) = add("Fictional late", 2);
    store.put(&row, None).await.unwrap();
    store.refresh().await.unwrap();
    let (status, all) = call(post("/api/v1/changes/review-all", &viewer, json!({"since":since,"watermark":watermark}))).await;
    assert_eq!(status, 200, "{all}");
    assert_eq!(all["messageKeys"], json!([first]));
    let (_, after) = call(post("/api/v1/changes/list", &viewer, json!({"since":since}))).await;
    let reviewed = |key: &str| after["items"].as_array().unwrap().iter().find(|i| i["messageKey"] == key).unwrap()["reviewedAt"].clone();
    assert!(reviewed(&first).is_string());
    assert_eq!(reviewed(&late), Value::Null);
    support::cleanup(&store).await;
}
