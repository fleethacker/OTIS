//! Read-only turnover evidence. Receipt recording time is not issue/schedule/publication time.
use crate::{Error, Result, api::App, private::timestamp};
use axum::{Json, extract::State, http::HeaderMap};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{Connection, OpenFlags, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeSet, path::Path, sync::Arc, time::Duration};

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
    pub since: String,
    pub until: String,
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
    pub recorded_at: Option<String>,
    pub basis: &'static str,
}
fn bound(value: &str) -> Result<DateTime<Utc>> {
    let at = DateTime::parse_from_rfc3339(value).map_err(|_| Error::invalid("Use complete ISO UTC watch bounds"))?.with_timezone(&Utc);
    if !value.ends_with('Z') || !(1..=9999).contains(&chrono::Datelike::year(&at)) || at.timestamp_subsec_nanos() >= 1_000_000_000 || at.timestamp_subsec_nanos() % 1_000_000 != 0 {
        return Err(Error::invalid("Watch bounds require UTC Z and at most millisecond precision"));
    }
    Ok(at)
}
const SOURCE: &str = r#"
  WITH first_receipts AS (
    SELECT body_id,min(sequence) AS sequence FROM receipts WHERE body_id IS NOT NULL GROUP BY body_id
  ), sources AS (
    SELECT p.message_id, p.revision,
      CASE WHEN r.sequence IS NULL THEN p.message_id||'@'||p.revision
           WHEN original.message_id IS NOT NULL THEN p.message_id||'@'||r.revision ELSE NULL END AS message_key,
      r.id AS receipt_id,r.sequence,r.received_at,
      substr(CASE WHEN r.sequence IS NULL THEN coalesce(json_extract(p.core,'$.subject'),json_extract(p.core,'$.type'),'Source record')
        ELSE coalesce(r.subject,json_extract(p.core,'$.type'),'Source record') END,1,256) AS title,
      json_extract(coalesce(original.core,p.core),'$.command_ids') AS command_ids
    FROM projections p
    LEFT JOIN first_receipts f ON f.body_id=p.message_id
    LEFT JOIN receipts r ON r.sequence=f.sequence
    LEFT JOIN projections original ON original.message_id=p.message_id AND original.revision=r.revision AND original.delivery_state='published'
    WHERE p.delivery_state='published'
      AND p.rowid=(SELECT max(other.rowid) FROM projections other WHERE other.message_id=p.message_id AND other.delivery_state='published')
      AND (r.sequence IS NULL OR r.sequence<=?1)
  )
