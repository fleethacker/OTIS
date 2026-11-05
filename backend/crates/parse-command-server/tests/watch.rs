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

#[test]
fn demo_reset_time_defaults_to_0600z_and_resolves_turnover() {
    let now = at("2026-11-05T15:19:46.392Z");
    assert_eq!(watch::reset_time(None, &turnovers(), now).unwrap(), at("2026-11-05T06:00:00Z"));
    // Before 0600Z the current day's default is still ahead: the previous day's.
    assert_eq!(
        watch::reset_time(None, &turnovers(), at("2026-11-05T03:00:00Z")).unwrap(),
        at("2026-11-04T06:00:00Z")
    );
    assert_eq!(watch::reset_time(Some("turnover"), &turnovers(), now).unwrap(), at("2026-11-05T12:00:00Z"));
    assert_eq!(
        watch::reset_time(Some("turnover"), &["2000Z".to_owned()], at("2026-11-05T13:15:00Z")).unwrap(),
        at("2026-11-04T20:00:00Z")
    );
    assert_eq!(watch::reset_time(Some("turnover"), &[], now).unwrap(), at("2026-11-04T15:19:46.392Z"));
    let explicit = watch::reset_time(Some("2026-11-05T06:30:15.250Z"), &turnovers(), now).unwrap();
    assert_eq!(watch::millis(explicit), "2026-11-05T06:30:15.250Z");
}

#[test]
fn demo_reset_time_rejects_future_stale_and_non_utc_values() {
    let now = at("2026-11-05T15:19:46.392Z");
    for value in [
        "2026-11-05T15:19:46.393Z",      // one millisecond ahead
        "2026-11-06T00:00:00Z",          // tomorrow
        "2026-09-24T15:19:46.391Z",      // 42 days and a millisecond ago
        "2026-11-05T06:00:00+00:00",     // not a Z time
        "2026-11-05T06:00:00-05:00",
        "2026-11-05T06:00:00.0005Z",     // finer than a millisecond
        "2026-11-05",
        "yesterday",
        "",
    ] {
        let error = watch::reset_time(Some(value), &turnovers(), now).unwrap_err();
        assert_eq!(error.code, "invalid_argument", "{value}");
    }
    // The oldest allowed time is exactly 42 days back.
    assert!(watch::reset_time(Some("2026-09-24T15:19:46.392Z"), &turnovers(), now).is_ok());
    assert!(watch::reset_time(Some("2026-11-05T15:19:46.392Z"), &turnovers(), now).is_ok());
}

#[test]
fn demo_reset_moves_last_seen_and_both_pins_to_one_time() {
    let target = at("2026-11-05T06:00:00Z");
    let mut user = json!({"username":"dev-user","last_seen_at":"2026-11-05T14:00:00.000Z",
        "watch_since":{"since":"2026-11-05T12:00:00.000Z","basis":"turnover"}});
    watch::reset_user(&mut user, target);
    assert_eq!(user[LAST_SEEN], "2026-11-05T06:00:00.000Z");
    assert_eq!(user[watch::PIN], json!({"since":"2026-11-05T06:00:00.000Z","basis":"last_seen"}));
    assert_eq!(user["username"], "dev-user");
    let mut session = json!({"role":"viewer","user_epoch":0,"watch_since":{"since":"2026-11-05T12:00:00.000Z","basis":"turnover"}});
    watch::reset_session(&mut session, target);
    assert_eq!(session[watch::PIN], user[watch::PIN]);
    assert_eq!(session["role"], "viewer");
    // The next session pins the reset time.
    assert_eq!(
        watch::pin(&user, &turnovers(), at("2026-11-05T15:00:00Z")),
        json!({"since":"2026-11-05T06:00:00.000Z","basis":"last_seen"})
    );
}

