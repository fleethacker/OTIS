//! Typed application settings, user administration and preferences. No source
//! message content is sent during the bounded model-connection check.
use crate::{
    Error, Result,
    api::{App, Identity},
    private::now,
};
use axum::{
    extract::{Json, Path, State},
    http::HeaderMap,
};
use parse_command_state::{Record, Store};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc, time::Duration};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Ai {
    pub endpoint: String,
    pub model: String,
    pub secret_ref: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub version: u8,
    pub ship_name: String,
    pub unit_name: String,
    pub command_ids: Vec<String>,
    pub outgoing_command: String,
    pub action_authority: String,
    pub default_timezone: String,
    pub ai: Option<Ai>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            ship_name: String::new(),
            unit_name: String::new(),
            command_ids: vec![],
            outgoing_command: String::new(),
            action_authority: String::new(),
            default_timezone: "UTC".into(),
            ai: None,
        }
    }
}
fn bounded(value: &str, max: usize) -> bool {
    value.len() <= max && !value.chars().any(char::is_control)
}
fn authority(value: &str, max: usize) -> bool {
    value.len() <= max
        && value
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b" .,'()&+-".contains(&b))
}
fn allowed_endpoint(value: &str) -> Result<reqwest::Url> {
    let allowed = std::env::var("PARSE_COMMAND_AI_ENDPOINTS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .map(str::to_owned)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    let url = reqwest::Url::parse(value).map_err(|_| Error::invalid("Invalid model endpoint"))?;
    if !allowed
        .iter()
        .any(|a| a.trim_end_matches('/') == value.trim_end_matches('/'))
        || !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::invalid(
            "Model endpoint is not approved in deployment configuration",
        ));
    }
    Ok(url)
}
impl Settings {
    pub fn validate(&self) -> Result<()> {
        if self.version != 1
            || self.default_timezone != "UTC"
            || !bounded(&self.ship_name, 120)
            || !bounded(&self.unit_name, 120)
            || !authority(&self.outgoing_command, 30)
            || !authority(&self.action_authority, 50)
            || self.command_ids.len() > 32
            || self
                .command_ids
                .iter()
                .any(|v| v.is_empty() || !bounded(v, 256))
            || self.command_ids.iter().collect::<BTreeSet<_>>().len() != self.command_ids.len()
        {
            return Err(Error::invalid("Invalid command settings"));
        }
        if let Some(ai) = &self.ai {
            if ai.endpoint.len() > 512
                || ai.model.is_empty()
                || !bounded(&ai.model, 128)
                || !bounded(&ai.secret_ref, 128)
            {
                return Err(Error::invalid("Invalid model settings"));
            }
            allowed_endpoint(&ai.endpoint)?;
            if !ai.secret_ref.is_empty() {
                secret(&ai.secret_ref)?;
            }
        }
        Ok(())
    }
}
fn secret(reference: &str) -> Result<Option<String>> {
    if reference.is_empty() {
        return Ok(None);
    }
    if !reference
        .bytes()
        .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
        || !reference.starts_with("PARSE_COMMAND_AI_SECRET_")
    {
        return Err(Error::invalid("Invalid model secret reference"));
    }
    let allowed = std::env::var("PARSE_COMMAND_AI_SECRET_REFS").unwrap_or_default();
    if !allowed.split(',').map(str::trim).any(|v| v == reference) {
        return Err(Error::invalid("Model secret reference is not approved"));
    }
    let value =
        std::env::var(reference).map_err(|_| Error::config("Model credential is unavailable"))?;
    if value.is_empty() || value.len() > 8192 || value.contains(['\r', '\n']) {
        return Err(Error::config("Invalid model credential"));
    }
    Ok(Some(value))
}
pub fn admin(identity: &Identity) -> Result<()> {
    if identity.role != "admin" {
        return Err(Error::new(
            "permission_denied",
            "Administrator access required",
        ));
    }
    Ok(())
}
pub async fn bootstrap(store: &Store) -> Result<()> {
    if store.get("settings", "shared").await?.is_none() {
        let row = Record::new(
            "settings",
            "shared",
            json!({"settings":Settings::default(),"audit":[]}),
        );
        match store.put(&row, None).await {
            Ok(_) | Err(parse_command_state::Error("state_conflict")) => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}
pub async fn shared(store: &Store) -> Result<(Settings, parse_command_state::Document)> {
    let doc = store
        .get("settings", "shared")
        .await?
        .ok_or_else(|| Error::config("Settings unavailable"))?;
    let settings = serde_json::from_value(doc.record.payload["settings"].clone())
        .map_err(|_| Error::config("Invalid stored settings"))?;
    Ok((settings, doc))
}
pub async fn ensure_demo_user(store: &Store, identity: &Identity) -> Result<()> {
    let old = store.get("user", &identity.owner).await?;
    if let Some(old) = old {
        if old.record.payload["enabled"] != true {
            return Err(Error::new("unauthenticated", "Account disabled"));
        }
        return Ok(());
    }
    let mut row = Record::new(
        "user",
        &identity.owner,
        json!({"username":identity.username,"email":identity.email,"groups":identity.groups,"enabled":true,"epoch":0,"timezone":"UTC","created_at":now(),"last_login":now(),"identity_type":"demo"}),
    );
    row.owner = identity.owner.clone();
    row.category = identity.role.clone();
    store
        .update("user", &identity.owner, |old| {
            Ok(old.cloned().unwrap_or_else(|| row.clone()))
        })
        .await?;
    Ok(())
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub settings: Option<Settings>,
    pub revision: Option<String>,
    pub timezone: Option<String>,
    pub user: Option<String>,
    pub action: Option<String>,
    pub after: Option<String>,
}
fn revision(doc: &parse_command_state::Document) -> String {
    format!("{}:{}", doc.seq, doc.term)
}
async fn command_options(app: &App) -> Result<Vec<String>> {
    let value = app
        .search
        .post(
            &format!("/{}/_search", crate::search::MESSAGES),
            json!({"size":0,"aggs":{"commands":{"terms":{"field":"command_ids","size":500}}}}),
        )
        .await?;
    Ok(value["aggregations"]["commands"]["buckets"]
        .as_array()
        .ok_or_else(Error::unavailable)?
        .iter()
        .filter_map(|v| v["key"].as_str().map(str::to_owned))
        .collect())
}
pub async fn execute(
    app: &App,
    identity: &Identity,
    operation: &str,
    request: Request,
) -> Result<Value> {
    let store = &app.private.state;
    match operation {
        "get" => {
            let (mut settings, doc) = shared(store).await?;
            if identity.role != "admin" {
                settings.ai = None;
            }
            Ok(json!({"settings":settings,"revision":revision(&doc)}))
        }
        "options" => {
            admin(identity)?;
            let endpoints = std::env::var("PARSE_COMMAND_AI_ENDPOINTS")
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>();
            let refs = std::env::var("PARSE_COMMAND_AI_SECRET_REFS")
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>();
            Ok(
                json!({"commands":command_options(app).await?,"aiEndpoints":endpoints,"secretRefs":refs}),
            )
        }
        "update" => {
            admin(identity)?;
            let settings = request
                .settings
                .ok_or_else(|| Error::invalid("Settings are required"))?;
            settings.validate()?;
            let (_, doc) = shared(store).await?;
            if request.revision.as_deref() != Some(&revision(&doc)) {
                return Err(Error::new(
                    "aborted",
                    "Settings changed; reload before saving",
                ));
            }
            if !settings.command_ids.is_empty() {
                let options = command_options(app).await?;
                if settings.command_ids.iter().any(|v| !options.contains(v)) {
                    return Err(Error::invalid("Select an indexed command"));
                }
            }
            let mut row = doc.record.clone();
            let old = row.payload["settings"].clone();
            let new = serde_json::to_value(&settings).map_err(|_| Error::unavailable())?;
            let changed = new
                .as_object()
                .ok_or_else(Error::unavailable)?
                .iter()
                .filter(|(key, v)| old[*key] != **v)
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>();
            let audit = row.payload["audit"]
                .as_array_mut()
                .ok_or_else(Error::unavailable)?;
            if audit.len() >= 10000 {
                return Err(Error::config("Settings audit capacity reached"));
            }
            audit.push(json!({"actor":identity.owner,"at":now(),"prior_revision":revision(&doc),"fields":changed}));
            row.payload["settings"] = new;
            let saved = store.put(&row, Some(&doc)).await?;
            Ok(json!({"settings":settings,"revision":revision(&saved)}))
        }
        "preferences" => {
            let user = store
                .get("user", &identity.owner)
                .await?
                .ok_or_else(Error::unavailable)?;
            Ok(json!({"timezone":user.record.payload["timezone"].as_str().unwrap_or("UTC")}))
        }
        "save-preferences" => {
            let zone = request
                .timezone
                .ok_or_else(|| Error::invalid("Timezone is required"))?;
            zone.parse::<chrono_tz::Tz>()
                .map_err(|_| Error::invalid("Select a valid IANA timezone"))?;
            store
                .update("user", &identity.owner, |old| {
                    let mut row = old
                        .cloned()
                        .ok_or(parse_command_state::Error("state_record"))?;
                    row.payload["timezone"] = json!(zone);
                    Ok(row)
                })
                .await?;
            Ok(json!({"timezone":zone}))
        }
        "users" => {
            admin(identity)?;
            let mut query = json!({"size":51,"query":{"term":{"kind":"user"}},"sort":["key"]});
            if let Some(after) = request.after {
                if after.len() > 256 {
                    return Err(Error::invalid("Invalid user page"));
                }
                query["search_after"] = json!([after]);
            }
            let result = store.search(query).await?;
            let rows = parse_command_state::hits(&result)?;
            let more = rows.len() > 50;
            let users=rows.into_iter().take(50).map(|d|json!({"id":d.record.key,"username":d.record.payload["username"],"email":d.record.payload["email"],"role":d.record.category,"enabled":d.record.payload["enabled"],"lastLogin":d.record.payload["last_login"],"revision":revision(&d)})).collect::<Vec<_>>();
            let next = if more {
                users.last().map(|v| v["id"].clone())
            } else {
                None
            };
            Ok(json!({"users":users,"nextAfter":next}))
        }
        "update-user" => {
            admin(identity)?;
            let key = request
                .user
                .ok_or_else(|| Error::invalid("Select a user"))?;
            let action = request
                .action
                .ok_or_else(|| Error::invalid("Select an action"))?;
            if key == identity.owner && action == "disable" {
                return Err(Error::invalid("You cannot disable your own account"));
            }
            let doc = store
                .get("user", &key)
                .await?
                .ok_or_else(|| Error::invalid("User unavailable"))?;
            if request.revision.as_deref() != Some(&revision(&doc)) {
                return Err(Error::new("aborted", "User changed; reload before saving"));
            }
            let mut row = doc.record.clone();
            match action.as_str() {
                "disable" => row.payload["enabled"] = json!(false),
                "enable" => row.payload["enabled"] = json!(true),
                "revoke" => {}
                _ => return Err(Error::invalid("Invalid user action")),
            }
            row.payload["epoch"] = json!(
                row.payload["epoch"]
                    .as_u64()
                    .unwrap_or(0)
                    .checked_add(1)
                    .ok_or_else(Error::unavailable)?
            );
            if row.payload["access_audit"].is_null() {
                row.payload["access_audit"] = json!([]);
            }
            let audit = row.payload["access_audit"]
                .as_array_mut()
                .ok_or_else(Error::unavailable)?;
            if audit.len() >= 10000 {
                return Err(Error::config("Access audit capacity reached"));
            }
            audit.push(json!({"actor":identity.owner,"action":action,"at":now()}));
            store.put(&row, Some(&doc)).await?;
            Ok(json!({"saved":true}))
        }
        "test-ai" => {
            admin(identity)?;
            let (settings, _) = shared(store).await?;
            let ai = settings
                .ai
                .ok_or_else(|| Error::config("Configure a model connection first"))?;
            let endpoint = allowed_endpoint(&ai.endpoint)?;
            let client = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(2))
                .timeout(Duration::from_secs(5))
                .build()
                .map_err(|_| Error::unavailable())?;
            let mut request = client.get(format!(
                "{}/models",
                endpoint.as_str().trim_end_matches('/')
            ));
            if let Some(token) = secret(&ai.secret_ref)? {
                request = request.bearer_auth(token);
            }
            let mut response = request
                .send()
                .await
                .map_err(|_| Error::new("unavailable", "Model connection failed"))?;
            if !response.status().is_success() {
                return Err(Error::new("unavailable", "Model connection failed"));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| Error::unavailable())? {
                if bytes.len() + chunk.len() > 262144 {
                    return Err(Error::new(
                        "resource_exhausted",
                        "Model response exceeds limit",
                    ));
                }
                bytes.extend_from_slice(&chunk);
            }
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| Error::new("unavailable", "Invalid model response"))?;
            if !value["data"]
                .as_array()
                .is_some_and(|v| v.iter().any(|v| v["id"] == ai.model))
            {
                return Err(Error::config("Configured model is unavailable"));
            }
            Ok(json!({"connected":true}))
        }
        _ => Err(Error::new("not_found", "Unknown settings operation")),
    }
}
pub async fn handle(
    State(app): State<Arc<App>>,
    Path(operation): Path<String>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    Ok(Json(execute(&app, &identity, &operation, request).await?))
}