"#;
fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<(String, Option<String>, Option<String>, Option<i64>, Option<String>, String, String)> {
    Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))
}
fn change(raw: (String, Option<String>, Option<String>, Option<i64>, Option<String>, String, String), unknown: bool) -> Result<Change> {
    let (id, key, receipt, sequence, at, title, ids) = raw;
    parse_command_types::validate_hash_id(&id, "message_id").map_err(|_| Error::unavailable())?;
    if ids.len() > 16384 { return Err(Error::new("resource_exhausted", "Command metadata exceeds bound")); }
    let ids: Vec<String> = serde_json::from_str(&ids).map_err(|_| Error::unavailable())?;
    if ids.len() > 32 || ids.iter().any(|id| id.is_empty() || id.len()>256) { return Err(Error::unavailable()); }
    Ok(Change { id, message_key: key, receipt_id: receipt, sequence, title, command_ids: ids,
        recorded_at: if unknown { None } else { Some(timestamp(at.as_deref().ok_or_else(Error::unavailable)?)?) },
        basis: if unknown { "custody_time_unavailable" } else { "first_custody_recording" },
    })
}
pub fn read(path: &Path, request: &Request) -> Result<Value> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.busy_timeout(Duration::from_millis(250))?;
    db.execute_batch("BEGIN")?;
    read_connection(&db, request)
}
pub fn read_connection(db: &Connection, request: &Request) -> Result<Value> {
    request.filters.validate()?;
    let start = bound(&request.since)?;
    let end = bound(&request.until)?;
    if end <= start || end.signed_duration_since(start) > chrono::Duration::days(42) {
        return Err(Error::invalid("Watch window must be positive and at most 42 days"));
    }
    let high: i64 = db.query_row("SELECT coalesce(max(sequence),0) FROM receipts", [], |r| r.get(0))?;
    let watermark = request.watermark.unwrap_or(high);
    if watermark < 0 || watermark > high || request.before.is_some_and(|v| v <= 0 || v > watermark) {
        return Err(Error::invalid("Invalid custody cursor; refresh the watch"));
    }
    let since = start.to_rfc3339_opts(SecondsFormat::Millis, true);
    let until = end.to_rfc3339_opts(SecondsFormat::Millis, true);
    // SQLite dates prune coarsely; chrono enforces the exact half-open boundary below.
    // Keep the cursor over candidate rows so excluded submillisecond edges cannot stall paging.
    let sql = format!("{SOURCE} SELECT message_id,message_key,receipt_id,sequence,received_at,title,command_ids FROM sources WHERE julianday(received_at)>=julianday(?2)-1.0/86400 AND julianday(received_at)<julianday(?3)+1.0/86400 AND (?4 IS NULL OR sequence<?4) ORDER BY sequence DESC LIMIT 201");
    let mut q = db.prepare(&sql)?;
    let mut candidates = Vec::new();
    for r in q.query_map(params![watermark,since,until,request.before], row)? { candidates.push(change(r?, false)?); }
    let more = candidates.len() > PAGE;
    candidates.truncate(PAGE);
    let next = if more { candidates.last().and_then(|r| r.sequence) } else { None };
    let mut dated = Vec::new();
    for candidate in candidates {
        let at = DateTime::parse_from_rfc3339(candidate.recorded_at.as_deref().ok_or_else(Error::unavailable)?).map_err(|_| Error::unavailable())?.with_timezone(&Utc);
        if at >= start && at < end { dated.push(candidate); }
    }
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
    let sql = format!("{SOURCE} SELECT message_id,message_key,receipt_id,sequence,received_at,title,command_ids FROM sources WHERE julianday(received_at) IS NULL ORDER BY message_id LIMIT 51");
    let mut q = db.prepare(&sql)?;
    let mut unknown = Vec::new();
    for r in q.query_map([watermark], row)? { unknown.push(change(r?, true)?); }
    let unknown_limited = unknown.len() > 50;
    unknown.truncate(50);
    let unknown_hidden = unknown.iter().filter(|r| !request.filters.matches(&r.command_ids)).count();
    unknown.retain(|r| request.filters.matches(&r.command_ids));
    Ok(json!({
        "items":visible,"unknownTime":unknown,"unknownHiddenCount":unknown_hidden,"unknownLimited":unknown_limited,
        "returnedNewCount":returned,"hiddenCount":hidden,"hiddenShipIds":hidden_ships,
        "nextBefore":next,"watermark":watermark,"since":since,"until":until,
        "availability":{"newRecords":"available","amended":"not_available","cancelled":"not_available","reviewTransitions":"not_available"},
        "scope":"Published custody projections, first receipt recording; counts cover returned pages only. Unknown times are outside watch counts.",
    }))
}
static CHANGE_READS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
pub async fn list(State(app): State<Arc<App>>, headers: HeaderMap, Json(request): Json<Request>) -> Result<Json<Value>> {
    app.headers_identity(&headers)?;
    let permit = CHANGE_READS.try_acquire().map_err(|_| Error::new("resource_exhausted", "Turnover reads are busy; retry shortly"))?;
    let path = app.config.intake.journal.clone();
    let value = tokio::time::timeout(Duration::from_secs(7), tokio::task::spawn_blocking(move || {
        let _permit = permit; // keep the bound even if the HTTP deadline expires
        read(&path, &request)
    }))
        .await.map_err(|_| Error::unavailable())?.map_err(|_| Error::unavailable())??;
    if value.to_string().len() > 2_097_152 { return Err(Error::new("resource_exhausted", "Turnover response exceeds bound")); }
    Ok(Json(value))
}