async fn offline_reset(demo: bool, cookie: Option<&str>, body: &str) -> (axum::http::StatusCode, Value) {
    let routes = axum::Router::new()
        .route("/changes/demo-reset", axum::routing::post(parse_command_server::changes::demo_reset))
        .with_state(support::offline_app(demo));
    let mut request = HttpRequest::post("/changes/demo-reset").header("content-type", "application/json");
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    let response = routes.oneshot(request.body(Body::from(body.to_owned())).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn demo_reset_is_not_found_without_the_demo_flag() {
    let cookie = format!("parse_command_session={}", "a".repeat(64));
    // Flag off: not found for everyone, before any session or state read.
    for body in [r#"{}"#, r#"{"lastSeenAt":"turnover"}"#, r#"{"lastSeenAt":"2026-11-05T06:00:00Z"}"#] {
        for cookie in [None, Some(cookie.as_str())] {
            assert_eq!(offline_reset(false, cookie, body).await.0, 404, "{body}");
        }
    }
    // Flag on: a session is required, and the operation accepts no actor or other field.
    assert_eq!(offline_reset(true, None, "{}").await.0, 401);
    assert_eq!(offline_reset(true, None, r#"{"actor":"demo:dev-admin"}"#).await.0, 422);
    assert_eq!(offline_reset(true, None, r#"{"lastSeenAt":"turnover","userId":"x"}"#).await.0, 422);
}

fn post_json(path: &str, cookie: &str, body: Value) -> HttpRequest<Body> {
    HttpRequest::post(path)
        .header("origin", "http://127.0.0.1:8080")
        .header("cookie", cookie)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}
async fn call_json(routes: &axum::Router, request: HttpRequest<Body>) -> (axum::http::StatusCode, Value) {
    let response = routes.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let body: Value = serde_json::from_slice(&to_bytes(response.into_body(), 2_097_152).await.unwrap()).unwrap_or(Value::Null);
    (status, body)
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn demo_reset_is_caller_scoped_and_moves_the_current_session_boundary() {
    let app = support::app_with_demo(true).await;
    let store = app.private.state.clone();
    let routes = parse_command_server::http::router(app.clone());
    let id = parse_command_types::message_id("Fictional reset");
    let key = format!("{id}@r1");
    let mut row = Record::new("projection", &key, json!({"core":{"id":id,"revision":"r1","subject":"Fictional reset","command_ids":[],"issued_at":watch::millis(Utc::now() - Duration::minutes(30))},"audits":[]}));
    row.state = "published".into();
    row.order = 1;
    store.put(&row, None).await.unwrap();
    store.refresh().await.unwrap();
    let admin = format!("parse_command_session={}", app.private.create_session("admin").await.unwrap());
    let viewer = format!("parse_command_session={}", app.private.create_session("viewer").await.unwrap());
    let since = watch::millis(Utc::now() - Duration::hours(2));
    for cookie in [&admin, &viewer] {
        let (status, _) = call_json(&routes, post_json("/api/v1/changes/review", cookie, json!({"messageKeys":[key]}))).await;
        assert_eq!(status, 200);
    }
    let reviewed = |cookie: String| {
        let routes = routes.clone();
        let since = since.clone();
        async move { call_json(&routes, post_json("/api/v1/changes/list", &cookie, json!({"since":since}))).await.1["items"][0]["reviewedAt"].clone() }
    };
    assert!(reviewed(admin.clone()).await.is_string() && reviewed(viewer.clone()).await.is_string());

    // The viewer resets only themselves, to an explicit time.
    let target = watch::millis(Utc::now() - Duration::hours(3));
    let (status, reply) = call_json(&routes, post_json("/api/v1/changes/demo-reset", &viewer, json!({"lastSeenAt":target}))).await;
    assert_eq!(status, 200, "{reply}");
    assert_eq!((reply["lastSeenAt"].clone(), reply["since"].clone(), reply["reviewsCleared"].clone()), (json!(target), json!(target), json!(true)));
    assert_eq!(reviewed(viewer.clone()).await, Value::Null);
    assert!(reviewed(admin.clone()).await.is_string());
    assert!(store.get(changes_reviews(), "demo:dev-user").await.unwrap().is_none());
    assert!(store.get(changes_reviews(), "demo:dev-admin").await.unwrap().is_some());
    let user = store.get("user", "demo:dev-user").await.unwrap().unwrap().record.payload;
    assert_eq!(user[LAST_SEEN], json!(target));
    assert_eq!(user[watch::PIN], json!({"since":target,"basis":"last_seen"}));
    // The viewer's current session shows the new boundary at once; the admin's does not.
    let seen = session(&routes, &viewer).await;
    assert_eq!((seen["since"].clone(), seen["basis"].clone()), (json!(target), json!("last_seen")));
    assert_ne!(session(&routes, &admin).await["since"], json!(target));
    let admin_user = store.get("user", "demo:dev-admin").await.unwrap().unwrap().record.payload;
    assert_ne!(admin_user[LAST_SEEN], json!(target));
    // The default list now uses the reset boundary.
    let (_, default) = call_json(&routes, post_json("/api/v1/changes/list", &viewer, json!({}))).await;
    assert_eq!((default["since"].clone(), default["basis"].clone()), (json!(target), json!("last_seen")));

    // Rejected times change nothing.
    for body in [
        json!({"lastSeenAt":watch::millis(Utc::now() + Duration::hours(1))}),
        json!({"lastSeenAt":watch::millis(Utc::now() - Duration::days(43))}),
        json!({"lastSeenAt":"2026-11-05T06:00:00+00:00"}),
    ] {
        let (status, _) = call_json(&routes, post_json("/api/v1/changes/demo-reset", &viewer, body)).await;
        assert_eq!(status, 400);
    }
    let (status, _) = call_json(&routes, post_json("/api/v1/changes/demo-reset", &viewer, json!({"lastSeenAt":target,"actor":"demo:dev-admin"}))).await;
    assert_eq!(status, 422);
    assert_eq!(session(&routes, &viewer).await["since"], json!(target));

    // An admin resets themselves: default 0600Z, then the latest turnover.
    let (status, reply) = call_json(&routes, post_json("/api/v1/changes/demo-reset", &admin, json!({}))).await;
    assert_eq!(status, 200, "{reply}");
    assert!(reply["since"].as_str().unwrap().ends_with("T06:00:00.000Z"), "{reply}");
    assert_eq!(session(&routes, &admin).await["since"], reply["since"]);
    assert_eq!(reviewed(admin.clone()).await, Value::Null);
    assert_eq!(session(&routes, &viewer).await["since"], json!(target));
    let (status, reply) = call_json(&routes, post_json("/api/v1/changes/demo-reset", &admin, json!({"lastSeenAt":"turnover"}))).await;
    assert_eq!(status, 200, "{reply}");
    let hour: u32 = reply["since"].as_str().unwrap()[11..13].parse().unwrap();
    assert!(reply["since"].as_str().unwrap().ends_with(":00:00.000Z") && hour % 4 == 0, "{reply}");
    support::cleanup(&store).await;

    // Flag off: the route does not exist for a signed-in caller either.
    let app = support::app_with_demo(false).await;
    let store = app.private.state.clone();
    let routes = parse_command_server::http::router(app.clone());
    let viewer = format!("parse_command_session={}", app.private.create_session("viewer").await.unwrap());
    let (status, _) = call_json(&routes, post_json("/api/v1/changes/demo-reset", &viewer, json!({}))).await;
    assert_eq!(status, 404);
    support::cleanup(&store).await;
}
fn changes_reviews() -> &'static str {
    parse_command_server::changes::REVIEWS
}
