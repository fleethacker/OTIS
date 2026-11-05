use axum::{body::{Body, to_bytes}, extract::State, http::{HeaderMap, Request, StatusCode}, routing::post, Json};
use parse_command_server::{access, api::App, commands, config::Config, private::Private, publisher::Status, search::Search};
use std::sync::{Arc, Mutex, atomic::AtomicBool};
use tower::ServiceExt;

#[tokio::test]
async fn roster_reads_and_shared_write_check_use_server_sessions() {
    let dir = std::env::temp_dir().join(format!("watchdesk-commands-{}", std::process::id()));
    let config = Config {
        intake: parse_command_intake::config::Config::load(std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../config/demo-compose-intake.json"))).unwrap(),
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
    let routes = axum::Router::new().route("/commands/list", post(commands::list)).route("/write-probe", post(write)).with_state(app.clone());
    for (role, expected) in [("user", StatusCode::FORBIDDEN), ("platform_admin", StatusCode::OK)] {
        let session = app.store().unwrap().create_session(role).unwrap();
        for path in ["/commands/list", "/write-probe"] {
            let response = routes.clone().oneshot(Request::post(path).header("content-type", "application/json")
                .header("cookie", format!("parse_command_session={session}"))
                .header("origin", "http://localhost").header("host", "localhost")
                .body(Body::from("{}")).unwrap()).await.unwrap();
            assert_eq!(response.status(), if path == "/commands/list" { StatusCode::OK } else { expected });
            if response.status() == StatusCode::OK {
                let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
                let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                if path == "/write-probe" { assert_eq!(value["actor"], "dev-admin"); }
                else { assert_eq!(value["commands"].as_array().unwrap().len(), 4); }
            }
        }
    }
    let response = routes.clone().oneshot(Request::post("/commands/list").header("content-type", "application/json").body(Body::from("{}")).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = routes.clone().oneshot(Request::post("/commands/list").header("content-type", "application/json").body(Body::from(r#"{"commands":[]}"#)).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    drop(routes);
    drop(app);
    std::fs::remove_dir_all(dir).unwrap();
}
