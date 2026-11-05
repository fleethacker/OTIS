//! Shared HTTP router and security boundary, exercised by integration tests.
use crate::{Error, api::App, rpc, web};
use axum::{
    extract::{Request, State},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use std::{sync::Arc, time::Duration};
pub fn router(app: Arc<App>) -> axum::Router {
    let rpc_router = rpc::router(app.clone());
    let rpc_service = rpc_router
        .into_axum_service()
        .with_limits(
            connectrpc::Limits::default()
                .with_max_message_size(2_097_152)
                .with_max_request_body_size(131072),
        )
        .with_deadline_policy(
            connectrpc::DeadlinePolicy::new()
                .with_default_timeout(Duration::from_secs(7))
                .with_max(Duration::from_secs(10)),
        );
    axum::Router::new()
        .route("/api/health", get(web::health))
        .route("/api/ready", get(web::ready))
        .route("/auth/login", get(web::oidc_login))
        .route("/auth/callback", get(web::callback))
        .route("/auth/session", get(web::session))
        .route("/auth/refresh", post(web::renew))
        .route("/auth/logout", post(web::logout))
        .route(
            "/api/v1/settings/{operation}",
            post(crate::settings::handle),
        )
        .route("/api/v1/source/status", get(crate::api::status))
        .route("/api/v1/changes/list", post(crate::changes::list))
        .route("/api/v1/changes/review", post(crate::changes::review))
        .route("/api/v1/changes/review-all", post(crate::changes::review_all))
        .route("/api/v1/commands/list", post(crate::commands::list))
        .route("/api/v1/messages/{operation}", post(crate::api::read))
        .route(
            "/api/v1/notifications/{operation}",
            post(crate::notifications::handle),
        )
        .route("/__ark/mock-whoami", get(web::whoami))
        .route("/__ark/mock-roles", get(web::roles))
        .route("/__ark/mock-login", get(web::login_page).post(web::login))
        .fallback_service(rpc_service)
        .layer(axum::extract::DefaultBodyLimit::max(131072))
        .layer(middleware::from_fn_with_state(app.clone(), same_origin))
        .with_state(app)
        .layer(middleware::from_fn_with_state(
            Arc::new(tokio::sync::Semaphore::new(8)),
            bounds,
        ))
}
async fn same_origin(State(app): State<Arc<App>>, request: Request, next: Next) -> Response {
    if !matches!(
        *request.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) {
        let origin = request
            .headers()
            .get("origin")
            .and_then(|v| v.to_str().ok());
        if origin != Some(app.config.auth.public_url.as_str()) {
            return Error::new("permission_denied", "Same-origin request required").into_response();
        }
    }
    next.run(request).await
}
async fn bounds(
    State(limit): State<Arc<tokio::sync::Semaphore>>,
    request: Request,
    next: Next,
) -> Response {
    let Ok(_permit) = limit.try_acquire_owned() else {
        return Error::new(
            "resource_exhausted",
            "Request concurrency bound reached; retry shortly",
        )
        .into_response();
    };
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        "cache-control",
        axum::http::HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        axum::http::HeaderValue::from_static("nosniff"),
    );
    response
}
