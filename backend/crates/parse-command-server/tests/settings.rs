use parse_command_server::{
    api::role_identity,
    settings::{self, Request, Settings},
};
use serde_json::json;
mod support;
#[test]
fn settings_validate_authority_version_and_model_egress() {
    let mut settings = Settings::default();
    assert!(settings.validate().is_ok());
    settings.outgoing_command = "SHIP//INJECT".into();
    assert!(settings.validate().is_err());
    settings.outgoing_command = "SHIP".into();
    settings.version = 2;
    assert!(settings.validate().is_err());
    assert!(serde_json::from_value::<Settings>(json!({"version":1,"unknown":true})).is_err());
}
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn state_is_realtime_cas_and_settings_are_admin_only() {
    let app = support::app().await;
    let store = &app.private.state;
    let admin = role_identity("admin").unwrap();
    let viewer = role_identity("viewer").unwrap();
    settings::ensure_demo_user(store, &admin).await.unwrap();
    settings::ensure_demo_user(store, &viewer).await.unwrap();
    let doc = store.get("settings", "shared").await.unwrap().unwrap();
    let mut row = doc.record.clone();
    row.payload["settings"]["shipName"] = json!("EXAMPLE");
    store.put(&row, Some(&doc)).await.unwrap();
    assert!(store.put(&doc.record, Some(&doc)).await.is_err());
    assert_eq!(
        store
            .get("settings", "shared")
            .await
            .unwrap()
            .unwrap()
            .record
            .payload["settings"]["shipName"],
        "EXAMPLE"
    );
    for operation in ["update", "users", "update-user", "options", "test-ai"] {
        let error = settings::execute(&app, &viewer, operation, Request::default())
            .await
            .unwrap_err();
        assert_eq!(error.code, "permission_denied");
    }
    settings::execute(
        &app,
        &viewer,
        "save-preferences",
        Request {
            timezone: Some("America/Chicago".into()),
            ..Request::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        settings::execute(&app, &viewer, "preferences", Request::default())
            .await
            .unwrap()["timezone"],
        "America/Chicago"
    );
    assert_eq!(
        settings::execute(&app, &admin, "preferences", Request::default())
            .await
            .unwrap()["timezone"],
        "UTC"
    );
    assert!(
        settings::execute(
            &app,
            &viewer,
            "save-preferences",
            Request {
                timezone: Some("Mars/Not-a-zone".into()),
                ..Request::default()
            }
        )
        .await
        .is_err()
    );
    support::cleanup(store).await;
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn http_origin_role_cookie_and_logout_boundaries() {
    use axum::{
        body::{Body, to_bytes},
        http::{Request as HttpRequest, StatusCode},
    };
    use tower::ServiceExt;
    let app = support::app().await;
    let store = app.private.state.clone();
    let routes = parse_command_server::http::router(app.clone());
    let request = |path: &str, origin: &str, cookie: &str, body: &str| {
        HttpRequest::post(path)
            .header("origin", origin)
            .header("cookie", cookie)
            .header("content-type", "application/json")
            .body(Body::from(body.to_owned()))
            .unwrap()
    };
    for origin in ["", "http://attacker.invalid"] {
        let response = routes
            .clone()
            .oneshot(request(
                "/api/v1/settings/save-preferences",
                origin,
                "",
                r#"{"timezone":"UTC"}"#,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    let response = routes
        .clone()
        .oneshot(request(
            "/api/v1/settings/users",
            "http://127.0.0.1:8080",
            "",
            "{}",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let token = app.private.create_session("admin").await.unwrap();
    let cookie = format!("parse_command_session={token}");
    let response = routes
        .clone()
        .oneshot(request(
            "/api/v1/settings/get",
            "http://127.0.0.1:8080",
            &cookie,
            "{}",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let settings: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    let mut changed = settings.clone();
    changed["settings"]["outgoingCommand"] = json!("EXAMPLE");
    changed["settings"]["actionAuthority"] = json!("OPS");
    let response = routes
        .clone()
        .oneshot(request(
            "/api/v1/settings/update",
            "http://127.0.0.1:8080",
            &cookie,
            &changed.to_string(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = routes
        .clone()
        .oneshot(request(
            "/api/v1/settings/update",
            "http://127.0.0.1:8080",
            &cookie,
            &changed.to_string(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let response = routes
        .clone()
        .oneshot(request(
            "/auth/logout",
            "http://127.0.0.1:8080",
            &cookie,
            "{}",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let set_cookie = response.headers()["set-cookie"].to_str().unwrap();
    assert!(set_cookie.contains("HttpOnly"));
    assert!(set_cookie.contains("Max-Age=0"));
    let response = routes
        .clone()
        .oneshot(request(
            "/api/v1/settings/get",
            "http://127.0.0.1:8080",
            &cookie,
            "{}",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    support::cleanup(&store).await;
}
