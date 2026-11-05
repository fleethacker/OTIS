use crate::{IntakeError, Result, config::Config};
use parse_command_types::{AuditEvent, Message, event_id, message_id};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};

pub struct Journal {
    db: Connection,
}
pub struct Job {
    pub receipt_id: String,
    pub raw: Vec<u8>,
    pub received_at: String,
    pub server_received_at: Option<String>,
    pub attempts: u32,
    pub sequence: i64,
}
pub struct Receipt<'a> {
    pub validity: u32,
    pub uid: u32,
    pub size: u32,
    pub raw: Option<&'a [u8]>,
    pub state: &'a str,
    pub code: Option<&'a str>,
    pub received_at: &'a str,
    pub server_received_at: Option<&'a str>,
}
impl Journal {
    pub fn open(c: &Config) -> Result<Self> {
        prepare_directory(&c.journal)?;
        let db = Connection::open(&c.journal)?;
        db.busy_timeout(std::time::Duration::from_secs(2))?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA cache_size=-2048; PRAGMA wal_autocheckpoint=128; PRAGMA journal_size_limit=1048576;")?;
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if ![0, 1, 2].contains(&version) {
            return Err(IntakeError("journal_schema_version"));
        }
        let page: i64 = db.query_row("PRAGMA page_size", [], |r| r.get(0))?;
        db.pragma_update(
            None,
            "max_page_count",
            i64::try_from(c.max_database_bytes / (page as u64))
                .map_err(|_| IntakeError("database_limit"))?,
        )?;
        let current_pages: i64 = db.query_row("PRAGMA page_count", [], |r| r.get(0))?;
        if current_pages as u64 > c.max_database_bytes / (page as u64) {
            return Err(IntakeError("existing_database_limit"));
        }
        db.execute_batch("BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS identity(account_id TEXT PRIMARY KEY, host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL, mailbox TEXT NOT NULL, revision TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS cursors(account_id TEXT NOT NULL, mailbox TEXT NOT NULL, validity INTEGER NOT NULL, uid INTEGER NOT NULL, PRIMARY KEY(account_id,mailbox,validity));
          CREATE TABLE IF NOT EXISTS receipts(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,account_id TEXT NOT NULL,mailbox TEXT NOT NULL,validity INTEGER NOT NULL,uid INTEGER NOT NULL,size INTEGER NOT NULL,raw BLOB,raw_hash TEXT,received_at TEXT NOT NULL,state TEXT NOT NULL,code TEXT,attempts INTEGER NOT NULL DEFAULT 0,body_id TEXT,revision TEXT,subject TEXT,metadata TEXT,UNIQUE(account_id,mailbox,validity,uid));
          CREATE INDEX IF NOT EXISTS receipt_state ON receipts(state,sequence);
          CREATE INDEX IF NOT EXISTS receipt_body ON receipts(body_id,revision);
          CREATE TABLE IF NOT EXISTS custody_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,receipt_id TEXT NOT NULL REFERENCES receipts(id),state TEXT NOT NULL,code TEXT,at TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS custody_receipt ON custody_events(receipt_id,sequence);
          CREATE TABLE IF NOT EXISTS projections(message_id TEXT NOT NULL,revision TEXT NOT NULL,core TEXT NOT NULL,selected_sequence INTEGER NOT NULL,subject_conflict INTEGER NOT NULL,delivery_state TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(message_id,revision));
          CREATE TABLE IF NOT EXISTS audit_outbox(id TEXT PRIMARY KEY,message_id TEXT NOT NULL,revision TEXT NOT NULL,receipt_id TEXT NOT NULL REFERENCES receipts(id),document TEXT NOT NULL,delivery_state TEXT NOT NULL DEFAULT 'pending');
          COMMIT;")?;
        if version < 2 {
            db.execute_batch("BEGIN IMMEDIATE;ALTER TABLE receipts ADD COLUMN server_received_at TEXT;PRAGMA user_version=2;COMMIT;")?;
        }
        let stored: Option<(String, u16, String, String, String)> = db
            .query_row(
                "SELECT host,port,username,mailbox,revision FROM identity WHERE account_id=?",
                [&c.account_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;
        let wanted = (
            c.host.clone(),
            c.port,
            c.username.clone(),
            c.mailbox.clone(),
            c.revision.clone(),
        );
        if let Some(stored) = stored {
            if stored != wanted {
                return Err(IntakeError("journal_identity_changed"));
            }
        } else {
            db.execute(
                "INSERT INTO identity VALUES(?,?,?,?,?,?)",
                params![
                    c.account_id,
                    c.host,
                    c.port,
                    c.username,
                    c.mailbox,
                    c.revision
                ],
            )?;
        }
        Ok(Self { db })
    }
    pub fn cursor(&self, c: &Config, validity: u32) -> Result<u32> {
        Ok(self
            .db
            .query_row(
                "SELECT uid FROM cursors WHERE account_id=? AND mailbox=? AND validity=?",
                params![c.account_id, c.mailbox, validity],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0))
    }
    fn capacity(db: &Connection, c: &Config, extra: u64, new_receipts: u64) -> Result<()> {
        let (count,bytes):(i64,i64)=db.query_row("SELECT (SELECT count(*) FROM receipts), COALESCE((SELECT sum(length(raw)+COALESCE(length(metadata),0)+COALESCE(length(subject),0)) FROM receipts),0)+COALESCE((SELECT sum(length(core)) FROM projections),0)+COALESCE((SELECT sum(length(document)) FROM audit_outbox),0)",[],|r|Ok((r.get(0)?,r.get(1)?)))?;
        if (count as u64).saturating_add(new_receipts) > c.max_receipts
            || (bytes as u64).saturating_add(extra) > c.max_retained_bytes
        {
            return Err(IntakeError("custody_capacity"));
        }
        Ok(())
    }
    pub fn check_capacity(&self, c: &Config) -> Result<()> {
        Self::capacity(&self.db, c, c.max_raw_bytes as u64, 1)
    }
    pub fn accept(&mut self, c: &Config, r: Receipt<'_>) -> Result<bool> {
        if r.validity == 0
            || r.uid == 0
            || !matches!(
                r.state,
                "staged" | "oversized_upstream" | "vanished_upstream"
            )
            || ((r.state == "staged") != r.raw.is_some())
            || r.raw
                .is_some_and(|raw| raw.len() != r.size as usize || raw.len() > c.max_raw_bytes)
        {
            return Err(IntakeError("receipt_invariant"));
        }
        if let Some(time) = r.server_received_at {
            parse_command_types::UtcTimestamp::new(time)
                .map_err(|_| IntakeError("server_receipt_time"))?;
        }
        parse_command_types::UtcTimestamp::new(r.received_at)
            .map_err(|_| IntakeError("receipt_time"))?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let id = event_id(&[
            &c.account_id,
            &c.mailbox,
            &r.validity.to_string(),
            &r.uid.to_string(),
        ]);
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM receipts WHERE id=?)",
            [&id],
            |r| r.get(0),
        )?;
        let hash = r
            .raw
            .map(|raw| format!("sha256:{:x}", <sha2::Sha256 as sha2::Digest>::digest(raw)));
        if exists {
            let old: (u32, Option<String>) = tx.query_row(
                "SELECT size,raw_hash FROM receipts WHERE id=?",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if old != (r.size, hash.clone()) {
                return Err(IntakeError("receipt_identity_collision"));
            }
        }
        if !exists {
            Self::capacity(&tx, c, r.raw.map_or(0, |v| v.len()) as u64, 1)?;
            tx.execute("INSERT INTO receipts(id,account_id,mailbox,validity,uid,size,raw,raw_hash,received_at,state,code,server_received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",params![id,c.account_id,c.mailbox,r.validity,r.uid,r.size,r.raw,hash,r.received_at,r.state,r.code,r.server_received_at])?;
            tx.execute(
                "INSERT INTO custody_events(receipt_id,state,code,at) VALUES(?,?,?,?)",
                params![id, r.state, r.code, r.received_at],
            )?;
        }
        Self::advance(&tx, c, r.validity, r.uid)?;
        tx.commit()?;
        Ok(!exists)
    }
    fn advance(db: &Connection, c: &Config, validity: u32, uid: u32) -> Result<()> {
        db.execute("INSERT INTO cursors VALUES(?,?,?,?) ON CONFLICT(account_id,mailbox,validity) DO UPDATE SET uid=max(uid,excluded.uid)",params![c.account_id,c.mailbox,validity,uid])?;
        Ok(())
    }
    pub fn advance_empty_range(&mut self, c: &Config, validity: u32, uid: u32) -> Result<()> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        Self::advance(&tx, c, validity, uid)?;
        tx.commit()?;
        Ok(())
    }
    pub fn missing_received_times(&self, c: &Config, validity: u32) -> Result<Vec<u32>> {
        let mut stmt=self.db.prepare("SELECT uid FROM receipts WHERE account_id=? AND validity=? AND server_received_at IS NULL ORDER BY sequence LIMIT ?")?;
        Ok(stmt
            .query_map(params![c.account_id, validity, c.uid_window], |r| r.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub fn backfill_received_time(
        &self,
        c: &Config,
        validity: u32,
        uid: u32,
        time: &str,
    ) -> Result<()> {
        self.db.execute("UPDATE receipts SET server_received_at=? WHERE account_id=? AND validity=? AND uid=? AND server_received_at IS NULL",params![time,c.account_id,validity,uid])?;
        Ok(())
    }
    pub fn next_job(&self, c: &Config) -> Result<Option<Job>> {
        Ok(self.db.query_row("SELECT id,raw,received_at,attempts,sequence,server_received_at FROM receipts WHERE state='staged' AND account_id=? ORDER BY sequence LIMIT 1",[&c.account_id],|r|Ok(Job{receipt_id:r.get(0)?,raw:r.get(1)?,received_at:r.get(2)?,attempts:r.get(3)?,sequence:r.get(4)?,server_received_at:r.get(5)?})).optional()?)
    }
    pub fn attempt(&self, id: &str) -> Result<()> {
        self.db.execute(
            "UPDATE receipts SET attempts=attempts+1 WHERE id=? AND state='staged'",
            [id],
        )?;
        Ok(())
    }
    pub fn release_attempt(&self, id: &str) -> Result<()> {
        self.db.execute(
            "UPDATE receipts SET attempts=max(attempts-1,0) WHERE id=? AND state='staged'",
            [id],
        )?;
        Ok(())
    }
    pub fn identify_body(&self, id: &str, body: &str, revision: &str) -> Result<()> {
        self.db.execute(
            "UPDATE receipts SET body_id=?,revision=? WHERE id=? AND state='staged'",
            params![message_id(body), revision, id],
        )?;
        Ok(())
    }
    pub fn record_retry(&self, id: &str, code: &str) -> Result<()> {
        self.db.execute(
            "INSERT INTO custody_events(receipt_id,state,code,at) VALUES(?,'retrying',?,?)",
            params![id, code, crate::now()?],
        )?;
        Ok(())
    }
    pub fn quarantine(&mut self, id: &str, state: &str, code: &str) -> Result<()> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.execute(
            "UPDATE receipts SET state=?,code=? WHERE id=? AND state='staged'",
            params![state, code, id],
        )? > 0
        {
            tx.execute(
                "INSERT INTO custody_events(receipt_id,state,code,at) VALUES(?,?,?,?)",
                params![id, state, code, crate::now()?],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn finish(
        &mut self,
        c: &Config,
        job: &Job,
        mut core: Message,
        audit: Vec<AuditEvent>,
        email: crate::mime::Email,
    ) -> Result<()> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let staged: bool = tx.query_row(
            "SELECT state='staged' FROM receipts WHERE id=?",
            [&job.receipt_id],
            |r| r.get(0),
        )?;
        if !staged {
            return Ok(());
        }
        if core.id != message_id(&email.body) {
            return Err(IntakeError("body_identity"));
        }
        let previous:Option<(String,i64,bool)>=tx.query_row("SELECT core,selected_sequence,subject_conflict FROM projections WHERE message_id=? AND revision=?",params![core.id,core.revision],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        let duplicate = previous.is_some();
        let mut select = true;
        let mut conflict = false;
        let mut selected_sequence = job.sequence;
        if let Some((old, sequence, had_conflict)) = &previous {
            let old: Message =
                serde_json::from_str(old).map_err(|_| IntakeError("journal_document"))?;
            let previous_subject: Option<String> = tx.query_row(
                "SELECT subject FROM receipts WHERE sequence=?",
                [sequence],
                |r| r.get(0),
            )?;
            conflict = *had_conflict || previous_subject != email.subject;
            let old_received: Option<String> = tx.query_row(
                "SELECT server_received_at FROM receipts WHERE sequence=?",
                [sequence],
                |r| r.get(0),
            )?;
            select = match (&job.server_received_at, old_received.as_ref()) {
                (Some(new), Some(old)) => new > old || (new == old && job.sequence > *sequence),
                _ => {
                    if !core
                        .review_flags
                        .iter()
                        .any(|v| v == "subject_order_review")
                    {
                        core.review_flags.push("subject_order_review".into());
                    }
                    false
                }
            };
            if !select {
                selected_sequence = *sequence;
            }
            // Domain projection is body/revision-owned; only approved receipt display metadata changes.
            let order_review = core
                .review_flags
                .iter()
                .any(|v| v == "subject_order_review");
            core = old;
            if order_review
                && !core
                    .review_flags
                    .iter()
                    .any(|v| v == "subject_order_review")
            {
                core.review_flags.push("subject_order_review".into());
            }
            if select {
                core.subject = parse_command_parser_api::display_subject(email.subject.as_deref())
                    .map(str::to_owned);
            }
        }
        if conflict && !core.review_flags.iter().any(|s| s == "subject_conflict") {
            core.review_flags.push("subject_conflict".into());
        }
        core.validate()
            .map_err(|_| IntakeError("projection_validation"))?;
        let core_json = serde_json::to_string(&core).map_err(|_| IntakeError("projection_json"))?;
        let metadata =
            serde_json::to_string(&email.metadata).map_err(|_| IntakeError("metadata_json"))?;
        let mut events = Vec::new();
        if !duplicate {
            for event in audit {
                events.push((
                    event.id.clone(),
                    serde_json::to_string(&event).map_err(|_| IntakeError("audit_json"))?,
                ));
            }
        }
        let receipt_event=AuditEvent{id:event_id(&[&job.receipt_id,&c.revision,"email_received"]),message_id:core.id.clone(),revision:c.revision.clone(),kind:"email_received".into(),subject_id:None,recorded_at:parse_command_types::UtcTimestamp::new(&job.received_at).map_err(|_|IntakeError("receipt_time"))?,issued_at:core.issued_at.clone(),review_only:None,security:core.security.clone(),payload:json!({"receipt_id":job.receipt_id,"email":email.metadata,"duplicate_body":duplicate,"subject_conflict":conflict,"raw_email_custody":"local_journal","server_received_at":job.server_received_at}).as_object().cloned().ok_or(IntakeError("audit_json"))?};
        events.push((
            receipt_event.id.clone(),
            serde_json::to_string(&receipt_event).map_err(|_| IntakeError("audit_json"))?,
        ));
        let extra = core_json
            .len()
            .saturating_add(metadata.len())
            .saturating_add(email.subject.as_ref().map_or(0, String::len))
            .saturating_add(
                events
                    .iter()
                    .fold(0usize, |total, (_, v)| total.saturating_add(v.len())),
            );
        Self::capacity(&tx, c, extra as u64, 0)?;
        if !duplicate || select || conflict {
            tx.execute("INSERT INTO projections(message_id,revision,core,selected_sequence,subject_conflict) VALUES(?,?,?,?,?) ON CONFLICT(message_id,revision) DO UPDATE SET core=excluded.core,selected_sequence=excluded.selected_sequence,subject_conflict=excluded.subject_conflict,delivery_state='pending'",params![core.id,c.revision,core_json,selected_sequence,conflict])?;
        }
        for (id, document) in events {
            tx.execute("INSERT INTO audit_outbox(id,message_id,revision,receipt_id,document) VALUES(?,?,?,?,?)",params![id,core.id,c.revision,job.receipt_id,document])?;
        }
        let state = if duplicate { "duplicate" } else { "parsed" };
        tx.execute("UPDATE receipts SET state=?,code=NULL,body_id=?,revision=?,subject=?,metadata=? WHERE id=?",params![state,core.id,c.revision,email.subject,metadata,job.receipt_id])?;
        tx.execute(
            "INSERT INTO custody_events(receipt_id,state,code,at) VALUES(?,?,NULL,?)",
            params![job.receipt_id, state, crate::now()?],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn status(&self) -> Result<Value> {
        let mut statement = self
            .db
            .prepare("SELECT state,count(*) FROM receipts GROUP BY state ORDER BY state")?;
        let rows =
            statement.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        let mut counts = serde_json::Map::new();
        for row in rows {
            let (k, v) = row?;
            counts.insert(k, json!(v));
        }
        let projections: i64 = self
            .db
            .query_row("SELECT count(*) FROM projections", [], |r| r.get(0))?;
        let audits: i64 = self.db.query_row(
            "SELECT count(*) FROM audit_outbox WHERE delivery_state='pending'",
            [],
            |r| r.get(0),
        )?;
        let mut statement = self
            .db
            .prepare("SELECT validity,uid FROM cursors ORDER BY account_id,mailbox,validity")?;
        let cursors = statement
            .query_map([], |r| {
                Ok(json!({"uidvalidity":r.get::<_,u32>(0)?,"last_scanned_uid":r.get::<_,u32>(1)?}))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(
            json!({"receipts":counts,"projections":projections,"audit_pending":audits,"cursors":cursors,"delivery":"local_only"}),
        )
    }
    pub fn export(&self, mut out: impl std::io::Write) -> Result<()> {
        let mut stmt = self
            .db
            .prepare("SELECT core FROM projections ORDER BY message_id,revision")?;
        for row in stmt.query_map([], |r| r.get::<_, String>(0))? {
            writeln!(out, "{}", row?)?;
        }
        Ok(())
    }
    pub fn receipts(&self, mut out: impl std::io::Write) -> Result<()> {
        let mut stmt=self.db.prepare("SELECT sequence,id,validity,uid,received_at,state,code,body_id,revision,subject,attempts,raw_hash,length(raw),server_received_at FROM receipts ORDER BY sequence")?;
        for row in stmt.query_map([],|r|Ok(json!({"sequence":r.get::<_,i64>(0)?,"receipt_id":r.get::<_,String>(1)?,"uidvalidity":r.get::<_,u32>(2)?,"uid":r.get::<_,u32>(3)?,"received_at":r.get::<_,String>(4)?,"state":r.get::<_,String>(5)?,"code":r.get::<_,Option<String>>(6)?,"body_id":r.get::<_,Option<String>>(7)?,"revision":r.get::<_,Option<String>>(8)?,"subject":r.get::<_,Option<String>>(9)?,"attempts":r.get::<_,u32>(10)?,"raw_sha256":r.get::<_,Option<String>>(11)?,"raw_bytes":r.get::<_,Option<i64>>(12)?,"server_received_at":r.get::<_,Option<String>>(13)?})))? {writeln!(out,"{}",row?)?;}
        Ok(())
    }
}
use parse_command_types::Validate;

fn prepare_directory(path: &std::path::Path) -> Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or(IntakeError("journal_directory"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(parent)?;
        let info = std::fs::symlink_metadata(parent)?;
        if !info.is_dir() || info.permissions().mode() & 0o077 != 0 {
            return Err(IntakeError("journal_directory_permissions"));
        }
        match std::fs::symlink_metadata(path) {
            Ok(info) => {
                if !info.is_file() || info.permissions().mode() & 0o077 != 0 {
                    return Err(IntakeError("journal_file_permissions"));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(path)?;
            }
            Err(error) => return Err(error.into()),
        }
    }
    #[cfg(not(unix))]
    std::fs::create_dir_all(parent)?;
    Ok(())
}
