use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use parse_command_server::rpc;
use tower::ServiceExt;
mod support;
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn generated_browser_json_services_are_registered_and_decode_errors_fail_closed() {
    let app = support::app().await;
    let store = app.private.state.clone();
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
    support::cleanup(&store).await;
}
