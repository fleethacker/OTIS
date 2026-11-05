//! Per-person "Since last watch" boundary.
//!
//! Dezso owns user lifecycle. This module is the single definition of `lastSeenAt`
//! (stored as `last_seen_at` on the user record) and of the session's pinned
//! `since`; do not derive either anywhere else.
//! - `lastSeenAt`: server UTC time of the user's latest authenticated request,
//!   written at most once per [`SEEN_INTERVAL`] seconds per user.
//! - Session `since`: copied from `lastSeenAt` when a session is created and never
//!   changed for that session. Without a `lastSeenAt`, the latest configured UTC
//!   turnover at session start, else 24 hours before session start.
//! - Without any session (the local auto-role demo), the same pin is kept on the
//!   user record and renewed when a visit starts: the first request after
//!   [`VISIT_GAP`] seconds without one.
use crate::{Result, api::App};
use axum::http::HeaderMap;
use chrono::{DateTime, Duration, NaiveTime, SecondsFormat, Utc};
use parse_command_state::Store;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

pub const SEEN_INTERVAL: i64 = 300;
pub const VISIT_GAP: i64 = 1800;
pub const LAST_SEEN: &str = "last_seen_at";
/// Session payload field holding `{since, basis}`.
pub const PIN: &str = "watch_since";

pub fn millis(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn parse(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|v| v.with_timezone(&Utc))
}
/// Whether a user record's `last_seen_at` is due for an update at `now`.
pub fn seen_due(user: &Value, now: DateTime<Utc>) -> bool {
    user[LAST_SEEN]
        .as_str()
        .and_then(parse)
        .is_none_or(|seen| (now - seen).num_seconds() >= SEEN_INTERVAL || seen > now)
}
/// The boundary a new session pins, and which basis produced it.
pub fn pin(user: &Value, turnovers: &[String], now: DateTime<Utc>) -> Value {
    if let Some(seen) = user[LAST_SEEN].as_str().and_then(parse) {
        return json!({"since": millis(seen), "basis": "last_seen"});
    }
    let latest = turnovers
        .iter()
        .filter_map(|v| NaiveTime::parse_from_str(v, "%H%MZ").ok())
        .map(|time| {
            let today = now.date_naive().and_time(time).and_utc();
            if today > now { today - Duration::days(1) } else { today }
        })
        .max();
    match latest {
        Some(at) => json!({"since": millis(at), "basis": "turnover"}),
        None => json!({"since": millis(now - Duration::hours(24)), "basis": "default_24h"}),
    }
}
/// Pin for a session about to be created for `owner`. Reads the user record before
/// any request of the new session can update `last_seen_at`.
pub async fn session_pin(store: &Store, owner: &str) -> Result<Value> {
    let user = store
        .get("user", owner)
        .await?
        .map(|d| d.record.payload)
        .unwrap_or(Value::Null);
    let turnovers = match crate::settings::shared(store).await {
        Ok((settings, _)) => settings.turnover_utc,
        Err(_) => crate::settings::default_turnovers(),
    };
    Ok(pin(&user, &turnovers, Utc::now()))
}
fn pinned(session: &Value) -> Option<(String, String)> {
    let pin = &session[PIN];
    Some((pin["since"].as_str()?.to_owned(), pin["basis"].as_str()?.to_owned()))
}
static RECENT: LazyLock<Mutex<HashMap<String, i64>>> = LazyLock::new(Default::default);
/// Throttled `last_seen_at` update for an authenticated request. A process-local
/// cache avoids a state read on most requests; the stored time is authoritative.
pub async fn touch(store: &Store, owner: &str) -> Result<()> {
    let now = Utc::now();
    if let Ok(mut recent) = RECENT.lock() {
        if recent
            .get(owner)
            .is_some_and(|at| now.timestamp() - at < SEEN_INTERVAL)
        {
            return Ok(());
        }
        if recent.len() > 4096 {
            recent.clear();
        }
        recent.insert(owner.to_owned(), now.timestamp());
    }
    let Some(user) = store.get("user", owner).await? else {
        return Ok(());
    };
    if !seen_due(&user.record.payload, now) {
        return Ok(());
    }
    let mut row = user.record.clone();
    let visit = user.record.payload[LAST_SEEN]
        .as_str()
        .and_then(parse)
        .is_none_or(|seen| (now - seen).num_seconds() >= VISIT_GAP);
    if visit {
        let turnovers = match crate::settings::shared(store).await {
            Ok((settings, _)) => settings.turnover_utc,
            Err(_) => crate::settings::default_turnovers(),
        };
        row.payload[PIN] = pin(&user.record.payload, &turnovers, now);
    }
    row.payload[LAST_SEEN] = json!(millis(now));
    // A concurrent writer wins; the next due request records the time.
    match store.put(&row, Some(&user)).await {
        Ok(_) | Err(parse_command_state::Error("state_conflict")) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
/// The caller's pinned boundary: `(since, basis)`.
pub async fn since(app: &App, headers: &HeaderMap, owner: &str) -> Result<(String, String)> {
    let token = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(crate::api::session_token);
    if let Some(token) = token {
        let kind = if app.config.auth.mode == "oidc" { "oidc_session" } else { "demo_session" };
        if let Some(doc) = app
            .private
            .state
            .get(kind, &crate::private::token_hash(token))
            .await?
            .filter(|d| d.record.owner == owner)
            && let Some(value) = pinned(&doc.record.payload)
        {
            return Ok(value);
        }
    }
    // No session pin (the local auto-role, or a session created before this field):
    // the visit pin on the user record.
    let user = app.private.state.get("user", owner).await?;
    if let Some(value) = user.as_ref().and_then(|d| pinned(&d.record.payload)) {
        return Ok(value);
    }
    let pin = session_pin(&app.private.state, owner).await?;
    Ok(pinned(&json!({ "watch_since": pin })).unwrap_or_default())
}
