//! Read-only turnover evidence, windowed and ordered by source issue time (the message DTG).
//! Receipt time is kept as custody metadata only; it is not when the message was sent.
//! Reads published projections from the OpenSearch custody index.
use crate::{Error, Result, api::App, private::timestamp};
use axum::{Json, extract::State, http::HeaderMap};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::{BTreeMap, BTreeSet}, sync::Arc, time::Duration};

const PAGE: usize = 200;
#[derive(Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Filters {
    pub command_ids: Vec<String>,
    pub unassigned_only: bool,
    pub no_commands: bool,
}
impl Filters {
    fn matches(&self, ids: &[String]) -> bool {
        !self.no_commands && ((self.command_ids.is_empty() && !self.unassigned_only)
            || (self.unassigned_only && ids.is_empty())
            || ids.iter().any(|id| self.command_ids.contains(id)))
    }
    fn validate(&self) -> Result<()> {
        crate::api::Filters { command_ids: self.command_ids.clone(), unassigned_only: self.unassigned_only,
            no_commands: self.no_commands, ..crate::api::Filters::default() }.validate()?;
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Request {
    /// Omitted: the caller's pinned session boundary (see `crate::watch`).
    #[serde(default)] pub since: Option<String>,
    /// Omitted: now.
    #[serde(default)] pub until: Option<String>,
    #[serde(default)] pub filters: Filters,
    pub before: Option<i64>,
    pub watermark: Option<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub id: String,
    pub message_key: Option<String>,
    pub receipt_id: Option<String>,
    pub sequence: Option<i64>,
    pub title: String,
    pub command_ids: Vec<String>,
    pub issued_at: Option<String>,
    pub recorded_at: Option<String>,
    pub basis: &'static str,
    /// When the caller marked this message reviewed.
    pub reviewed_at: Option<String>,
    /// Events this message contributes, at most [`EVENTS`] per message.
    pub added_events: Vec<Value>,
    pub events_limited: bool,
}
pub const EVENTS: usize = 20;
/// Events a published projection contributes: title, point or interval time (or
/// the unresolved source clock), ship IDs and a recurrence flag. Read from the
/// parsed core only; never from the raw body.
pub fn added_events(core: &Value) -> (Vec<Value>, bool) {
    let ids = core["command_ids"].clone();
    let text = |v: &Value, k: &str| v[k].as_str().map(|s| s.chars().take(128).collect::<String>());
    let mut rules = std::collections::BTreeMap::new();
    let mut events = Vec::new();
    for rule in core["recurrences"].as_array().into_iter().flatten() {
        let summary = json!({"ruleFactId":text(rule,"id"),"rule":text(rule,"rule"),"dtstart":rule["dtstart"],"until":rule["until"]});
        if let Some(activity) = rule["activity_id"].as_str() {
            rules.insert(activity.to_owned(), summary);
        } else {
            events.push(json!({"factId":text(rule,"id"),"title":text(rule,"kind").map(|v| v.replace('_', " ")),
                "kind":"recurring","commandIds":ids,"recurring":true,"recurrence":summary}));
        }
    }
    for fact in core["activities"].as_array().into_iter().flatten() {
        let id = fact["id"].as_str().unwrap_or_default();
        let mut event = json!({"factId":text(fact,"id"),"title":text(fact,"type").map(|v| v.replace('_', " ")),
            "commandIds":ids,"recurring":rules.contains_key(id)});
        if let Some(rule) = rules.get(id) { event["recurrence"] = rule.clone(); }
        if let Some(at) = fact["at"].as_str() {
            event["kind"] = json!("point");
            event["at"] = json!(at);
        } else if let (Some(start), Some(end)) = (fact["start_at"].as_str(), fact["end_at"].as_str()) {
            event["kind"] = json!("interval");
            event["start"] = json!(start);
            event["end"] = json!(end);
        } else {
            event["kind"] = json!("unresolved");
            if let Some(time) = text(fact, "time") { event["time"] = json!(time); }
        }
        events.push(event);
    }
    let limited = events.len() > EVENTS;
    events.truncate(EVENTS);
    (events, limited)
}
fn bound(value: &str) -> Result<DateTime<Utc>> {
    let at = DateTime::parse_from_rfc3339(value).map_err(|_| Error::invalid("Use complete ISO UTC watch bounds"))?.with_timezone(&Utc);
    if !value.ends_with('Z') || !(1..=9999).contains(&chrono::Datelike::year(&at)) || at.timestamp_subsec_nanos() >= 1_000_000_000 || at.timestamp_subsec_nanos() % 1_000_000 != 0 {
        return Err(Error::invalid("Watch bounds require UTC Z and at most millisecond precision"));
    }
    Ok(at)
}
/// One published custody projection, reduced to the metadata Since last watch needs.
/// `sequence` is the custody receipt order of the projection's selected receipt.
#[derive(Clone)]
pub struct Source {
    pub id: String,
    pub message_key: Option<String>,
    pub receipt_id: Option<String>,
    pub sequence: Option<i64>,
    pub recorded_at: Option<String>,
    pub issued_at: Option<String>,
    pub title: String,
    pub command_ids: Vec<String>,
    pub added_events: Vec<Value>,
    pub events_limited: bool,
}
fn change(source: &Source, unknown: bool) -> Result<Change> {
    parse_command_types::validate_hash_id(&source.id, "message_id").map_err(|_| Error::unavailable())?;
    let ids = &source.command_ids;
    if ids.len() > 32 || ids.iter().any(|id| id.is_empty() || id.len() > 256) { return Err(Error::unavailable()); }
    Ok(Change { id: source.id.clone(), message_key: source.message_key.clone(), receipt_id: source.receipt_id.clone(),
        sequence: source.sequence, title: source.title.chars().take(256).collect(), command_ids: ids.clone(),
        issued_at: if unknown { None } else { Some(timestamp(source.issued_at.as_deref().ok_or_else(Error::unavailable)?)?) },
        recorded_at: source.recorded_at.as_deref().and_then(|at| timestamp(at).ok()),
        basis: if unknown { "issue_time_unavailable" } else { "source_issue_time" },
        reviewed_at: None, added_events: source.added_events.clone(), events_limited: source.events_limited,
    })
}
fn issued(source: &Source) -> Option<DateTime<Utc>> {
    source.issued_at.as_deref().and_then(|v| DateTime::parse_from_rfc3339(v).ok()).map(|v| v.with_timezone(&Utc))
}
/// Pure window/paging computation over published custody sources. `high` is the
/// current custody receipt watermark.
pub fn compute(sources: &[Source], high: i64, request: &Request) -> Result<Value> {
    compute_reviewed(sources, high, request, &BTreeMap::new())
}
fn window(request: &Request) -> Result<(DateTime<Utc>, DateTime<Utc>)> {
    request.filters.validate()?;
    let start = bound(request.since.as_deref().ok_or_else(|| Error::invalid("Watch start is required"))?)?;
    let end = bound(request.until.as_deref().ok_or_else(|| Error::invalid("Watch end is required"))?)?;
    if end <= start || end.signed_duration_since(start) > chrono::Duration::days(42) {
        return Err(Error::invalid("Watch window must be positive and at most 42 days"));
    }
    Ok((start, end))
}
fn cursor(request: &Request, high: i64) -> Result<i64> {
    let watermark = request.watermark.unwrap_or(high);
    if watermark < 0 || watermark > high || request.before.is_some_and(|v| v <= 0 || v > watermark) {
        return Err(Error::invalid("Invalid custody cursor; refresh the watch"));
    }
    Ok(watermark)
}
/// Message keys "Mark all reviewed" covers: every visible dated message in the window
/// at or below the watermark (all pages), plus the visible undated list as shown.
pub fn review_all_keys(sources: &[Source], high: i64, request: &Request) -> Result<Vec<String>> {
    let (start, end) = window(request)?;
    let watermark = cursor(request, high)?;
    let current = sources.iter().filter(|s| s.sequence.is_none_or(|v| v <= watermark));
    let mut dated = Vec::new();
    let mut unknown = Vec::new();
    for source in current {
        match issued(source) {
            Some(at) if at >= start && at < end => dated.push(source),
            Some(_) => {}
            None => unknown.push(source),
        }
    }
    unknown.sort_by(|a, b| a.id.cmp(&b.id));
    unknown.truncate(50);
    let mut keys: Vec<String> = dated.into_iter().chain(unknown)
        .filter(|s| request.filters.matches(&s.command_ids))
        .filter_map(|s| s.message_key.clone()).collect();
    keys.sort();
    keys.dedup();
    Ok(keys)
}
/// [`compute`] with the caller's review times (message key to reviewedAt).
pub fn compute_reviewed(sources: &[Source], high: i64, request: &Request, reviews: &BTreeMap<String, String>) -> Result<Value> {
    let (start, end) = window(request)?;
    let watermark = cursor(request, high)?;
    let since = start.to_rfc3339_opts(SecondsFormat::Millis, true);
    let until = end.to_rfc3339_opts(SecondsFormat::Millis, true);
    let current: Vec<&Source> = sources.iter().filter(|s| s.sequence.is_none_or(|v| v <= watermark)).collect();
    // Exact half-open [since, until) on the source issue time (DTG); the cursor follows receipt order.
    let mut candidates: Vec<&Source> = current.iter().copied()
        .filter(|s| issued(s).is_some_and(|at| at >= start && at < end))
        .filter(|s| request.before.is_none_or(|before| s.sequence.is_some_and(|v| v < before)))
        .collect();
    candidates.sort_by(|a, b| b.sequence.cmp(&a.sequence).then(a.id.cmp(&b.id)));
    let more = candidates.len() > PAGE;
    candidates.truncate(PAGE);
    let next = if more { candidates.last().and_then(|r| r.sequence) } else { None };
    let reviewed = |mut c: Change| { c.reviewed_at = c.message_key.as_ref().and_then(|k| reviews.get(k).cloned()); c };
    let mut dated = candidates.into_iter().map(|s| change(s, false).map(reviewed)).collect::<Result<Vec<_>>>()?;
    // Pages follow receipt sequence (stable cursor); within a page, newest sent first.
    dated.sort_by(|a, b| b.issued_at.cmp(&a.issued_at).then(b.sequence.cmp(&a.sequence)));
    let returned = dated.len();
    let mut hidden = 0usize;
    let mut hidden_ships = BTreeSet::new();
    let mut visible = Vec::new();
    for row in dated {
        if request.filters.matches(&row.command_ids) { visible.push(row); }
        else {
            hidden += 1;
            if row.command_ids.is_empty() { hidden_ships.insert("unassigned:".to_owned()); }
            else { hidden_ships.extend(row.command_ids.into_iter().map(|id| format!("unit:{id}"))); }
        }
    }
    // Unknown evidence has no position within [since,until); keep it outside dated counts.
    let mut unknown: Vec<&Source> = current.iter().copied().filter(|s| issued(s).is_none()).collect();
    unknown.sort_by(|a, b| a.id.cmp(&b.id));
    let unknown_limited = unknown.len() > 50;
    unknown.truncate(50);
    let mut unknown = unknown.into_iter().map(|s| change(s, true).map(reviewed)).collect::<Result<Vec<_>>>()?;
    let unknown_hidden = unknown.iter().filter(|r| !request.filters.matches(&r.command_ids)).count();
    unknown.retain(|r| request.filters.matches(&r.command_ids));
    Ok(json!({
        "items":visible,"unknownTime":unknown,"unknownHiddenCount":unknown_hidden,"unknownLimited":unknown_limited,
        "returnedNewCount":returned,"hiddenCount":hidden,"hiddenShipIds":hidden_ships,
        "nextBefore":next,"watermark":watermark,"since":since,"until":until,
        "availability":{"newRecords":"available","amended":"not_available","cancelled":"not_available","reviewTransitions":"not_available"},
        "scope":"Published messages by source issue time (DTG); counts cover returned pages only. Messages without an issue time are listed separately.",
    }))
}
/// Reduce published custody projections to one source per message body. The
/// earliest receipt keeps the message key, so later parser revisions or duplicate
/// receipts never appear as new records.
pub fn sources(docs: &[parse_command_state::Document]) -> Vec<Source> {
    let mut rows: Vec<&parse_command_state::Document> = docs.iter()
        .filter(|d| d.record.kind == "projection" && d.record.state == "published").collect();
    rows.sort_by(|a, b| a.record.order.cmp(&b.record.order).then(a.record.key.cmp(&b.record.key)));
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for doc in rows {
        let core = &doc.record.payload["core"];
        let Some(id) = core["id"].as_str() else { continue };
        if !seen.insert(id.to_owned()) { continue; }
        let ids = core["command_ids"].as_array().map(|v| v.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect()).unwrap_or_default();
        let title = core["subject"].as_str().or(core["type"].as_str()).unwrap_or("Source record");
        let (added_events, events_limited) = added_events(core);
        out.push(Source {
            id: id.into(), message_key: Some(doc.record.key.clone()),
            receipt_id: doc.record.payload["first_receipt"].as_str().map(str::to_owned),
            sequence: (doc.record.order > 0).then_some(doc.record.order),
            recorded_at: doc.record.payload["selected_received_at"].as_str().map(str::to_owned),
            issued_at: core["issued_at"].as_str().map(str::to_owned),
            title: title.into(), command_ids: ids, added_events, events_limited,
        });
    }
    out
}
/// Bounded custody read: at most 1000 published projections at or below the watermark.
async fn custody(store: &parse_command_state::Store, watermark: Option<i64>) -> Result<(Vec<Source>, i64)> {
    let filter = |extra: Vec<Value>| {
        let mut f = vec![json!({"term":{"kind":"projection"}}), json!({"term":{"state":"published"}})];
        f.extend(extra);
        json!({"bool":{"filter":f}})
    };
    let stats = store.search(json!({"size":0,"query":filter(vec![]),"aggs":{"high":{"max":{"field":"order"}}}})).await?;
    let high = stats["aggregations"]["high"]["value"].as_f64().unwrap_or(0.0).max(0.0) as i64;
    let watermark = watermark.unwrap_or(high).clamp(0, high);
    let page = store.search(json!({"size":parse_command_state::MAX_HITS,"query":filter(vec![json!({"range":{"order":{"lte":watermark}}})]),
        "sort":[{"order":"desc"},"key"]})).await?;
    let docs = parse_command_state::hits(&page)?;
    Ok((sources(&docs), high))
}
pub async fn read(store: &parse_command_state::Store, request: &Request) -> Result<Value> {
    let (sources, high) = custody(store, request.watermark).await?;
    compute(&sources, high, request)
}

/// Per-user review state, one document per user (like notification read state).
pub const REVIEWS: &str = "watch_reviews";
pub const MAX_REVIEWS: usize = 5000;
pub const MAX_KEYS: usize = 200;
pub async fn reviews(state: &parse_command_state::Store, owner: &str) -> Result<BTreeMap<String, String>> {
    Ok(state.get(REVIEWS, owner).await?
        .and_then(|d| d.record.payload["reviews"].as_object().cloned())
        .map(|m| m.into_iter().filter_map(|(k, v)| v.as_str().map(|v| (k, v.to_owned()))).collect())
        .unwrap_or_default())
}
fn message_key(key: &str) -> Result<()> {
    let (id, revision) = key.rsplit_once('@').ok_or_else(|| Error::invalid("Invalid message key"))?;
    parse_command_types::validate_hash_id(id, "message_id").map_err(|_| Error::invalid("Invalid message key"))?;
    parse_command_types::validate_revision(revision, "revision").map_err(|_| Error::invalid("Invalid message key"))?;
    Ok(())
}
/// Mark keys reviewed at `at` (an earlier review time is kept) or clear them. Keeps
/// at most [`MAX_REVIEWS`] entries, dropping the oldest reviews first.
pub fn apply_reviews(payload: &mut Value, keys: &[String], at: &str, reviewed: bool) {
    if !payload["reviews"].is_object() { payload["reviews"] = json!({}); }
    let Some(map) = payload["reviews"].as_object_mut() else { return };
    for key in keys {
        if reviewed { map.entry(key.clone()).or_insert_with(|| json!(at)); } else { map.remove(key); }
    }
    if map.len() > MAX_REVIEWS {
        let mut oldest: Vec<(String, String)> = map.iter().map(|(k, v)| (v.as_str().unwrap_or_default().to_owned(), k.clone())).collect();
        oldest.sort();
        for (_, key) in oldest.into_iter().take(map.len() - MAX_REVIEWS) { map.remove(&key); }
    }
}
async fn write_reviews(state: &parse_command_state::Store, owner: &str, keys: &[String], reviewed: bool) -> Result<Value> {
    let at = crate::watch::millis(Utc::now());
    state.update(REVIEWS, owner, |old| {
        let mut row = old.cloned().unwrap_or_else(|| parse_command_state::Record::new(REVIEWS, owner, json!({"reviews":{}})));
        row.owner = owner.into();
        apply_reviews(&mut row.payload, keys, &at, reviewed);
        row.bytes = row.payload.to_string().len() as u64;
        Ok(row)
    }).await?;
    Ok(json!({"messageKeys":keys,"reviewed":reviewed,"reviewedAt":if reviewed { json!(at) } else { Value::Null }}))
}
/// Fill omitted bounds: `since` from the caller's pinned boundary, `until` now. A
/// pinned boundary older than the 42-day window is clamped to it.
async fn bounds(app: &App, headers: &HeaderMap, owner: &str, request: &mut Request) -> Result<(String, bool)> {
    let until = match &request.until {
        Some(v) => bound(v)?,
        None => Utc::now() + chrono::Duration::milliseconds(1),
    };
    request.until = Some(crate::watch::millis(until));
    if request.since.is_some() { return Ok(("explicit".into(), false)); }
    let (since, basis) = crate::watch::since(app, headers, owner).await?;
    let mut at = bound(&since)?;
    let floor = until - chrono::Duration::days(42);
    let clamped = at < floor;
    if clamped { at = floor; }
    if at >= until { at = until - chrono::Duration::milliseconds(1); }
    request.since = Some(crate::watch::millis(at));
    Ok((basis, clamped))
}
static CHANGE_READS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
pub async fn list(State(app): State<Arc<App>>, headers: HeaderMap, Json(mut request): Json<Request>) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    let permit = CHANGE_READS.try_acquire().map_err(|_| Error::new("resource_exhausted", "Turnover reads are busy; retry shortly"))?;
    let value = tokio::time::timeout(Duration::from_secs(7), async {
        let _permit = permit;
        let (basis, clamped) = bounds(&app, &headers, &identity.owner, &mut request).await?;
        let reviewed = reviews(&app.private.state, &identity.owner).await?;
        let (sources, high) = custody(&app.custody, request.watermark).await?;
        let mut value = compute_reviewed(&sources, high, &request, &reviewed)?;
        value["basis"] = json!(basis);
        value["sinceClamped"] = json!(clamped);
        Ok::<_, Error>(value)
    }).await.map_err(|_| Error::unavailable())??;
    if value.to_string().len() > 2_097_152 { return Err(Error::new("resource_exhausted", "Turnover response exceeds bound")); }
    Ok(Json(value))
}
fn yes() -> bool { true }
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Review {
    pub message_keys: Vec<String>,
    /// `false` clears the caller's review.
    #[serde(default = "yes")] pub reviewed: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReviewAll {
    #[serde(default)] pub since: Option<String>,
    #[serde(default)] pub until: Option<String>,
    #[serde(default)] pub filters: Filters,
    /// The `watermark` of the list response being marked.
    pub watermark: i64,
}
/// Caller-scoped review of up to 200 message keys. The actor is the session identity.
pub async fn review(State(app): State<Arc<App>>, headers: HeaderMap, Json(request): Json<Review>) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    let mut keys = request.message_keys;
    if keys.is_empty() || keys.len() > MAX_KEYS { return Err(Error::invalid("Select 1 to 200 messages")); }
    for key in &keys { message_key(key)?; }
    keys.sort();
    keys.dedup();
    Ok(Json(write_reviews(&app.private.state, &identity.owner, &keys, request.reviewed).await?))
}
/// Mark reviewed everything the list showed for the same bounds and filters, never
/// custody that arrived after the response watermark.
pub async fn review_all(State(app): State<Arc<App>>, headers: HeaderMap, Json(request): Json<ReviewAll>) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    let mut list = Request { since: request.since, until: request.until, filters: request.filters, before: None, watermark: Some(request.watermark) };
    bounds(&app, &headers, &identity.owner, &mut list).await?;
    let (sources, high) = custody(&app.custody, list.watermark).await?;
    let keys = review_all_keys(&sources, high, &list)?;
    let mut value = if keys.is_empty() { json!({"messageKeys":[],"reviewed":true,"reviewedAt":null}) }
        else { write_reviews(&app.private.state, &identity.owner, &keys, true).await? };
    value["watermark"] = json!(request.watermark);
    Ok(Json(value))
}
