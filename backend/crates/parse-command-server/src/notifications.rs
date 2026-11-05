//! Small durable notification inbox, derived only from recorded custody events.
use crate::{Error, Result, api::App, private::timestamp};
use axum::{
    extract::{Json, Path, State},
    http::HeaderMap,
};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::Path as FilePath, sync::Arc, time::Duration};

const BATCH: i64 = 256;
const PAGE: i64 = 20;

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS notification_clock(singleton INTEGER PRIMARY KEY CHECK(singleton=1),value INTEGER NOT NULL);
        INSERT OR IGNORE INTO notification_clock VALUES(1,0);
        CREATE TABLE IF NOT EXISTS notification_cursors(stream TEXT PRIMARY KEY,sequence INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,group_key TEXT UNIQUE NOT NULL,version INTEGER NOT NULL,kind TEXT NOT NULL,context TEXT NOT NULL,source_key TEXT NOT NULL,at TEXT NOT NULL,detail TEXT NOT NULL,resolved_at TEXT,count INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX IF NOT EXISTS notifications_version ON notifications(version DESC);
        CREATE TABLE IF NOT EXISTS notification_members(notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,source_key TEXT NOT NULL,subject TEXT NOT NULL,context TEXT NOT NULL,at TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(notification_id,source_key));
        CREATE TABLE IF NOT EXISTS notification_seen(source_key TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS notification_incidents(scope TEXT PRIMARY KEY,notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS notification_reads(owner TEXT NOT NULL,notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,version INTEGER NOT NULL,PRIMARY KEY(owner,notification_id));
        CREATE TABLE IF NOT EXISTS notification_inboxes(owner TEXT PRIMARY KEY,read_through INTEGER NOT NULL);")?;
    Ok(())
}

fn next(db: &Connection) -> Result<i64> {
    Ok(db.query_row(
        "UPDATE notification_clock SET value=value+1 WHERE singleton=1 RETURNING value",
        [],
        |r| r.get(0),
    )?)
}
fn add(
    db: &Connection,
    kind: &str,
    group: &str,
    source: &Source,
    at: &str,
    detail: &str,
) -> Result<i64> {
    let version = next(db)?;
    Ok(db.query_row("INSERT INTO notifications(group_key,version,kind,context,source_key,at,detail) VALUES(?,?,?,?,?,?,?) RETURNING id",
        params![group,version,kind,source.context,source.key,at,detail],|r|r.get(0))?)
}
#[derive(Default)]
struct Source {
    key: String,
    subject: String,
    context: String,
}
fn source(row: &rusqlite::Row<'_>, offset: usize) -> rusqlite::Result<Source> {
    let key = row.get::<_, Option<String>>(offset)?.unwrap_or_default();
    let subject = row
        .get::<_, Option<String>>(offset + 1)?
        .unwrap_or_default();
    let kind = row
        .get::<_, Option<String>>(offset + 2)?
        .unwrap_or_default();
    let originator = row
        .get::<_, Option<String>>(offset + 3)?
        .unwrap_or_default();
    let context = [kind, originator]
        .into_iter()
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    Ok(Source {
        key,
        subject: subject.chars().take(240).collect(),
        context: context.chars().take(240).collect(),
    })
}
fn failure(db: &Connection, scope: &str, source: &Source, at: &str, detail: &str) -> Result<()> {
    let open: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM notification_incidents WHERE scope=?)",
        [scope],
        |r| r.get(0),
    )?;
    if !open {
        let id = add(
            db,
            "failed",
            &format!("failure:{scope}:{}", next(db)?),
            source,
            at,
            detail,
        )?;
        db.execute(
            "INSERT INTO notification_incidents VALUES(?,?)",
            params![scope, id],
        )?;
    }
    Ok(())
}
fn recovery(db: &Connection, scope: &str, source: &Source, at: &str) -> Result<()> {
    let id: Option<i64> = db
        .query_row(
            "SELECT notification_id FROM notification_incidents WHERE scope=?",
            [scope],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = id {
        db.execute(
            "UPDATE notifications SET resolved_at=? WHERE id=?",
            params![at, id],
        )?;
        add(db, "recovered", &format!("recovery:{id}"), source, at, "")?;
        db.execute("DELETE FROM notification_incidents WHERE scope=?", [scope])?;
    }
    Ok(())
}
fn traffic(db: &Connection, source: &Source, at: &str) -> Result<()> {
    let body = source
        .key
        .rsplit_once('@')
        .map_or(source.key.as_str(), |(body, _)| body);
    if source.key.is_empty()
        || db.execute("INSERT OR IGNORE INTO notification_seen VALUES(?)", [body])? == 0
    {
        return Ok(());
    }
    let seconds = chrono::DateTime::parse_from_rfc3339(at)
        .map_err(|_| Error::unavailable())?
        .timestamp();
    let group = format!("traffic:{}", seconds.div_euclid(300));
    let previous: Option<i64> = db
        .query_row(
            "SELECT id FROM notifications WHERE group_key=?",
            [&group],
            |r| r.get(0),
        )
        .optional()?;
    let id = if let Some(id) = previous {
        let version = next(db)?;
        db.execute("UPDATE notifications SET count=count+1,version=?,at=max(at,?),context='',source_key='' WHERE id=?",params![version,at,id])?;
        id
    } else {
        add(db, "traffic", &group, source, at, "")?
    };
    db.execute(
        "INSERT INTO notification_members SELECT id,?,?,?, ?,version FROM notifications WHERE id=?",
        params![source.key, source.subject, source.context, at, id],
    )?;
    Ok(())
}

/// Incremental replay is atomic with its cursor. Retrying/restarting cannot duplicate notices.
/// Current status flags, inferred profiles, named places and draft edits are never alert sources.
pub fn sync(db: &mut Connection, path: &FilePath) -> Result<bool> {
    let journal = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    journal.busy_timeout(Duration::from_millis(250))?;
    let tx = db.transaction()?;
    let mut catching_up = false;
    for stream in ["custody", "publication"] {
        let cursor: i64 = tx
            .query_row(
                "SELECT sequence FROM notification_cursors WHERE stream=?",
                [stream],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0);
        let sql = if stream == "custody" {
            "SELECT e.sequence,e.state,e.at,e.receipt_id,COALESCE(e.code,''),CASE WHEN p.delivery_state='published' THEN p.message_id||'@'||p.revision END,COALESCE(json_extract(p.core,'$.subject'),r.subject),json_extract(p.core,'$.type'),json_extract(p.core,'$.originator') FROM custody_events e JOIN receipts r ON r.id=e.receipt_id LEFT JOIN projections p ON p.message_id=r.body_id AND p.revision=r.revision WHERE e.sequence>? ORDER BY e.sequence LIMIT ?"
        } else {
            "SELECT e.sequence,e.code,e.at,e.message_id||'@'||e.revision||':'||e.stage||':'||e.job_id,e.stage,CASE WHEN p.delivery_state='published' THEN p.message_id||'@'||p.revision END,json_extract(p.core,'$.subject'),json_extract(p.core,'$.type'),json_extract(p.core,'$.originator') FROM publication_events e LEFT JOIN projections p ON p.message_id=e.message_id AND p.revision=e.revision WHERE e.sequence>? ORDER BY e.sequence LIMIT ?"
        };
        let mut q = journal.prepare(sql)?;
        let rows = q.query_map(params![cursor, BATCH], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                source(r, 5)?,
            ))
        })?;
        let mut last = cursor;
        let mut count = 0;
        for row in rows {
            let (seq, state, at, scope, code, source) = row?;
            let at = timestamp(&at)?;
            let scope = format!("{stream}:{scope}");
            if stream == "custody" {
                match state.as_str() {
                    "quarantined" | "unsupported" | "retrying" | "fetch_failed" | "rejected" => {
                        failure(&tx, &scope, &source, &at, intake_reason(&code))?
                    }
                    "parsed" | "duplicate" => recovery(&tx, &scope, &source, &at)?,
                    _ => {}
                }
            } else if state == "publication_succeeded" {
                recovery(&tx, &scope, &source, &at)?;
                if code == "message" {
                    traffic(&tx, &source, &at)?;
                }
            } else {
                let detail = match code.as_str() {
                    "message" => "Message indexing failed",
                    "passage" => "Search indexing failed",
                    "enrich" => "Embedding failed",
                    "audit" => "Audit storage failed",
                    _ => "Publication failed",
                };
                failure(&tx, &scope, &source, &at, detail)?;
            }
            last = seq;
            count += 1;
        }
        tx.execute("INSERT INTO notification_cursors VALUES(?,?) ON CONFLICT(stream) DO UPDATE SET sequence=excluded.sequence",params![stream,last])?;
        catching_up |= count == BATCH;
    }
    // The inbox is a bounded convenience view. Full custody/audit history is untouched.
    tx.execute("DELETE FROM notifications WHERE id IN (SELECT id FROM notifications ORDER BY version DESC LIMIT -1 OFFSET 5000)",[])?;
    tx.commit()?;
    Ok(catching_up)
}
fn intake_reason(code: &str) -> &'static str {
    if code.contains("size") || code.contains("limit") {
        "Message exceeds intake limits"
    } else if code.contains("mime") || code.contains("encoding") || code.contains("utf") {
        "Email body could not be decoded"
    } else if code.contains("unsupported") || code.contains("profile") {
        "Message format could not be matched"
    } else if code.contains("fetch") {
        "Email retrieval failed"
    } else if code.contains("journal") || code.contains("storage") {
        "Message storage failed"
    } else {
        "Message processing failed"
    }
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub before: Option<i64>,
    pub id: Option<i64>,
    pub version: Option<i64>,
    pub through: Option<i64>,
}
fn positive(value: Option<i64>) -> Result<i64> {
    value
        .filter(|v| *v > 0 && *v <= 9_007_199_254_740_991)
        .ok_or_else(|| Error::invalid("Invalid notification selection"))
}
pub fn execute(
    db: &mut Connection,
    owner: &str,
    operation: &str,
    request: Request,
) -> Result<Value> {
    let watermark: i64 = db.query_row("SELECT value FROM notification_clock", [], |r| r.get(0))?;
    match operation {
        "list" => {
            let before = match request.before {
                Some(v) => positive(Some(v))?,
                None => i64::MAX,
            };
            let read_through: i64 = db
                .query_row(
                    "SELECT read_through FROM notification_inboxes WHERE owner=?",
                    [owner],
                    |r| r.get(0),
                )
                .optional()?
                .unwrap_or(0);
            let unread: i64 = db.query_row("SELECT count(*) FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.owner=? WHERE n.version>max(?,COALESCE(r.version,0))",params![owner,read_through],|r|r.get(0))?;
            let mut q = db.prepare("SELECT n.id,n.version,n.kind,n.context,n.source_key,n.at,n.detail,n.resolved_at,n.count,n.version>max(?,COALESCE(r.version,0)) FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.owner=? WHERE n.version<? ORDER BY n.version DESC LIMIT ?")?;
            let mut items = q.query_map(params![read_through,owner,before,PAGE+1],|r| Ok(json!({"id":r.get::<_,i64>(0)?,"version":r.get::<_,i64>(1)?,"kind":r.get::<_,String>(2)?,"context":r.get::<_,String>(3)?,"messageKey":r.get::<_,String>(4)?,"at":r.get::<_,String>(5)?,"detail":r.get::<_,String>(6)?,"resolvedAt":r.get::<_,Option<String>>(7)?,"count":r.get::<_,i64>(8)?,"unread":r.get::<_,bool>(9)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
            let more = items.len() > PAGE as usize;
            items.truncate(PAGE as usize);
            let before = if more {
                items.last().map(|v| v["version"].clone())
            } else {
                None
            };
            Ok(json!({"items":items,"unread":unread,"watermark":watermark,"nextBefore":before}))
        }
        "members" => {
            let id = positive(request.id)?;
            let before = match request.before {
                Some(v) => positive(Some(v))?,
                None => i64::MAX,
            };
            let mut q=db.prepare("SELECT source_key,subject,context,at,version FROM notification_members WHERE notification_id=? AND version<? ORDER BY version DESC LIMIT ?")?;
            let mut items=q.query_map(params![id,before,PAGE+1],|r|Ok(json!({"messageKey":r.get::<_,String>(0)?,"subject":r.get::<_,String>(1)?,"context":r.get::<_,String>(2)?,"at":r.get::<_,String>(3)?,"version":r.get::<_,i64>(4)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
            let more = items.len() > PAGE as usize;
            items.truncate(PAGE as usize);
            let before = if more {
                items.last().map(|v| v["version"].clone())
            } else {
                None
            };
            Ok(json!({"items":items,"nextBefore":before}))
        }
        "read" => {
            if let Some(through) = request.through {
                if request.id.is_some()
                    || request.version.is_some()
                    || through < 0
                    || through > watermark
                {
                    return Err(Error::invalid("Invalid read snapshot"));
                }
                db.execute("INSERT INTO notification_inboxes VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET read_through=max(read_through,excluded.read_through)",params![owner,through])?;
            } else {
                let id = positive(request.id)?;
                let version = positive(request.version)?;
                let current: Option<i64> = db
                    .query_row("SELECT version FROM notifications WHERE id=?", [id], |r| {
                        r.get(0)
                    })
                    .optional()?;
                if current.is_none_or(|v| version > v) {
                    return Err(Error::invalid("Notification is unavailable"));
                }
                db.execute("INSERT INTO notification_reads VALUES(?,?,?) ON CONFLICT(owner,notification_id) DO UPDATE SET version=max(version,excluded.version)",params![owner,id,version])?;
            }
            Ok(json!({"saved":true}))
        }
        _ => Err(Error::new("not_found", "Unknown notification operation")),
    }
}
pub async fn handle(
    State(app): State<Arc<App>>,
    Path(operation): Path<String>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Result<([(String, String); 1], Json<Value>)> {
    let owner = app.headers_identity(&headers)?.username;
    let value = tokio::task::spawn_blocking(move || {
        let mut store = app.store()?;
        let catching_up = sync(&mut store.db, &app.config.intake.journal)?;
        let mut result = execute(&mut store.db, &owner, &operation, request)?;
        result["catchingUp"] = json!(catching_up);
        Ok::<_, Error>(result)
    })
    .await
    .map_err(|_| Error::unavailable())??;
    Ok(([("Cache-Control".into(), "no-store".into())], Json(value)))
}
