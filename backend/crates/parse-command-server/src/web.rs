use crate::{
    Error, Result,
    api::{App, session_token},
    auth::return_path,
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
fn cookie(headers: &HeaderMap) -> Option<&str> {
    headers.get(header::COOKIE).and_then(|v| v.to_str().ok())
}
fn named_cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    cookie(headers)?.split(';').find_map(|v| {
        v.trim()
            .split_once('=')
            .filter(|(k, _)| *k == name)
            .map(|(_, v)| v)
    })
}
fn set_cookie(
    response: &mut Response,
    name: &str,
    value: &str,
    age: Option<u32>,
    secure: bool,
) -> Result<()> {
    let age = age.map(|v| format!("; Max-Age={v}")).unwrap_or_default();
    let secure = if secure { "; Secure" } else { "" };
    response.headers_mut().append(
        header::SET_COOKIE,
        format!("{name}={value}; Path=/; HttpOnly; SameSite=Lax{secure}{age}")
            .parse()
            .map_err(|_| Error::unavailable())?,
    );
    Ok(())
}
fn demo(app: &App) -> Result<()> {
    if app.config.auth.mode != "local_demo" {
        return Err(Error::new("not_found", "Route unavailable"));
    }
    Ok(())
}
pub async fn health(State(app): State<Arc<App>>) -> Json<Value> {
    Json(
        json!({"status":"healthy","backend":"rust","publicationReady":app.status.ready.load(std::sync::atomic::Ordering::Relaxed)}),
    )
}
pub async fn whoami(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    Ok(Json(
        serde_json::to_value(app.headers_identity(&headers).await?)
            .map_err(|_| Error::unavailable())?,
    ))
}
pub async fn session(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    let (expires, session_expires) = if app.config.auth.mode == "oidc" {
        let (access, session) = app.auth.deadlines(cookie(&headers)).await?;
        (Some(access), session)
    } else {
        (None, None)
    };
    Ok(Json(
        json!({"identity":identity,"scope":crate::private::token_hash(&format!("{}\0{}",identity.owner,identity.role)),"expiresAt":expires,"sessionExpiresAt":session_expires,"mode":app.config.auth.mode}),
    ))
}
pub async fn renew(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    if app.config.auth.mode == "oidc" {
        app.auth.renew(cookie(&headers)).await?;
    }
    session(State(app), headers).await
}
pub async fn roles(State(app): State<Arc<App>>) -> Result<Json<Value>> {
    demo(&app)?;
    Ok(Json(
        json!({"roles":[{"name":"admin","username":"dev-admin","description":"Admin"},{"name":"viewer","username":"dev-user","description":"Viewer"}]}),
    ))
}
#[derive(Default, Deserialize)]
pub struct Login {
    #[serde(default)]
    role: String,
    #[serde(default, rename = "return")]
    return_to: String,
}
fn html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
pub async fn login_page(
    State(app): State<Arc<App>>,
    Query(request): Query<Login>,
) -> Result<Html<String>> {
    demo(&app)?;
    Ok(Html(format!(
        "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width'><title>Parse Command</title><main><h1>Parse Command</h1><form method=post action=/__ark/mock-login><input type=hidden name=return value=\"{}\"><label>Demo account <select name=role><option value=viewer>Viewer</option><option value=admin>Admin</option></select></label><button type=submit>Sign in</button></form></main></html>",
        html(return_path(&request.return_to))
    )))
}
pub async fn login(State(app): State<Arc<App>>, Form(request): Form<Login>) -> Result<Response> {
    demo(&app)?;
    let token = app.private.create_session(&request.role).await?;
    let mut response = Redirect::to(return_path(&request.return_to)).into_response();
    set_cookie(
        &mut response,
        "parse_command_session",
        &token,
        Some(43200),
        app.config.auth.public_url.starts_with("https:"),
    )?;
    Ok(response)
}
pub async fn oidc_login(
    State(app): State<Arc<App>>,
    Query(request): Query<Login>,
) -> Result<Response> {
    if app.config.auth.mode == "local_demo" {
        return Ok(Redirect::to(&format!(
            "/__ark/mock-login?return={}",
            reqwest::Url::parse(&format!("{}/", app.config.auth.public_url))
                .map_err(|_| Error::unavailable())?
                .query_pairs_mut()
                .append_pair("return", return_path(&request.return_to))
                .finish()
                .query()
                .unwrap_or("return=%2Fcalendar")
                .trim_start_matches("return=")
        ))
        .into_response());
    }
    let (url, binding) = app.auth.begin(&request.return_to).await?;
    let mut response = Redirect::to(&url).into_response();
    set_cookie(
        &mut response,
        "parse_command_login",
        &binding,
        Some(300),
        true,
    )?;
    Ok(response)
}
#[derive(Deserialize)]
pub struct Callback {
    #[serde(default)]
    state: String,
    #[serde(default)]
    code: String,
}
pub async fn callback(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(request): Query<Callback>,
) -> Response {
    let result = app
        .auth
        .callback(
            &request.state,
            &request.code,
            named_cookie(&headers, "parse_command_login").unwrap_or(""),
        )
        .await;
    let mut response = match result {
        Ok((token, path)) => {
            let mut response = Redirect::to(&path).into_response();
            if set_cookie(&mut response, "parse_command_session", &token, None, true).is_err() {
                return Error::unavailable().into_response();
            }
            response
        }
        Err(e) => e.into_response(),
    };
    let _ = set_cookie(&mut response, "parse_command_login", "", Some(0), true);
    response
}
pub async fn logout(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Response> {
    if app.config.auth.mode == "oidc" {
        app.auth.logout(cookie(&headers)).await?;
    } else if let Some(token) = cookie(&headers).and_then(session_token) {
        app.private.logout(token).await?;
    }
    let mut response = Json(json!({"signedOut":true})).into_response();
    set_cookie(
        &mut response,
        "parse_command_session",
        "",
        Some(0),
        app.config.auth.public_url.starts_with("https:"),
    )?;
    Ok(response)
}
pub async fn not_found() -> (StatusCode, Json<Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"code":"not_found","message":"Unknown API route"})),
    )
}

pub async fn ready(State(app): State<Arc<App>>) -> (axum::http::StatusCode, Json<Value>) {
    use std::sync::atomic::Ordering;
    let ready =
        app.status.ready.load(Ordering::Relaxed) && app.status.model.load(Ordering::Relaxed);
    (
        if ready {
            axum::http::StatusCode::OK
        } else {
            axum::http::StatusCode::SERVICE_UNAVAILABLE
        },
        Json(
            json!({"publicationReady": app.status.ready.load(Ordering::Relaxed), "modelReady": app.status.model.load(Ordering::Relaxed)}),
        ),
    )
}
