use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use parse_command_server::{
    api::App, auth, config::Config, http, private::Private, publisher::Status, search::Search,
};
use parse_command_state::Store;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tower::ServiceExt;
mod support;

// These stores are deliberately unreachable and never provisioned: liveness,
// readiness and missing-session rejection must not depend on a live backend.
fn inert_native_app() -> Arc<App> {
    let endpoint = "http://127.0.0.1:9";
    let state = Store::new(endpoint, ".parse-command-readiness-test").unwrap();
    let mut auth = support::auth_config();
    auth.mode = "oidc".into();
    auth.public_url = "https://parse-command.uds.dev".into();
    auth.issuer = "https://sso.uds.dev/realms/uds".into();
    auth.client_id = "parse-command".into();
    auth.client_secret = "unused-synthetic-client-secret".into();
    auth.key = Some([7; 32]);
    let intake = parse_command_intake::config::Config::load(std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../config/demo-compose-intake.json"
    )))
    .unwrap();
    let config = Config {
        intake,
        search: endpoint.into(),
        state_index: state.index().into(),
        auth,
        tokenizer: "unused".into(),
        tokenizer_hash: String::new(),
        listen: "127.0.0.1:0".into(),
        auto_role: None,
        allow_fixtures: false,
    };
    Arc::new(App {
        auth: auth::Auth::new(config.auth.clone(), state.clone()).unwrap(),
        search: Search::new(config.search.clone()).unwrap(),
        config,
        private: Private::new(state.clone()),
        custody: state,
        notification_sync: Arc::new(tokio::sync::Mutex::new(())),
        status: Status {
            ready: Arc::new(AtomicBool::new(false)),
            model: Arc::new(AtomicBool::new(false)),
        },
        inference: Arc::new(tokio::sync::Semaphore::new(1)),
    })
}

#[tokio::test]
async fn shared_router_exposes_readiness_separately_from_liveness_without_auth_or_storage() {
    let app = inert_native_app();
    let routes = http::router(app.clone());
    for (publication, model) in [(false, false), (false, true), (true, false), (true, true)] {
        app.status.ready.store(publication, Ordering::Relaxed);
        app.status.model.store(model, Ordering::Relaxed);
        let ready = routes
            .clone()
            .oneshot(Request::get("/api/ready").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            ready.status(),
            if publication && model {
                StatusCode::OK
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            }
        );
        let body = to_bytes(ready.into_body(), 4096).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["publicationReady"], publication);
        assert_eq!(value["modelReady"], model);
        let live = routes
            .clone()
            .oneshot(Request::get("/api/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(live.status(), StatusCode::OK);
    }
}

#[tokio::test]
async fn native_rest_and_rpc_reject_forged_identity_headers_and_demo_cookie_fallback() {
    let routes = http::router(inert_native_app());
    for path in [
        "/api/v1/messages/list",
        "/app.v1.AppService/GetIdentity",
        "/app.v1.DraftService/ReadDraft",
    ] {
        let response = routes
            .clone()
            .oneshot(
                Request::post(path)
                    .header("content-type", "application/json")
                    .header("connect-protocol-version", "1")
                    .header("origin", "https://parse-command.uds.dev")
                    .header("cookie", "parse_command_session=pretend-admin")
                    .header("authorization", "Bearer untrusted-token")
                    .header("x-auth-request-user", "admin")
                    .header("x-auth-request-groups", "/Parse Command/Admin")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
    }
    for path in ["/__ark/mock-login", "/__ark/mock-roles"] {
        let response = routes
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
}
