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
//! - Demo reset ([`reset`]): the caller-scoped demo operation sets `lastSeenAt` and
//!   both pins to one chosen time. Only the changes route exposes it, and only with
//!   the Watch Desk demo flag on.
use crate::{Error, Result, api::App};
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
/// Latest configured UTC turnover at or before `now` (yesterday's when every
/// turnover today is still ahead).
fn latest_turnover(turnovers: &[String], now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    turnovers
        .iter()
        .filter_map(|v| NaiveTime::parse_from_str(v, "%H%MZ").ok())
        .map(|time| {
            let today = now.date_naive().and_time(time).and_utc();
            if today > now { today - Duration::days(1) } else { today }
        })
        .max()
}
/// The boundary a new session pins, and which basis produced it.
pub fn pin(user: &Value, turnovers: &[String], now: DateTime<Utc>) -> Value {
    if let Some(seen) = user[LAST_SEEN].as_str().and_then(parse) {
        return json!({"since": millis(seen), "basis": "last_seen"});
    }
    match latest_turnover(turnovers, now) {
        Some(at) => json!({"since": millis(at), "basis": "turnover"}),
        None => json!({"since": millis(now - Duration::hours(24)), "basis": "default_24h"}),
    }
}
/// Days a demo reset may reach back; the same bound as a turnover window.
pub const RESET_DAYS: i64 = 42;
/// The time a demo reset sets. `None` is 06:00Z of the current UTC day (the previous
/// day's while that is still ahead); `"turnover"` is the latest configured turnover
/// at or before `now`, else 24 hours earlier; otherwise a complete ISO UTC time at
/// most millisecond precise, not in the future and within [`RESET_DAYS`].
pub fn reset_time(requested: Option<&str>, turnovers: &[String], now: DateTime<Utc>) -> Result<DateTime<Utc>> {
    let now = DateTime::from_timestamp_millis(now.timestamp_millis()).unwrap_or(now);
    match requested {
        None => {
            let today = now.date_naive().and_time(NaiveTime::from_hms_opt(6, 0, 0).unwrap_or_default()).and_utc();
            Ok(if today > now { today - Duration::days(1) } else { today })
        }
        Some("turnover") => Ok(latest_turnover(turnovers, now).unwrap_or(now - Duration::hours(24))),
        Some(value) => {
            let at = parse(value)
                .filter(|at| {
                    value.ends_with('Z') && at.timestamp_subsec_nanos() % 1_000_000 == 0
                        && (1..=9999).contains(&chrono::Datelike::year(at))
                })
                .ok_or_else(|| Error::invalid("Use a complete ISO UTC time with a Z suffix"))?;
            if at > now {
                return Err(Error::invalid("The time cannot be in the future"));
            }
            if now - at > Duration::days(RESET_DAYS) {
                return Err(Error::invalid("The time must be within the last 42 days"));
            }
            Ok(at)
        }
    }
}
fn pinned_at(at: DateTime<Utc>) -> Value {
    json!({"since": millis(at), "basis": "last_seen"})
}
/// A user record after a demo reset: `last_seen_at` and the visit pin at `at`.
pub fn reset_user(user: &mut Value, at: DateTime<Utc>) {
    user[LAST_SEEN] = json!(millis(at));
    user[PIN] = pinned_at(at);
}
/// A session payload after a demo reset: the pinned boundary at `at`.
pub fn reset_session(session: &mut Value, at: DateTime<Utc>) {
    session[PIN] = pinned_at(at);
}
/// Demo reset for `owner`: `last_seen_at` and the visit pin on the user record, and
/// the pin of the caller's current session, all at `at`.
pub async fn reset(app: &App, headers: &HeaderMap, owner: &str, at: DateTime<Utc>) -> Result<()> {
    let store = &app.private.state;
    store
        .update("user", owner, |old| {
            let mut row = old.cloned().ok_or(parse_command_state::Error("state_read"))?;
            reset_user(&mut row.payload, at);
            Ok(row)
        })
        .await?;
    let token = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(crate::api::session_token);
    if let Some(token) = token {
        let kind = if app.config.auth.mode == "oidc" { "oidc_session" } else { "demo_session" };
        let key = crate::private::token_hash(token);
        if store.get(kind, &key).await?.is_some_and(|d| d.record.owner == owner) {
            store
                .update(kind, &key, |old| {
                    let mut row = old.cloned().ok_or(parse_command_state::Error("state_read"))?;
                    reset_session(&mut row.payload, at);
                    Ok(row)
                })
                .await?;
        }
    }
    Ok(())
}
/// The configured UTC turnovers, else the defaults.
pub async fn turnovers(store: &Store) -> Vec<String> {
    match crate::settings::shared(store).await {
        Ok((settings, _)) => settings.turnover_utc,
        Err(_) => crate::settings::default_turnovers(),
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
