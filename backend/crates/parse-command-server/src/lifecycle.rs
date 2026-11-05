use crate::{
    Error, Result,
    private::{now, text, timestamp},
};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde_json::{Value, json};
use std::{path::Path, time::Duration};

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS publication_events(sequence INTEGER PRIMARY KEY, message_id TEXT NOT NULL, revision TEXT NOT NULL, stage TEXT NOT NULL, at TEXT NOT NULL, code TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS publication_history ON publication_events(message_id,revision,sequence);")?;
    let columns = db
        .prepare("PRAGMA table_info(publication_events)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !columns.iter().any(|name| name == "job_id") {
        db.execute_batch(
            "ALTER TABLE publication_events ADD COLUMN job_id TEXT NOT NULL DEFAULT '';",
        )?;
    }
    Ok(())
}
/// Static failure categories only; source traffic and remote error prose never enter this log.
pub fn publication_failure(db: &Connection, stage: &str, source: &str, code: &str) -> Result<()> {
    let doc: Value = serde_json::from_str(source).map_err(|_| Error::unavailable())?;
    let id = if stage == "message" {
        text(&doc, "id")
    } else {
        text(&doc, "message_id")
    };
    let revision = text(&doc, "revision");
    if id.is_empty() || revision.is_empty() {
        return Err(Error::unavailable());
    }
    db.execute(
        "INSERT INTO publication_events(message_id,revision,stage,at,code,job_id) VALUES(?,?,?,?,?,?)",
        params![id, revision, stage, now(), code, text(&doc,"id")],
    )?;
    Ok(())
}
fn entry(id: String, milestone: &str, at: &str, detail: &str) -> Result<Value> {
    Ok(
        json!({"id":id,"milestone":milestone,"recordedAt":timestamp(at)?,"detail":detail,"provenance":"custody"}),
    )
}
pub fn read(path: &Path, id: &str, revision: &str) -> Result<Value> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.busy_timeout(Duration::from_millis(250))?;
    let mut entries = Vec::new();
    let mut q = db.prepare("SELECT e.sequence,e.state,e.code,e.at FROM custody_events e JOIN receipts r ON e.receipt_id=r.id WHERE r.body_id=? AND r.revision=? ORDER BY e.sequence LIMIT 501")?;
    for row in q.query_map(params![id, revision], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, String>(3)?,
        ))
    })? {
        let (sequence, state, code, at) = row?;
        let (milestone, detail) = match state.as_str() {
            "staged" => ("ingested", ""),
            "parsed" => ("parsed", ""),
            "duplicate" => ("received_again", ""),
            "quarantined" | "unsupported" | "retrying" | "fetch_failed" | "rejected" => {
                ("ingest_failed", code.as_deref().unwrap_or("ingest_failed"))
            }
            _ => continue,
        };
        entries.push(entry(
            format!("custody-{sequence}"),
            milestone,
            &at,
            detail,
        )?);
    }
    let mut limited = entries.len() > 500;
    entries.truncate(500);
    let has_publication: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='publication_events')",[],|r|r.get(0))?;
    if has_publication {
        let mut q = db.prepare("SELECT sequence,stage,at,code FROM publication_events WHERE message_id=? AND revision=? AND code!='publication_succeeded' ORDER BY sequence LIMIT 501")?;
        let mut count = 0;
        for row in q.query_map(params![id, revision], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })? {
            let (sequence, stage, at, code) = row?;
            if code == "publication_succeeded" {
                continue;
            }
            count += 1;
            if count > 500 {
                limited = true;
                break;
            }
            let detail = match stage.as_str() {
                "message" => "Message indexing failed",
                "passage" => "Search indexing failed",
                "enrich" => "Embedding failed",
                "audit" => "Audit storage failed",
                _ => "Publication failed",
            };
            entries.push(entry(
                format!("publication-{sequence}"),
                "ingest_failed",
                &at,
                detail,
            )?);
        }
    }
    let has_jobs: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='publication_jobs')",
        [],
        |r| r.get(0),
    )?;
    if has_jobs {
        let at: Option<String> = db.query_row("SELECT published_at FROM publication_jobs WHERE kind='message' AND id=? AND json_extract(source,'$.revision')=? AND state='published'",params![format!("{id}:{revision}"),revision],|r|r.get(0)).optional()?.flatten();
        if let Some(at) = at {
            entries.push(entry("indexed".into(), "indexed", &at, "")?);
        }
    }
    let sequence = |entry: &Value| {
        let id = text(entry, "id");
        if let Some(value) = id.strip_prefix("custody-") {
            (0, value.parse::<u64>().unwrap_or(0))
        } else if let Some(value) = id.strip_prefix("publication-") {
            (1, value.parse::<u64>().unwrap_or(0))
        } else {
            (2, 0)
        }
    };
    entries.sort_by(|a, b| {
        text(a, "recordedAt")
            .cmp(text(b, "recordedAt"))
            .then_with(|| sequence(a).cmp(&sequence(b)))
    });
    Ok(json!({"entries":entries,"limited":limited}))
}
