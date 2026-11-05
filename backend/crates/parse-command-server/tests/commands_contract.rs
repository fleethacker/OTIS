use axum::{body::{Body, to_bytes}, extract::State, http::{HeaderMap, Request, StatusCode}, routing::post, Json};
use parse_command_server::{access, api::App, commands, config::Config, private::Private, publisher::Status, search::Search};
use std::sync::{Arc, Mutex, atomic::AtomicBool};
use tower::ServiceExt;

#[tokio::test]
async fn roster_reads_and_shared_write_check_use_server_sessions() {
    for demo in [false, true] {
    let dir = std::env::temp_dir().join(format!("watchdesk-commands-{}-{demo}", std::process::id()));
    let mut intake = parse_command_intake::config::Config::load(std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../config/demo-compose-intake.json"))).unwrap();
    assert!(!intake.demo_fixture_assignments);
    intake.demo_fixture_assignments = demo;
    intake.journal = dir.join("absent-custody.sqlite");
    let config = Config {
        intake,
        search: "http://127.0.0.1:9".into(), private: dir.join("private.sqlite"), legacy: None,
        tokenizer: dir.join("unused"), tokenizer_hash: String::new(), listen: "127.0.0.1:0".into(),
        auto_role: None, allow_fixtures: false,
    };
    let private = Private::open(&config.private, None).unwrap();
    let app = Arc::new(App {
        search: Search::new(config.search.clone()).unwrap(), config,
        private: Arc::new(Mutex::new(private)),
        status: Status { ready: Arc::new(AtomicBool::new(false)), model: Arc::new(AtomicBool::new(false)) },
        inference: Arc::new(tokio::sync::Semaphore::new(1)),
    });
    // Test-only write probe: production exposes no roster mutation endpoint.
    async fn write(State(app): State<Arc<App>>, headers: HeaderMap) -> parse_command_server::Result<Json<serde_json::Value>> {
        let actor = access::require_admin(&app, &headers)?;
        Ok(Json(serde_json::json!({"actor":actor.username})))
    }
    let routes = axum::Router::new().route("/commands/list", post(commands::list)).route("/write-probe", post(write))
        .route("/watch-context/{operation}", post(parse_command_server::watch_context::handle))
        .route("/changes/list", post(parse_command_server::changes::list)).with_state(app.clone());
    for (role, expected) in [("user", StatusCode::FORBIDDEN), ("platform_admin", StatusCode::OK)] {
        let session = app.store().unwrap().create_session(role).unwrap();
        for path in ["/commands/list", "/watch-context/get", "/write-probe", "/watch-context/update"] {
            let response = routes.clone().oneshot(Request::post(path).header("content-type", "application/json")
                .header("cookie", format!("parse_command_session={session}"))
                .header("origin", "http://localhost").header("host", "localhost")
                .body(Body::from(if path == "/watch-context/update" { r#"{"field":"operationName","values":["FICTIONAL COPPER"],"includeSuggestions":true}"# } else if path == "/watch-context/get" { r#"{"includeSuggestions":true}"# } else { "{}" })).unwrap()).await.unwrap();
            assert_eq!(response.status(), if path == "/commands/list" || path == "/watch-context/get" { StatusCode::OK } else { expected });
            if response.status() == StatusCode::OK {
                let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
                let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                if path == "/write-probe" { assert_eq!(value["actor"], "dev-admin"); }
                else if path == "/watch-context/get" {
                    assert_eq!(value["canEdit"], role == "platform_admin");
                    assert_eq!(value["context"]["ownShipId"], if demo { "demo-meridian" } else { "" });
                    assert_eq!(value["demoRoster"], demo);
                    assert_eq!(value["suggestionState"], "unavailable");
                }
                else if path == "/watch-context/update" {
                    assert_eq!(value["suggestionState"], "unavailable");
                    assert_eq!(value["updatedBy"], "dev-admin");
                    assert_eq!(value["context"]["operationName"], "FICTIONAL COPPER");
                    assert_eq!(value["confirmations"]["operationName"]["actor"], "dev-admin");
                } else { assert_eq!(value["commands"].as_array().unwrap().len(), if demo { 4 } else { 0 }); }
            }
        }
    }
    let bounds = r#"{"since":"2026-11-05T04:00:00Z","until":"2026-11-05T08:00:00Z"}"#;
    let response = routes.clone().oneshot(Request::post("/changes/list").header("content-type", "application/json").body(Body::from(bounds)).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let session = app.store().unwrap().create_session("user").unwrap();
    let response = routes.clone().oneshot(Request::post("/changes/list").header("content-type", "application/json")
        .header("cookie", format!("parse_command_session={session}"))
        .header("origin", "http://localhost").header("host", "localhost").body(Body::from(bounds)).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE); // missing custody is not an empty watch
    assert!(!app.config.intake.journal.exists()); // read-only handler did not create a database
    let actor: String = app.store().unwrap().db.query_row("SELECT json_extract(document,'$.updatedBy') FROM watch_context", [], |r| r.get(0)).unwrap();
    assert_eq!(actor, "dev-admin");
    let response = routes.clone().oneshot(Request::post("/watch-context/update").header("content-type", "application/json").body(Body::from(r#"{"field":"operationName","values":["NO SESSION"]}"#)).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = routes.clone().oneshot(Request::post("/commands/list").header("content-type", "application/json").body(Body::from("{}")).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = routes.clone().oneshot(Request::post("/commands/list").header("content-type", "application/json").body(Body::from(r#"{"commands":[]}"#)).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    drop(routes);
    drop(app);
    std::fs::remove_dir_all(dir).unwrap();
    }
}
