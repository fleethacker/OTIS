use crate::{
    Error, Result,
    api::{App, role_identity, session_token},
};
use axum::{
    Json,
    extract::{Form, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{Html, IntoResponse, Redirect, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
fn origin(headers: &HeaderMap) -> Result<()> {
    if let Some(origin) = headers.get(header::ORIGIN) {
        let host = headers
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if origin.to_str().unwrap_or("") != format!("http://{host}") {
            return Err(Error::new(
                "unauthenticated",
                "Cross-origin session request rejected",
            ));
        }
    }
    Ok(())
}
pub async fn health(State(app): State<Arc<App>>) -> Json<Value> {
    Json(
        json!({"status":"healthy","backend":"rust","publicationReady":app.status.ready.load(std::sync::atomic::Ordering::Relaxed)}),
    )
}
pub async fn whoami(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers)?;
    Ok(Json(
        serde_json::to_value(identity).map_err(|_| Error::unavailable())?,
    ))
}
pub async fn roles() -> Json<Value> {
    Json(
        json!({"roles":[{"name":"platform_admin","username":"dev-admin","description":"Platform administrator — sees admin-only UI"},{"name":"user","username":"dev-user","description":"Default user"}]}),
    )
}
#[derive(Default, Deserialize)]
pub struct Login {
    #[serde(default)]
    role: String,
    #[serde(default, rename = "return")]
    return_to: String,
}
fn return_path(value: &str) -> &str {
    if value.starts_with('/')
        && !value.starts_with("//")
        && !value.contains(['\\', '\r', '\n', '\0'])
    {
        value
    } else {
        "/calendar"
    }
}
fn html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
pub async fn login_page(Query(request): Query<Login>) -> Html<String> {
    Html(format!(
        "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width'><title>Parse Command local sign in</title><main><h1>Parse Command local demo</h1><p>Select a demo identity. This profile is limited to the local test environment.</p><form method=post action=/__ark/mock-login><input type=hidden name=return value=\"{}\"><label>Identity <select name=role><option value=user>Default user</option><option value=platform_admin>Platform administrator</option></select></label><button type=submit>Sign in</button></form></main></html>",
        html(return_path(&request.return_to))
    ))
}
pub async fn login(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Form(request): Form<Login>,
) -> Result<Response> {
    origin(&headers)?;
    role_identity(&request.role)?;
    let token = app.store()?.create_session(&request.role)?;
    let mut response = Redirect::to(return_path(&request.return_to)).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        format!("parse_command_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200")
            .parse()
            .map_err(|_| Error::unavailable())?,
    );
    Ok(response)
}
pub async fn logout(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Response> {
    origin(&headers)?;
    if let Some(cookie) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok())
        && let Some(token) = session_token(cookie)
    {
        app.store()?.logout(token)?;
    }
    let mut response = Redirect::to("/__ark/mock-login").into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        "parse_command_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
            .parse()
            .map_err(|_| Error::unavailable())?,
    );
    Ok(response)
}
pub async fn not_found() -> (StatusCode, Json<Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"code":"not_found","message":"Unknown API route"})),
    )
}
