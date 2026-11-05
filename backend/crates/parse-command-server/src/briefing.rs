//! Frozen login windows over a committed CAS availability ledger; no runtime SQLite.
use crate::{
    Error, Result,
    api::{App, session_token},
    private::{now, text, token_hash},
};
use axum::{Json, extract::State, http::HeaderMap};
use parse_command_state::{Record, Store};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageScope {
    pub all_commands: bool,
    pub command_ids: Vec<String>,
    pub include_unassigned: bool,
    #[serde(default)]
    pub responsibility_ids: Vec<String>,
}
impl Default for MessageScope {
    fn default() -> Self {
        Self {
            all_commands: true,
            command_ids: vec![],
            include_unassigned: true,
            responsibility_ids: vec![],
        }
    }
}
impl MessageScope {
    pub fn validate(&self) -> Result<()> {
        if self.command_ids.len() > 32
            || self
                .command_ids
                .iter()
                .any(|id| id.trim().is_empty() || id.len() > 256)
        {
            return Err(Error::invalid(
                "Select at most 32 exact command IDs of at most 256 bytes",
            ));
        }
        if self.responsibility_ids.len() > 32
            || self.responsibility_ids.iter().any(|id| {
                id.trim().is_empty() || id.len() > 128 || id.chars().any(char::is_control)
            })
        {
            return Err(Error::invalid("Select at most 32 responsibility profiles"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginWindow {
    pub started_at: String,
    pub previous_login_at: Option<String>,
    pub briefing_available: bool,
    #[serde(skip_serializing)]
    pub since: Option<String>,
    #[serde(skip_serializing)]
    pub lower: Option<i64>,
    #[serde(skip_serializing)]
    pub upper: Option<i64>,
    #[serde(skip_serializing)]
    pub window_id: String,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub page_token: Option<String>,
}
pub async fn published(store: &Store) -> Result<Vec<Value>> {
    let doc = store.get("availability_log", "committed").await?;
    match doc {
        Some(doc) => doc.record.payload["entries"]
            .as_array()
            .cloned()
            .ok_or_else(Error::unavailable),
        None => Err(Error::unavailable()),
    }
}
/// Called only after native authentication created a session. The frozen window and
/// user's checkpoint are one CAS write; token refresh never changes this record.
pub async fn capture(app: &App, token: &str) -> Result<()> {
    let kind = if app.config.auth.mode == "oidc" {
        "oidc_session"
    } else {
        "demo_session"
    };
    let key = token_hash(token);
    let session = app
        .private
        .state
        .get(kind, &key)
        .await?
        .ok_or_else(Error::unavailable)?;
    let checkpoint = app
        .custody
        .get("availability_log", "committed")
        .await
        .ok()
        .flatten()
        .and_then(|d| d.record.payload["next"].as_i64());
    let started = now();
    let expires = session.record.expires;
    app.private.state.update("user",&session.record.owner,|old|{
        let mut row=old.cloned().ok_or(parse_command_state::Error("state_missing"))?;
        let mut windows=row.payload["briefingWindows"].as_object().cloned().unwrap_or_default();
        windows.retain(|_,v|v["userEpoch"]==row.payload["epoch"] && v["expires"].as_i64().is_some_and(|e|e==0||e>parse_command_state::epoch()));
        if windows.contains_key(&key) {return Ok(row);}
        if windows.len()>=128 {return Err(parse_command_state::Error("state_capacity"));}
        let started=monotonic_started(&started,&row.payload)?;
        let lower=row.payload["briefingCheckpoint"].as_i64();
        let upper=checkpoint.map(|v|v.max(lower.unwrap_or(0)));
        let window=json!({"startedAt":started,"previousLoginAt":row.payload["briefingLastLogin"],"since":row.payload["briefingSnapshotAt"],"lower":lower,"upper":upper,"windowId":key,"briefingAvailable":upper.is_some()});
        windows.insert(key.clone(),json!({"expires":expires,"userEpoch":row.payload["epoch"],"window":window}));
        row.payload["briefingWindows"]=json!(windows);
        row.payload["previous_login"]=row.payload["briefingLastLogin"].clone();
        row.payload["last_login"]=json!(started);
        row.payload["briefingLastLogin"]=json!(started);
        if let Some(upper)=upper {row.payload["briefingCheckpoint"]=json!(upper);row.payload["briefingSnapshotAt"]=json!(started);}
        Ok(row)
    }).await?;
    Ok(())
}
pub async fn session_window(app: &App, headers: &HeaderMap) -> Result<Option<LoginWindow>> {
    let Some(token) = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(session_token)
    else {
        return Ok(None);
    };
    let identity = app.headers_identity(headers).await?;
    let user = app
        .private
        .state
        .get("user", &identity.owner)
        .await?
        .ok_or_else(Error::unavailable)?;
    let value = &user.record.payload["briefingWindows"][token_hash(token)]["window"];
    if value.is_null() {
        return Ok(None);
    }
    Ok(Some(
        serde_json::from_value(value.clone()).map_err(|_| Error::unavailable())?,
    ))
}
pub fn read_page(
    entries: &[Value],
    window: &LoginWindow,
    scope: &crate::station::ResolvedScope,
    token: Option<&str>,
) -> Result<Value> {
    let upper = window.upper.ok_or_else(|| {
        Error::config("Availability history was unavailable at sign-in; sign in again when ready")
    })?;
    let binding = token_hash(&format!("{}:{}", window.window_id, scope.fingerprint));
    let page = if let Some(token) = token {
        let (fingerprint, page) = token
            .split_once(':')
            .ok_or_else(|| Error::invalid("Invalid briefing page"))?;
        if fingerprint != binding {
            return Err(Error::invalid(
                "Briefing page belongs to a different session or scope",
            ));
        }
        page.parse::<usize>()
            .map_err(|_| Error::invalid("Invalid briefing page"))?
    } else {
        0
    };
    let mut bodies: BTreeMap<String, (i64, Value)> = BTreeMap::new();
    for e in entries {
        let seq = e["sequence"].as_i64().ok_or_else(Error::unavailable)?;
        if seq > upper {
            continue;
        }
        let id = text(&e["core"], "id").to_owned();
        match bodies.get_mut(&id) {
            Some((first, latest)) => {
                *first = (*first).min(seq);
                if seq > latest["sequence"].as_i64().unwrap_or(0) {
                    *latest = e.clone();
                }
            }
            None => {
                bodies.insert(id, (seq, e.clone()));
            }
        }
    }
    let mut rows = Vec::new();
    for (first, e) in bodies.into_values() {
        if first <= window.lower.unwrap_or(0) || !scope.matches(&e["core"])? {
            continue;
        }
        rows.push((first, e));
    }
    rows.sort_by_key(|(first, _)| std::cmp::Reverse(*first));
    let start = page
        .checked_mul(20)
        .ok_or_else(|| Error::invalid("Invalid briefing page"))?;
    if page > 0 && start >= rows.len() {
        return Err(Error::invalid("Briefing page unavailable"));
    }
    let items=rows.iter().skip(start).take(20).map(|(_,e)|{
        let c=&e["core"];json!({"messageKey":e["messageKey"],"subject":text(c,"subject"),"type":text(c,"type"),"originator":text(c,"originator"),"issuedAt":c["issued_at"],"availableAt":e["availableAt"],"commandIds":c["command_ids"]})
    }).collect::<Vec<_>>();
    Ok(
        json!({"items":items,"since":window.since,"through":window.started_at,"firstLogin":window.lower.is_none(),"totalRecords":rows.len(),"page":page+1,"pageSize":20,"nextPageToken":(start+20<rows.len()).then(||format!("{binding}:{}",page+1)),"previousPageToken":(page>0).then(||format!("{binding}:{}",page.saturating_sub(1))),"stationContext":scope.context}),
    )
}
pub async fn handle(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    let window = session_window(&app, &headers)
        .await?
        .ok_or_else(|| Error::config("Sign in again to capture a shift briefing"))?;
    let scope = crate::station::effective_scope(&app.private, &identity.owner).await?;
    let mut result = read_page(
        &published(&app.custody).await?,
        &window,
        &scope,
        request.page_token.as_deref(),
    )?;
    result["messageScope"] = json!(
        crate::accounts::preferences(&app.private.state, &identity.owner)
            .await?
            .message_scope
    );
    Ok(Json(result))
}
pub async fn commands(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    let user = crate::accounts::account(&app.private.state, &identity.owner).await?;
    let scope = crate::station::resolve(
        &app.private.state,
        &user,
        &MessageScope::default(),
        crate::station::required()?,
    )
    .await?;
    let mut ids = std::collections::BTreeSet::new();
    for e in published(&app.custody).await? {
        if scope.matches(&e["core"])? {
            for id in e["core"]["command_ids"].as_array().into_iter().flatten() {
                if let Some(id) = id.as_str()
                    && scope.command_visible(id)
                {
                    ids.insert(id.to_owned());
                }
            }
        }
    }
    let limited = ids.len() > 256;
    Ok(Json(
        json!({"commandIds":ids.into_iter().take(256).collect::<Vec<_>>(),"limited":limited}),
    ))
}
/// A ledger append and its committed high-water mark are the same document update.
pub fn append(old: Option<&Record>, core: &Value, at: &str) -> parse_command_state::Result<Record> {
    let mut row = old.cloned().unwrap_or_else(|| {
        Record::new(
            "availability_log",
            "committed",
            json!({"entries":[],"next":0}),
        )
    });
    let key = format!("{}@{}", text(core, "id"), text(core, "revision"));
    let entries = row.payload["entries"]
        .as_array()
        .ok_or(parse_command_state::Error("state_record"))?;
    if entries.iter().any(|e| e["messageKey"] == key) {
        return Ok(row);
    }
    if entries.len() >= 20000 {
        return Err(parse_command_state::Error("state_capacity"));
    }
    let seq = row.payload["next"]
        .as_i64()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or(parse_command_state::Error("state_capacity"))?;
    let metadata = json!({"id":core["id"],"revision":core["revision"],"subject":core["subject"],"type":core["type"],"originator":core["originator"],"issued_at":core["issued_at"],"command_ids":core["command_ids"]});
    row.payload["entries"]
        .as_array_mut()
        .ok_or(parse_command_state::Error("state_record"))?
        .push(json!({"messageKey":key,"core":metadata,"availableAt":at,"sequence":seq}));
    row.payload["next"] = json!(seq);
    Ok(row)
}
/// Session lifecycle updates retention only, never the frozen sequence interval.
pub async fn retention(store: &Store, owner: &str, key: &str, expires: Option<i64>) -> Result<()> {
    store
        .update("user", owner, |old| {
            let mut row = old
                .cloned()
                .ok_or(parse_command_state::Error("state_missing"))?;
            if let Some(windows) = row.payload["briefingWindows"].as_object_mut() {
                if let Some(expires) = expires {
                    if let Some(window) = windows.get_mut(key) {
                        window["expires"] = json!(expires);
                    }
                } else {
                    windows.remove(key);
                }
            }
            Ok(row)
        })
        .await?;
    Ok(())
}

fn monotonic_started(candidate: &str, user: &Value) -> parse_command_state::Result<String> {
    let mut started = chrono::DateTime::parse_from_rfc3339(candidate)
        .map_err(|_| parse_command_state::Error("state_record"))?;
    for field in ["briefingSnapshotAt", "briefingLastLogin"] {
        if let Some(old) = user[field].as_str() {
            started = started.max(
                chrono::DateTime::parse_from_rfc3339(old)
                    .map_err(|_| parse_command_state::Error("state_record"))?,
            );
        }
    }
    Ok(started
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn out_of_order_login_cas_never_moves_snapshot_time_backwards() {
        let old = json!({"briefingLastLogin":"2026-11-05T12:00:00.000Z","briefingSnapshotAt":"2026-11-05T12:00:00.000Z"});
        assert_eq!(
            monotonic_started("2026-11-05T11:59:59.000Z", &old).unwrap(),
            "2026-11-05T12:00:00.000Z"
        );
        assert_eq!(
            monotonic_started("2026-11-05T12:00:01.000Z", &old).unwrap(),
            "2026-11-05T12:00:01.000Z"
        );
    }
}
