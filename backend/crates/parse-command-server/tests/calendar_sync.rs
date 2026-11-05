use axum::{
    body::{Body, to_bytes},
    extract::{Request, State},
    http::StatusCode,
    routing::any,
};
use parse_command_server::{calendar::{safe_name, split_calendar, sync_calendar}, config::DemoCalendar, http};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;
use tower::ServiceExt;
mod support;

fn config(endpoint: &str) -> DemoCalendar {
    DemoCalendar::from_values("true", endpoint, "sailor", &std::process::id().to_string()).unwrap().unwrap()
}
fn calendar(uid: &str) -> String {
    format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{uid}\r\nDTSTAMP:20261105T070000Z\r\nDTSTART:20261105T080000Z\r\nDTEND:20261105T083000Z\r\nSUMMARY:UNCLASSIFIED // FICTIONAL DEMO DATA\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
}
#[derive(Default)]
struct DavState {
    exists: bool,
    creates: usize,
    objects: HashMap<String, String>,
    fail: bool,
}
async fn dav(State(state): State<Arc<Mutex<DavState>>>, request: Request) -> StatusCode {
    if !request.headers().get("authorization").is_some_and(|value| value.to_str().unwrap_or("").starts_with("Basic ")) {
        return StatusCode::UNAUTHORIZED;
    }
    let method = request.method().as_str().to_owned();
    let path = request.uri().path().to_owned();
    let mut state = state.lock().await;
    if state.fail { return StatusCode::SERVICE_UNAVAILABLE; }
    match method.as_str() {
        "PROPFIND" => if state.exists { StatusCode::MULTI_STATUS } else { StatusCode::NOT_FOUND },
        "MKCALENDAR" => { state.exists = true; state.creates += 1; StatusCode::CREATED }
        "PUT" if state.exists => {
            let body = String::from_utf8(to_bytes(request.into_body(), 2 * 1024 * 1024).await.unwrap().to_vec()).unwrap();
            if state.objects.insert(path, body).is_some() { StatusCode::NO_CONTENT } else { StatusCode::CREATED }
        }
        _ => StatusCode::BAD_REQUEST,
    }
}

#[tokio::test]
async fn creates_collection_and_idempotently_upserts_one_resource_per_uid() {
    let state = Arc::new(Mutex::new(DavState::default()));
    let routes = axum::Router::new().route("/{*path}", any(dav)).with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/sailor/otis/", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, routes).await.unwrap(); });
    let config = config(&url);
    let input = calendar("synthetic-a");
    let first = sync_calendar(&config, split_calendar(&input).unwrap()).await.unwrap();
    assert_eq!((first.synced, first.created, first.updated), (1, 1, 0));
    assert_eq!(first.calendar, "sailor · OTIS");
    let second = sync_calendar(&config, split_calendar(&input.replace("SUMMARY:", "SUMMARY:Changed ")).unwrap()).await.unwrap();
    assert_eq!((second.synced, second.created, second.updated), (1, 0, 1));
    {
        let state = state.lock().await;
        assert_eq!(state.creates, 1);
        assert_eq!(state.objects.len(), 1);
        assert!(state.objects[&format!("/sailor/otis/{}", safe_name("synthetic-a"))].contains("SUMMARY:Changed"));
    }
    state.lock().await.fail = true;
    let error = sync_calendar(&config, split_calendar(&input).unwrap()).await.unwrap_err();
    assert_eq!(error.code, "calendar_unavailable");
    assert!(!error.message.contains(&config.password));
    server.abort();
}

#[tokio::test]
async fn route_is_gated_and_requires_same_origin_and_identity() {
    let body = serde_json::json!({"ics":calendar("synthetic-a")}).to_string();
    for demo in [false, true] {
        let routes = http::router(support::offline_app(demo));
        let response = routes.oneshot(Request::post("/api/v1/calendar/outlook-sync")
            .header("origin", "http://127.0.0.1:8080").header("content-type", "application/json")
            .body(Body::from(body.clone())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
    let mut app = support::offline_app(true);
    Arc::get_mut(&mut app).unwrap().config.demo_calendar = Some(config("http://127.0.0.1:9/sailor/otis/"));
    for (origin, expected) in [("http://127.0.0.1:8080", StatusCode::UNAUTHORIZED), ("http://other.invalid", StatusCode::FORBIDDEN), ("", StatusCode::FORBIDDEN)] {
        let response = http::router(app.clone()).oneshot(Request::post("/api/v1/calendar/outlook-sync")
            .header("origin", origin).header("content-type", "application/json")
            .body(Body::from(body.clone())).unwrap()).await.unwrap();
        assert_eq!(response.status(), expected);
    }
}

#[tokio::test]
async fn upstream_failures_are_plain_bad_gateway_responses() {
    use axum::response::IntoResponse;
    let error = sync_calendar(&config("http://127.0.0.1:9/sailor/otis/"), split_calendar(&calendar("a")).unwrap()).await.unwrap_err();
    let response = error.into_response();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let text = String::from_utf8(to_bytes(response.into_body(), 4096).await.unwrap().to_vec()).unwrap();
    assert!(text.contains("calendar_unavailable"));
    assert!(!text.contains("127.0.0.1"));
}

#[tokio::test]
#[ignore = "Requires isolated state and a disposable CalDAV collection; writes a synthetic event"]
async fn live_authenticated_calendar_sync_accepts_more_than_128k_and_retries_as_update() {
    let mut app = support::app_with_demo(true).await;
    let calendar_config = DemoCalendar::from_values("true",
        &std::env::var("PARSE_COMMAND_TEST_CALENDAR_URL").expect("Set disposable calendar URL"),
        &std::env::var("PARSE_COMMAND_DEMO_CALENDAR_USER").expect("Set calendar user"),
        &std::env::var("PARSE_COMMAND_DEMO_CALENDAR_PASSWORD").expect("Set calendar password"),
    ).unwrap().unwrap();
    Arc::get_mut(&mut app).unwrap().config.demo_calendar = Some(calendar_config);
    let uid = format!("synthetic-test-{}-{}@otis.local", std::process::id(), chrono::Utc::now().timestamp_millis());
    let ics = calendar(&uid).replace("END:VEVENT", &format!("DESCRIPTION:{}\r\nEND:VEVENT", "x".repeat(140_000)));
    for iteration in 0..2 {
        let response = http::router(app.clone()).oneshot(Request::post("/api/v1/calendar/outlook-sync")
            .header("origin", "http://127.0.0.1:8080").header("content-type", "application/json")
            .body(Body::from(serde_json::json!({"ics":ics}).to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let value: serde_json::Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
        assert_eq!(value[if iteration == 0 { "created" } else { "updated" }], 1);
    }
    support::cleanup(&app.private.state).await;
}
