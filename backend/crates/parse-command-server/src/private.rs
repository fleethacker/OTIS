use crate::{Error, Result};
use rusqlite::{Connection, OptionalExtension, params, types::ValueRef};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};
pub struct Private {
    pub db: Connection,
}
pub fn protected_dir(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::config("private database directory is required"))?;
    std::fs::create_dir_all(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
pub fn now() -> String {
    {
        let elapsed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("UTC clock unavailable");
        chrono::DateTime::from_timestamp(
            i64::try_from(elapsed.as_secs()).expect("UTC clock out of range"),
            elapsed.subsec_nanos(),
        )
        .expect("UTC clock out of range")
        .to_rfc3339_opts(chrono::SecondsFormat::Nanos, true)
    }
}
impl Private {
    pub fn open(path: &Path, legacy: Option<&Path>) -> Result<Self> {
        protected_dir(path)?;
        let db = Connection::open(path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
        db.busy_timeout(std::time::Duration::from_secs(2))?;
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if ![0, 1].contains(&version) {
            return Err(Error::config("unsupported private schema"));
        }
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA cache_size=-512; PRAGMA max_page_count=65536;
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS identities(id INTEGER PRIMARY KEY, source_key TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS drafts(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,source_key TEXT NOT NULL,text TEXT NOT NULL,saved_at TEXT NOT NULL,UNIQUE(owner,source_key));
        CREATE TABLE IF NOT EXISTS preparations(owner TEXT NOT NULL,source_key TEXT NOT NULL,fields_json TEXT NOT NULL DEFAULT '{}',generated_text TEXT NOT NULL DEFAULT '',acknowledged INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,source_key));
        CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,source_key TEXT NOT NULL,kind TEXT NOT NULL,note TEXT NOT NULL,recorded_at TEXT NOT NULL,occurred_at TEXT);
        CREATE INDEX IF NOT EXISTS activity_scope ON activity(owner,source_key,id);
        CREATE TABLE IF NOT EXISTS cursors(token TEXT PRIMARY KEY,pit TEXT NOT NULL,after_json TEXT NOT NULL,fingerprint TEXT NOT NULL,expires INTEGER NOT NULL,UNIQUE(pit,after_json,fingerprint));
        CREATE TABLE IF NOT EXISTS read_windows(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,role TEXT NOT NULL,expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS migration(id TEXT PRIMARY KEY,source_hash TEXT NOT NULL,counts TEXT NOT NULL,recorded_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS legacy_messages(source_key TEXT PRIMARY KEY,document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS legacy_orphans(kind TEXT NOT NULL,id INTEGER NOT NULL,document TEXT NOT NULL,PRIMARY KEY(kind,id));
        PRAGMA user_version=1;COMMIT;")?;
        crate::notifications::initialize(&db)?;
        let mut this = Self { db };
        if let Some(legacy) = legacy {
            if !legacy.exists() {
                return Err(Error::config("configured legacy database is missing"));
            }
            this.migrate(legacy)?;
        }
        Ok(this)
    }
    pub fn id(&self, key: &str) -> Result<i64> {
        self.db.execute(
            "INSERT OR IGNORE INTO identities(source_key) VALUES(?)",
            [key],
        )?;
        Ok(self
            .db
            .query_row("SELECT id FROM identities WHERE source_key=?", [key], |r| {
                r.get(0)
            })?)
    }
    pub fn draft(&self, owner: &str, key: &str) -> Result<Value> {
        let row = self
            .db
            .query_row(
                "SELECT id,text,saved_at FROM drafts WHERE owner=? AND source_key=?",
                params![owner, key],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        match row {
            None => Ok(json!({})),
            Some((id, text, saved)) => Ok(
                json!({"draft":{"id":id.to_string(),"messageId":self.id(key)?.to_string(),"text":text,"status":"unsent","savedAt":timestamp(&saved)?}}),
            ),
        }
    }
    pub fn save_draft(&mut self, owner: &str, key: &str, text: &str) -> Result<Value> {
        if text.len() > 65_536 {
            return Err(Error::invalid("Draft exceeds 65536 UTF-8 bytes"));
        }
        self.db.execute("INSERT INTO drafts(owner,source_key,text,saved_at) VALUES(?,?,?,?) ON CONFLICT(owner,source_key) DO UPDATE SET text=excluded.text,saved_at=excluded.saved_at",params![owner,key,text,now()])?;
        self.draft(owner, key)
    }
    pub fn preparation(&self, owner: &str, key: &str) -> Result<Value> {
        let row=self.db.query_row("SELECT fields_json,generated_text,acknowledged FROM preparations WHERE owner=? AND source_key=?",params![owner,key],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,bool>(2)?))).optional()?;
        let (fields, text, ack) = row.unwrap_or_else(|| ("{}".into(), String::new(), false));
        let mut statement=self.db.prepare("SELECT id,kind,note,recorded_at,occurred_at FROM activity WHERE owner=? AND source_key=? ORDER BY id DESC LIMIT 100")?;
        let rows = statement.query_map(params![owner, key], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })?;
        let mut history = Vec::new();
        for row in rows {
            let (id, kind, note, recorded, occurred) = row?;
            history.push(json!({"id":id,"kind":kind,"recorder":owner,"recorded_at":recorded,"occurred_at":occurred,"note":note,"provenance":"user-reported"}));
        }
        history.reverse();
        Ok(
            json!({"fieldsJson":fields,"generatedText":text,"acknowledged":ack,"historyJson":serde_json::to_string(&history).map_err(|_|Error::unavailable())?}),
        )
    }
    pub fn save_preparation(
        &mut self,
        owner: &str,
        key: &str,
        raw: &str,
        generate: bool,
    ) -> Result<Value> {
        let (fields, text) = crate::preparation::prepare(raw, generate)?;
        let tx = self.db.transaction()?;
        tx.execute("INSERT INTO preparations(owner,source_key,fields_json,generated_text) VALUES(?,?,?,?) ON CONFLICT(owner,source_key) DO UPDATE SET fields_json=excluded.fields_json,generated_text=excluded.generated_text",params![owner,key,fields,text])?;
        tx.execute(
            "INSERT INTO activity(owner,source_key,kind,note,recorded_at) VALUES(?,?,?,'',?)",
            params![
                owner,
                key,
                if generate { "generated" } else { "saved" },
                now()
            ],
        )?;
        tx.commit()?;
        self.preparation(owner, key)
    }
    pub fn acknowledge(
        &mut self,
        owner: &str,
        key: &str,
        ack: bool,
        confirmed: bool,
        note: &str,
        occurred: &str,
    ) -> Result<Value> {
        if ack && !confirmed {
            return Err(Error::invalid(
                "Confirm that acknowledgement occurred outside Parse Command",
            ));
        }
        if note.chars().count() > 2000 || !crate::preparation::clean(note) {
            return Err(Error::invalid(
                "Acknowledgement note exceeds bounds or contains control characters",
            ));
        }
        let occurred = if occurred.is_empty() {
            None
        } else {
            Some(timestamp(occurred)?)
        };
        let tx = self.db.transaction()?;
        tx.execute("INSERT INTO preparations(owner,source_key,acknowledged) VALUES(?,?,?) ON CONFLICT(owner,source_key) DO UPDATE SET acknowledged=excluded.acknowledged",params![owner,key,ack])?;
        tx.execute("INSERT INTO activity(owner,source_key,kind,note,recorded_at,occurred_at) VALUES(?,?,?,?,?,?)",params![owner,key,if ack{"acknowledged"}else{"reset"},note,now(),occurred])?;
        tx.commit()?;
        self.preparation(owner, key)
    }
    // At most 64 windows of 512 KiB; idle windows expire before their 120s PIT.
    pub fn put_read_window(&self, fingerprint: &str, value: &Value) -> Result<String> {
        let payload = value.to_string();
        if payload.len() > 524_288 {
            return Err(Error::new(
                "resource_exhausted",
                "Result window exceeds configured bound",
            ));
        }
        self.db
            .execute("DELETE FROM read_windows WHERE expires<unixepoch()", [])?;
        let count: i64 = self
            .db
            .query_row("SELECT count(*) FROM read_windows", [], |r| r.get(0))?;
        if count >= 64 {
            return Err(Error::new(
                "resource_exhausted",
                "Result window limit reached; retry after inactive searches expire",
            ));
        }
        let mut random = [0u8; 32];
        std::fs::File::open("/dev/urandom")?.read_exact(&mut random)?;
        let id = random
            .iter()
            .map(|v| format!("{v:02x}"))
            .collect::<String>();
        self.db.execute(
            "INSERT INTO read_windows VALUES(?,?,?,unixepoch()+110)",
            params![id, fingerprint, payload],
        )?;
        Ok(id)
    }
    pub fn read_window(&self, id: &str, fingerprint: &str) -> Result<Value> {
        let payload: Option<String> = self.db.query_row("SELECT payload FROM read_windows WHERE id=? AND fingerprint=? AND expires>=unixepoch()", params![id,fingerprint], |r|r.get(0)).optional()?;
        let payload = payload
            .ok_or_else(|| Error::invalid("Results expired or changed; refresh the search"))?;
        if payload.len() > 524_288 {
            return Err(Error::config("Result window bound"));
        }
        self.db.execute(
            "UPDATE read_windows SET expires=unixepoch()+110 WHERE id=? AND fingerprint=?",
            params![id, fingerprint],
        )?;
        serde_json::from_str(&payload).map_err(|_| Error::config("Invalid result window"))
    }
    pub fn save_read_window(&self, id: &str, fingerprint: &str, value: &Value) -> Result<()> {
        let payload = value.to_string();
        if payload.len() > 524_288 {
            return Err(Error::new(
                "resource_exhausted",
                "Result window exceeds configured bound",
            ));
        }
        if self.db.execute("UPDATE read_windows SET payload=?,expires=unixepoch()+110 WHERE id=? AND fingerprint=? AND expires>=unixepoch()", params![payload,id,fingerprint])? != 1 { return Err(Error::invalid("Results expired; refresh the search")); }
        Ok(())
    }
    pub fn cursor(&self, pit: &str, after: &Value, fingerprint: &str) -> Result<String> {
        self.db
            .execute("DELETE FROM cursors WHERE expires<unixepoch()", [])?;
        let payload = after.to_string();
        let old: Option<String> = self
            .db
            .query_row(
                "SELECT token FROM cursors WHERE pit=? AND after_json=? AND fingerprint=?",
                params![pit, payload, fingerprint],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(old) = old {
            return Ok(old);
        }
        let count: i64 = self
            .db
            .query_row("SELECT count(*) FROM cursors", [], |r| r.get(0))?;
        if count >= 64 {
            return Err(Error::new(
                "resource_exhausted",
                "Browsing cursor limit reached; retry after a minute",
            ));
        }
        let mut random = [0u8; 32];
        std::fs::File::open("/dev/urandom")?.read_exact(&mut random)?;
        let token = random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        self.db.execute(
            "INSERT INTO cursors VALUES(?,?,?,?,unixepoch()+55)",
            params![token, pit, payload, fingerprint],
        )?;
        Ok(token)
    }
    pub fn create_session(&self, role: &str) -> Result<String> {
        let mut random = [0u8; 32];
        std::fs::File::open("/dev/urandom")?.read_exact(&mut random)?;
        let token = random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        self.db
            .execute("DELETE FROM sessions WHERE expires<unixepoch()", [])?;
        let count: i64 = self
            .db
            .query_row("SELECT count(*) FROM sessions", [], |r| r.get(0))?;
        if count >= 256 {
            return Err(Error::new(
                "resource_exhausted",
                "Demo session limit reached",
            ));
        }
        self.db.execute(
            "INSERT INTO sessions VALUES(?,?,unixepoch()+43200)",
            params![format!("{:x}", Sha256::digest(token.as_bytes())), role],
        )?;
        Ok(token)
    }
    pub fn session(&self, token: &str) -> Result<Option<String>> {
        if token.len() != 64 {
            return Ok(None);
        }
        Ok(self
            .db
            .query_row(
                "SELECT role FROM sessions WHERE token_hash=? AND expires>=unixepoch()",
                [format!("{:x}", Sha256::digest(token.as_bytes()))],
                |r| r.get(0),
            )
            .optional()?)
    }
    pub fn logout(&self, token: &str) -> Result<()> {
        self.db.execute(
            "DELETE FROM sessions WHERE token_hash=?",
            [format!("{:x}", Sha256::digest(token.as_bytes()))],
        )?;
        Ok(())
    }
    pub fn legacy(&self, key: &str) -> Result<Value> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT document FROM legacy_messages WHERE source_key=?",
                [key],
                |r| r.get(0),
            )
            .optional()?;
        serde_json::from_str(
            &value.ok_or_else(|| Error::new("not_found", "Legacy record unavailable"))?,
        )
        .map_err(|_| Error::unavailable())
    }
    pub fn legacy_list(&self) -> Result<Vec<Value>> {
        let mut q = self
            .db
            .prepare("SELECT document FROM legacy_messages ORDER BY source_key LIMIT 100")?;
        let mut values = Vec::new();
        for row in q.query_map([], |r| r.get::<_, String>(0))? {
            values.push(serde_json::from_str(&row?).map_err(|_| Error::unavailable())?);
        }
        Ok(values)
    }
    fn migrate(&mut self, path: &Path) -> Result<()> {
        if path.metadata()?.len() > 268_435_456 {
            return Err(Error::config(
                "Legacy private database exceeds migration bound",
            ));
        }
        let done: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM migration WHERE id='go-v1')",
            [],
            |r| r.get(0),
        )?;
        if done {
            return Ok(());
        }
        // The source is frozen by the deployment cutover. SQLite may need SHM
        // even for read-only WAL databases; keep those files off the source mount.
        let parent = Path::new(self.db.path().ok_or_else(Error::unavailable)?)
            .parent()
            .ok_or_else(Error::unavailable)?;
        let snapshot = LegacySnapshot::copy(path, parent)?;
        let source = Connection::open_with_flags(
            &snapshot.path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        source.execute_batch("PRAGMA query_only=ON;")?;
        let mut counts = serde_json::Map::new();
        for table in [
            "message_records",
            "draft_acknowledgements",
            "acknowledgement_preparations",
            "acknowledgement_activities",
        ] {
            let count: i64 =
                source.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?;
            if count > 50000 {
                return Err(Error::config("Legacy row limit exceeded"));
            }
            counts.insert(table.into(), json!(count));
        }
        let tx = self.db.transaction()?;
        let mut identities = std::collections::HashMap::new();
        for mut row in read_table(&source, "message_records")? {
            let id = row["id"]
                .as_i64()
                .ok_or_else(|| Error::config("Legacy message identity"))?;
            let key = format!(
                "legacy:{}",
                row["source_message_id"]
                    .as_str()
                    .ok_or_else(|| Error::config("Legacy source identity"))?
            );
            let events = read_where(&source, "extracted_events", "message_record_events", id)?;
            let mut all = Vec::new();
            for mut event in events {
                let eid = event["id"]
                    .as_i64()
                    .ok_or_else(|| Error::config("Legacy event identity"))?;
                event["revisions"] = json!(read_where(
                    &source,
                    "event_revisions",
                    "extracted_event_revisions",
                    eid
                )?);
                all.push(event);
            }
            row["events"] = json!(all);
            row["source_key"] = json!(key);
            tx.execute(
                "INSERT INTO legacy_messages VALUES(?,?)",
                params![key, row.to_string()],
            )?;
            identities.insert(id, key);
        }
        for (table, fk) in [
            ("draft_acknowledgements", "message_record_drafts"),
            (
                "acknowledgement_preparations",
                "message_record_preparations",
            ),
            (
                "acknowledgement_activities",
                "message_record_acknowledgement_activities",
            ),
        ] {
            for row in read_table(&source, table)? {
                let id = row["id"]
                    .as_i64()
                    .ok_or_else(|| Error::config("Legacy private identity"))?;
                let key = identities
                    .get(&row[fk].as_i64().unwrap_or(-1))
                    .ok_or_else(|| Error::config("Legacy source reference is orphaned"))?;
                let Some(owner) = row["owner_subject"].as_str().filter(|v| !v.is_empty()) else {
                    tx.execute(
                        "INSERT INTO legacy_orphans VALUES(?,?,?)",
                        params![table, id, row.to_string()],
                    )?;
                    continue;
                };
                if table == "draft_acknowledgements" {
                    if row["status"] != "unsent" {
                        return Err(Error::config("Unexpected legacy draft state"));
                    }
                    tx.execute(
                        "INSERT INTO drafts(id,owner,source_key,text,saved_at) VALUES(?,?,?,?,?)",
                        params![
                            id,
                            owner,
                            key,
                            text(&row, "text"),
                            timestamp(text(&row, "saved_at"))?
                        ],
                    )?;
                } else if table == "acknowledgement_preparations" {
                    tx.execute(
                        "INSERT INTO preparations VALUES(?,?,?,?,?)",
                        params![
                            owner,
                            key,
                            text(&row, "fields_json"),
                            text(&row, "generated_text"),
                            row["acknowledged"].as_i64().unwrap_or(0) != 0
                        ],
                    )?;
                } else {
                    let occurred = row["occurred_at"].as_str().map(timestamp).transpose()?;
                    tx.execute("INSERT INTO activity(id,owner,source_key,kind,note,recorded_at,occurred_at) VALUES(?,?,?,?,?,?,?)",params![id,owner,key,text(&row,"kind"),text(&row,"note"),timestamp(text(&row,"recorded_at"))?,occurred])?;
                }
            }
        }
        tx.execute(
            "INSERT INTO migration VALUES('go-v1',?,?,?)",
            params![&snapshot.digest, json!(counts).to_string(), now()],
        )?;
        tx.commit()?;
        Ok(())
    }
}
pub fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub fn timestamp(value: &str) -> Result<String> {
    let parsed = chrono::DateTime::parse_from_rfc3339(value)
        .or_else(|_| chrono::DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f%:z"))
        .map_err(|_| Error::invalid("An explicit valid RFC3339 timestamp is required"))?;
    if !(1..=9999).contains(&chrono::Datelike::year(&parsed)) {
        return Err(Error::invalid("Invalid timestamp year"));
    }
    Ok(parsed
        .to_utc()
        .to_rfc3339_opts(chrono::SecondsFormat::Nanos, true))
}
fn read_table(db: &Connection, table: &str) -> Result<Vec<Value>> {
    read_query(db, &format!("SELECT * FROM {table}"), &[])
}
fn read_where(db: &Connection, table: &str, field: &str, id: i64) -> Result<Vec<Value>> {
    read_query(
        db,
        &format!("SELECT * FROM {table} WHERE {field}=?"),
        &[&id],
    )
}
fn read_query(db: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> Result<Vec<Value>> {
    let mut query = db.prepare(sql)?;
    let columns = query
        .column_names()
        .iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>();
    let mut rows = query.query(params)?;
    let mut result = Vec::new();
    let mut bytes = 0usize;
    while let Some(row) = rows.next()? {
        let mut obj = serde_json::Map::new();
        for (i, key) in columns.iter().enumerate() {
            let value = match row.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(x) => json!(x),
                ValueRef::Real(x) => json!(x),
                ValueRef::Text(s) => {
                    json!(std::str::from_utf8(s).map_err(|_| Error::config("Legacy UTF-8"))?)
                }
                ValueRef::Blob(s) => {
                    json!(std::str::from_utf8(s).map_err(|_| Error::config("Legacy JSON blob"))?)
                }
            };
            obj.insert(key.clone(), value);
        }
        let value = Value::Object(obj);
        bytes = bytes.saturating_add(value.to_string().len());
        if bytes > 16_777_216 || result.len() >= 50000 {
            return Err(Error::config("Legacy migration selection exceeds bounds"));
        }
        result.push(value);
    }
    Ok(result)
}

struct LegacySnapshot {
    directory: std::path::PathBuf,
    path: std::path::PathBuf,
    digest: String,
}
impl Drop for LegacySnapshot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}
impl LegacySnapshot {
    fn copy(source: &Path, parent: &Path) -> Result<Self> {
        let directory = parent.join("legacy-import");
        // Only fixed import filenames are retained after an interrupted startup.
        std::fs::create_dir_all(&directory)?;
        for name in ["source.sqlite", "source.sqlite-wal", "source.sqlite-shm"] {
            match std::fs::remove_file(directory.join(name)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        let mut snapshot = Self {
            path: directory.join("source.sqlite"),
            directory,
            digest: String::new(),
        };
        let mut hash = Sha256::new();
        let mut total = 0u64;
        for suffix in ["", "-wal"] {
            let original = std::path::PathBuf::from(format!("{}{suffix}", source.display()));
            if suffix == "-wal" && !original.exists() {
                continue;
            }
            let metadata = original.metadata()?;
            total = total.saturating_add(metadata.len());
            if total > 268_435_456 {
                return Err(Error::config("Legacy snapshot exceeds migration bound"));
            }
            let copied = std::path::PathBuf::from(format!("{}{suffix}", snapshot.path.display()));
            std::fs::copy(&original, &copied)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&copied, std::fs::Permissions::from_mode(0o600))?;
            }
            hash.update(suffix.as_bytes());
            let mut file = std::fs::File::open(&copied)?;
            let mut buffer = [0u8; 65536];
            loop {
                let n = file.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
            if original.metadata()?.modified()? != metadata.modified()? {
                return Err(Error::config(
                    "Legacy source changed during import; stop its writer first",
                ));
            }
        }
        snapshot.digest = format!("{:x}", hash.finalize());
        Ok(snapshot)
    }
}
