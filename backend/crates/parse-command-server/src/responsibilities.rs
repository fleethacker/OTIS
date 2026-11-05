//! Department and watch responsibilities are metadata, never authentication roles.
use crate::{Error, Result, api::App};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use parse_command_state::{Record, Store};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub message_types: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Update {
    pub name: String,
    pub kind: String,
    pub message_types: Vec<String>,
}
impl Update {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty()
            || self.name.chars().count() > 100
            || self.name.chars().any(char::is_control)
            || !matches!(self.kind.as_str(), "department" | "watch_role")
            || self.message_types.len() > 32
            || self
                .message_types
                .iter()
                .any(|v| v.trim().is_empty() || v.len() > 256 || v.chars().any(char::is_control))
        {
            return Err(Error::invalid(
                "Provide a name of 1–100 characters, department or watch_role, and at most 32 exact message categories",
            ));
        }
        Ok(())
    }
}
pub async fn list(store: &Store) -> Result<Vec<Profile>> {
    store
        .list("responsibility", vec![], 128)
        .await?
        .into_iter()
        .map(|d| serde_json::from_value(d.record.payload).map_err(|_| Error::unavailable()))
        .collect()
}
pub async fn resolve(store: &Store, ids: &[String]) -> Result<Vec<Profile>> {
    let mut result = Vec::new();
    for id in ids.iter().collect::<BTreeSet<_>>() {
        let d=store.get("responsibility",id).await?.ok_or_else(||Error::config("A selected department or watch profile is unavailable; update your account settings"))?;
        result.push(serde_json::from_value(d.record.payload).map_err(|_| Error::unavailable())?);
    }
    Ok(result)
}
pub async fn get(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    let scope = crate::station::effective_scope(&app.private, &identity.owner).await;
    let mut types = parse_command_optask::SUPPORTED_MESSAGE_TYPES
        .iter()
        .map(|s| s.to_string())
        .collect::<BTreeSet<_>>();
    let published = crate::briefing::published(&app.custody).await;
    let available = scope.is_ok() && published.is_ok();
    for d in published.unwrap_or_default() {
        if scope
            .as_ref()
            .is_ok_and(|scope| scope.matches(&d["core"]).unwrap_or(false))
            && let Some(t) = d["core"]["type"].as_str()
        {
            types.insert(t.to_string());
        }
    }
    let limited = types.len() > 256;
    let types = types.into_iter().take(256).collect::<Vec<_>>();
    Ok(Json(
        json!({"items":list(&app.private.state).await?,"messageTypes":types,"messageTypesLimited":limited,"observedTypesAvailable":available}),
    ))
}
async fn save(
    app: &App,
    headers: &HeaderMap,
    id: Option<String>,
    input: Update,
) -> Result<Json<Value>> {
    let actor = app.headers_identity(headers).await?;
    crate::settings::admin(&actor)?;
    input.validate()?;
    let all = list(&app.private.state).await?;
    if all.iter().any(|p| {
        p.name.eq_ignore_ascii_case(input.name.trim())
            && p.kind == input.kind
            && Some(&p.id) != id.as_ref()
    }) {
        return Err(Error::invalid(
            "A profile with this name and kind already exists",
        ));
    }
    if id.is_none() && all.len() >= 128 {
        return Err(Error::new(
            "resource_exhausted",
            "Responsibility profile limit reached",
        ));
    }
    let id = id.unwrap_or(format!("resp_{}", crate::private::random_token()?));
    let before = app.private.state.get("responsibility", &id).await?;
    let profile = Profile {
        id: id.clone(),
        name: input.name.trim().into(),
        kind: input.kind,
        message_types: input
            .message_types
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
    };
    let mut row = Record::new("responsibility", &id, json!(profile));
    row.category = profile.kind.clone();
    app.private.state.put(&row, before.as_ref()).await?;
    app.private.state.refresh().await?;
    Ok(Json(json!({"item":profile})))
}
pub async fn create(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(input): Json<Update>,
) -> Result<Json<Value>> {
    save(&app, &headers, None, input).await
}
pub async fn edit(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<Update>,
) -> Result<Json<Value>> {
    if app
        .private
        .state
        .get("responsibility", &id)
        .await?
        .is_none()
    {
        return Err(Error::new("not_found", "Responsibility profile not found"));
    }
    save(&app, &headers, Some(id), input).await
}
