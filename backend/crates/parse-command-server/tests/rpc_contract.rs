use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use parse_command_server::{
    api::App, config::Config, private::Private, publisher::Status, rpc, search::Search,
};
use std::sync::{Arc, Mutex, atomic::AtomicBool};
use tower::ServiceExt;
#[tokio::test]
async fn generated_browser_json_services_are_registered_and_decode_errors_fail_closed() {
    let dir = std::env::temp_dir().join(format!("parse-command-rpc-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let intake = parse_command_intake::config::Config::load(std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../config/demo-compose-intake.json"
    )))
    .unwrap();
    let private = Private::open(&dir.join("private.sqlite"), None).unwrap();
    let config = Config {
        intake,
        search: "http://127.0.0.1:9".into(),
        private: dir.join("private.sqlite"),
        legacy: None,
        tokenizer: dir.join("unused"),
        tokenizer_hash: String::new(),
        listen: "127.0.0.1:0".into(),
        auto_role: Some("user".into()),
        allow_fixtures: false,
    };
    let app = Arc::new(App {
        search: Search::new(config.search.clone()).unwrap(),
        config,
        private: Arc::new(Mutex::new(private)),
        status: Status {
            ready: Arc::new(AtomicBool::new(false)),
            model: Arc::new(AtomicBool::new(false)),
        },
        inference: Arc::new(tokio::sync::Semaphore::new(1)),
    });
    let routes = axum::Router::new().fallback_service(rpc::router(app).into_axum_service());
    for path in [
        "/app.v1.AppService/GetIdentity",
        "/app.v1.AppService/ListRoles",
        "/app.v1.AppService/Health",
    ] {
        let response = routes
            .clone()
            .oneshot(
                Request::post(path)
                    .header("content-type", "application/json")
                    .header("connect-protocol-version", "1")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        let body = to_bytes(response.into_body(), 65536).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        if path.ends_with("GetIdentity") {
            assert_eq!(value["username"], "dev-user");
        }
    }
    for path in [
        "/app.v1.DraftService/ReadDraft",
        "/app.v1.DraftService/SaveDraft",
        "/app.v1.DraftService/ReadPreparation",
        "/app.v1.DraftService/SavePreparation",
        "/app.v1.DraftService/RecordAcknowledgement",
    ] {
        let response = routes
            .clone()
            .oneshot(
                Request::post(path)
                    .header("content-type", "application/json")
                    .header("connect-protocol-version", "1")
                    .body(Body::from(r#"{"sourceMessageId":"invalid-key"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{path}");
    }
    drop(routes);
    std::fs::remove_dir_all(dir).unwrap();
}
