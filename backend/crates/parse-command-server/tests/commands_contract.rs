use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing::post,
};
use parse_command_server::{
    api::{App, role_identity},
    auth, commands,
    private::Private,
    publisher::Status,
    search::Search,
    settings::{self, Settings},
};
use std::sync::{Arc, atomic::AtomicBool};
use tower::ServiceExt;
mod support;

fn routes(app: Arc<App>) -> Router {
    Router::new()
        .route("/commands/list", post(commands::list))
        .route("/changes/list", post(parse_command_server::changes::list))
        .with_state(app)
}
async fn call(
    routes: &Router,
    path: &str,
    cookie: Option<&str>,
    body: &str,
) -> (StatusCode, serde_json::Value) {
    let mut request = Request::post(path).header("content-type", "application/json");
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    let response = routes
        .clone()
        .oneshot(request.body(Body::from(body.to_owned())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

#[tokio::test]
async fn roster_and_turnover_reads_require_a_session_and_reject_write_fields() {
    let routes = routes(support::offline_app(true));
    let bounds = r#"{"since":"2026-11-05T04:00:00Z","until":"2026-11-05T08:00:00Z"}"#;
    assert_eq!(
        call(&routes, "/changes/list", None, bounds).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&routes, "/commands/list", None, "{}").await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&routes, "/commands/list", None, r#"{"commands":[]}"#)
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn watch_settings_writes_are_admin_only_before_any_state_read() {
    let app = support::offline_app(true);
    let viewer = role_identity("viewer").unwrap();
    for operation in ["update", "use-suggestion", "dismiss-suggestion"] {
        let error = settings::execute(
            &app,
            &viewer,
            operation,
            settings::Request {
                settings: Some(Settings::default()),
                suggestion: Some("context:fictional".into()),
                ..settings::Request::default()
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "permission_denied", "{operation}");
    }
    // Retired platform_admin identities map to admin; viewers never do.
    assert_eq!(role_identity("platform_admin").unwrap().role, "admin");
    assert!(settings::admin(&role_identity("user").unwrap()).is_err());
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn roster_own_ship_comes_from_shared_settings() {
    for demo in [false, true] {
        let app = support::app().await;
        let mut config = app.config.clone();
        config.intake.demo_fixture_assignments = demo;
        let store = app.private.state.clone();
        if demo {
            let doc = store.get("settings", "shared").await.unwrap().unwrap();
            let mut row = doc.record.clone();
            row.payload["settings"] =
                serde_json::to_value(Settings::demo(&commands::catalog(true).unwrap())).unwrap();
            store.put(&row, Some(&doc)).await.unwrap();
        }
        let app = Arc::new(App {
            search: Search::new(config.search.clone()).unwrap(),
            auth: auth::Auth::new(config.auth.clone(), store.clone()).unwrap(),
            config,
            private: Private::new(store.clone()),
            custody: store.clone(),
            notification_sync: Arc::new(tokio::sync::Mutex::new(())),
            status: Status {
                ready: Arc::new(AtomicBool::new(false)),
                model: Arc::new(AtomicBool::new(false)),
            },
            inference: Arc::new(tokio::sync::Semaphore::new(1)),
        });
        let token = app.private.create_session("viewer").await.unwrap();
        let cookie = format!("parse_command_session={token}");
        let (status, value) = call(&routes(app), "/commands/list", Some(&cookie), "{}").await;
        assert_eq!(status, StatusCode::OK);
        let commands = value["commands"].as_array().unwrap();
        assert_eq!(commands.len(), if demo { 4 } else { 0 });
        if demo {
            assert!(
                commands
                    .iter()
                    .any(|c| c["id"] == "demo-meridian" && c["isOwnShip"] == true)
            );
        }
        support::cleanup(&store).await;
    }
}
