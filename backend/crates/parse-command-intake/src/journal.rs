use crate::{IntakeError, Result, config::Config};
use base64::{Engine, engine::general_purpose::STANDARD};
use parse_command_state::{BlockingStore, Record};
use parse_command_types::{AuditEvent, Message, Validate, event_id, message_id};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    collections::VecDeque,
};

pub struct Journal {
    pub store: BlockingStore,
    jobs: RefCell<VecDeque<String>>,
    scanned: Cell<bool>,
    count: Cell<u64>,
    bytes: Cell<u64>,
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
fn receipt_key(c: &Config, validity: u32, uid: u32) -> String {
    event_id(&[
        &c.account_id,
        &c.mailbox,
        &validity.to_string(),
        &uid.to_string(),
    ])
}
fn event(
    row: &mut Record,
    state: &str,
    code: Option<&str>,
    at: &str,
) -> parse_command_state::Result<()> {
    let events = row.payload["events"]
        .as_array_mut()
        .ok_or(parse_command_state::Error("state_record"))?;
    if events.len() >= 10000 {
        return Err(parse_command_state::Error("state_capacity"));
    }
    events.push(json!({"state":state,"code":code,"at":at}));
    if !row.flags.iter().any(|f| f == "events_pending") {
        row.flags.push("events_pending".into());
    }
    Ok(())
}
// Projection identity is body + revision. Routing changes require a new revision
// or explicit migration instead of reinterpreting already retained source content.
fn bind_source_routing(store: &BlockingStore, c: &Config) -> Result<()> {
    let wanted = json!({
        "fingerprint": c.routing_fingerprint(),
        "policyId": c.source_routing.as_ref().map(|v| &v.policy_id),
        "commandIds": c.command_ids()
    });
    if c.source_routing.is_some() && store.get("source_routing_revision", &c.revision)?.is_none() {
        store.refresh()?;
        let identities = store.list("mailbox_identity", vec![], 1000)?;
        if identities.len() == 1000
            || identities
                .iter()
                .any(|d| d.record.payload["revision"] == c.revision)
        {
            return Err(IntakeError("source_routing_revision_unbound"));
        }
        let historical = store.search(json!({
            "size": 0, "track_total_hits": true,
            "query": {"bool": {"filter": [
                {"terms": {"kind": ["projection", "receipt"]}},
                {"wildcard": {"source": format!("*@{}", c.revision)}}
            ]}}
        }))?;
        if historical["hits"]["total"]["value"]
            .as_u64()
            .ok_or(IntakeError("state_response"))?
            != 0
        {
            return Err(IntakeError("source_routing_revision_unbound"));
        }
    }
    store.update("source_routing_revision", &c.revision, |old| {
        if let Some(old) = old {
            if old.payload["fingerprint"] != wanted["fingerprint"] {
                return Err(parse_command_state::Error(
                    "source_routing_revision_conflict",
                ));
            }
            return Ok(old.clone());
        }
        Ok(Record::new(
            "source_routing_revision",
            &c.revision,
            wanted.clone(),
        ))
    })?;
    Ok(())
}
impl Journal {
    pub fn open(c: &Config) -> Result<Self> {
        let store = BlockingStore::new(&c.opensearch_url, &c.custody_index)?;
        store.provision()?;
        bind_source_routing(&store, c)?;
        let wanted = json!({"host":c.host,"port":c.port,"username":c.username,"mailbox":c.mailbox,"revision":c.revision});
        store.update("mailbox_identity", &c.account_id, |old| {
            if let Some(old) = old {
                if old.payload != wanted {
                    return Err(parse_command_state::Error("journal_identity_changed"));
                }
                return Ok(old.clone());
            }
            Ok(Record::new(
                "mailbox_identity",
                &c.account_id,
                wanted.clone(),
            ))
        })?;
        let this = Self {
            store,
            jobs: RefCell::new(VecDeque::new()),
            scanned: Cell::new(false),
            count: Cell::new(0),
            bytes: Cell::new(0),
        };
        this.begin_cycle()?;
        Ok(this)
    }
    pub fn begin_cycle(&self) -> Result<()> {
        self.store.refresh()?;
        let stats=self.store.search(json!({"size":0,"track_total_hits":true,"aggs":{"bytes":{"sum":{"field":"bytes"}},"receipts":{"filter":{"term":{"kind":"receipt"}}}}}))?;
        self.count.set(
            stats["aggregations"]["receipts"]["doc_count"]
                .as_u64()
                .ok_or(IntakeError("custody_capacity"))?,
        );
        self.bytes.set(
            stats["aggregations"]["bytes"]["value"]
                .as_f64()
                .ok_or(IntakeError("custody_capacity"))? as u64,
        );
        self.jobs.borrow_mut().clear();
        self.scanned.set(false);
        Ok(())
    }
    fn capacity(&self, c: &Config, extra: u64, receipts: u64) -> Result<()> {
        if self.count.get().saturating_add(receipts) > c.max_receipts
            || self.bytes.get().saturating_add(extra) > c.max_retained_bytes
        {
            return Err(IntakeError("custody_capacity"));
        }
        Ok(())
    }
    pub fn check_capacity(&self, c: &Config) -> Result<()> {
        self.capacity(c, (c.max_raw_bytes as u64).saturating_mul(2), 1)
    }
    pub fn cursor(&self, c: &Config, validity: u32) -> Result<u32> {
        Ok(self
            .store
            .get(
                "mailbox_cursor",
                &format!("{}:{}:{validity}", c.account_id, c.mailbox),
            )?
            .map(|d| d.record.order as u32)
            .unwrap_or(0))
    }
    pub fn advance_empty_range(&mut self, c: &Config, validity: u32, uid: u32) -> Result<()> {
        let key = format!("{}:{}:{validity}", c.account_id, c.mailbox);
        self.store.update("mailbox_cursor", &key, |old| {
            let mut row = old.cloned().unwrap_or_else(|| {
                Record::new(
                    "mailbox_cursor",
                    &key,
                    json!({"validity":validity,"mailbox":c.mailbox}),
                )
            });
            row.owner = c.account_id.clone();
            row.order = row.order.max(i64::from(uid));
            Ok(row)
        })?;
        Ok(())
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
                .is_some_and(|b| b.len() != r.size as usize || b.len() > c.max_raw_bytes)
        {
            return Err(IntakeError("receipt_invariant"));
        }
        parse_command_types::UtcTimestamp::new(r.received_at)
            .map_err(|_| IntakeError("receipt_time"))?;
        if let Some(at) = r.server_received_at {
            parse_command_types::UtcTimestamp::new(at).map_err(|_| IntakeError("receipt_time"))?;
        }
        let key = receipt_key(c, r.validity, r.uid);
        let hash = r
            .raw
            .map(|b| format!("sha256:{:x}", <sha2::Sha256 as sha2::Digest>::digest(b)));
        let existing = self.store.get("receipt", &key)?;
        let fresh = existing.is_none();
        if let Some(old) = existing {
            if old.record.payload["size"] != r.size || old.record.payload["raw_hash"] != json!(hash)
            {
                return Err(IntakeError("receipt_identity_collision"));
            }
        } else {
            let mut row = Record::new(
                "receipt",
                &key,
                json!({"validity":r.validity,"uid":r.uid,"size":r.size,"raw":r.raw.map(|b|STANDARD.encode(b)),"raw_hash":hash,"received_at":r.received_at,"server_received_at":r.server_received_at,"attempts":0,"code":r.code,"events":[],"audit":[],"audit_state":"pending"}),
            );
            row.owner = c.account_id.clone();
            row.state = r.state.into();
            row.order = self.store.next("receipts")?;
            row.category = r.validity.to_string();
            if r.server_received_at.is_none() {
                row.flags.push("missing_received_time".into());
            }
            event(&mut row, r.state, r.code, r.received_at)?;
            row.bytes = row.payload.to_string().len() as u64;
            self.capacity(c, row.bytes, 1)?;
            self.store.put(&row, None)?;
            self.count.set(self.count.get() + 1);
            self.bytes.set(self.bytes.get() + row.bytes);
        }
        // The receipt must be durably acknowledged before the cursor can advance.
        // A lost response leaves the cursor behind; replay verifies the receipt hash.
        self.advance_empty_range(c, r.validity, r.uid)?;
        Ok(fresh)
    }
    pub fn missing_received_times(&self, c: &Config, validity: u32) -> Result<Vec<u32>> {
        let rows = self.store.list(
            "receipt",
            vec![
                json!({"term":{"owner":c.account_id}}),
                json!({"term":{"category":validity.to_string()}}),
                json!({"term":{"flags":"missing_received_time"}}),
            ],
            c.uid_window.min(1000) as usize,
        )?;
        Ok(rows
            .into_iter()
            .filter(|d| {
                d.record.payload["validity"] == validity
                    && d.record.payload["server_received_at"].is_null()
            })
            .filter_map(|d| d.record.payload["uid"].as_u64().map(|n| n as u32))
            .collect())
    }
    pub fn backfill_received_time(
        &self,
        c: &Config,
        validity: u32,
        uid: u32,
        time: &str,
    ) -> Result<()> {
        parse_command_types::UtcTimestamp::new(time).map_err(|_| IntakeError("receipt_time"))?;
        self.store
            .update("receipt", &receipt_key(c, validity, uid), |old| {
                let mut row = old
                    .cloned()
                    .ok_or(parse_command_state::Error("state_record"))?;
                if row.payload["server_received_at"].is_null() {
                    row.payload["server_received_at"] = json!(time);
                }
                row.flags.retain(|f| f != "missing_received_time");
                Ok(row)
            })?;
        Ok(())
    }
    pub fn next_job(&self, c: &Config) -> Result<Option<Job>> {
        if !self.scanned.replace(true) {
            self.store.refresh()?;
            let rows = self.store.list(
                "receipt",
                vec![
                    json!({"term":{"owner":c.account_id}}),
                    json!({"term":{"state":"staged"}}),
                ],
                c.jobs_per_cycle.min(1000),
            )?;
            self.jobs
                .borrow_mut()
                .extend(rows.into_iter().map(|d| d.record.key));
        }
        loop {
            let Some(key) = self.jobs.borrow_mut().pop_front() else {
                return Ok(None);
            };
            let Some(doc) = self.store.get("receipt", &key)? else {
                return Err(IntakeError("receipt_missing"));
            };
            if doc.record.state != "staged" {
                continue;
            }
            let p = &doc.record.payload;
            let raw = STANDARD
                .decode(p["raw"].as_str().ok_or(IntakeError("receipt_raw"))?)
                .map_err(|_| IntakeError("receipt_raw"))?;
            if raw.len() > c.max_raw_bytes {
                return Err(IntakeError("receipt_size"));
            }
            return Ok(Some(Job {
                receipt_id: key,
                raw,
                received_at: p["received_at"]
                    .as_str()
                    .ok_or(IntakeError("receipt_time"))?
                    .into(),
                server_received_at: p["server_received_at"].as_str().map(str::to_owned),
                attempts: p["attempts"]
                    .as_u64()
                    .ok_or(IntakeError("receipt_attempts"))? as u32,
                sequence: doc.record.order,
            }));
        }
    }
    pub fn attempt(&self, id: &str) -> Result<()> {
        self.attempt_delta(id, 1)
    }
    pub fn release_attempt(&self, id: &str) -> Result<()> {
        self.attempt_delta(id, -1)
    }
    fn attempt_delta(&self, id: &str, delta: i64) -> Result<()> {
        self.store.update("receipt", id, |old| {
            let mut row = old
                .cloned()
                .ok_or(parse_command_state::Error("state_record"))?;
            if row.state == "staged" {
                row.payload["attempts"] =
                    json!((row.payload["attempts"].as_i64().unwrap_or(0) + delta).max(0));
            }
            Ok(row)
        })?;
        Ok(())
    }
    pub fn identify_body(&self, id: &str, body: &str, revision: &str) -> Result<()> {
        self.store.update("receipt", id, |old| {
            let mut row = old
                .cloned()
                .ok_or(parse_command_state::Error("state_record"))?;
            row.source = format!("{}@{revision}", message_id(body));
            Ok(row)
        })?;
        Ok(())
    }
    pub fn record_retry(&self, id: &str, code: &str) -> Result<()> {
        let at = crate::now()?;
        self.store.update("receipt", id, |old| {
            let mut row = old
                .cloned()
                .ok_or(parse_command_state::Error("state_record"))?;
            event(&mut row, "retrying", Some(code), &at)?;
            Ok(row)
        })?;
        Ok(())
    }
    pub fn quarantine(&mut self, id: &str, state: &str, code: &str) -> Result<()> {
        let at = crate::now()?;
        self.store.update("receipt", id, |old| {
            let mut row = old
                .cloned()
                .ok_or(parse_command_state::Error("state_record"))?;
            if row.state == "staged" {
                row.state = state.into();
                row.payload["code"] = json!(code);
                event(&mut row, state, Some(code), &at)?;
            }
            Ok(row)
        })?;
        Ok(())
    }
    pub fn finish(
        &mut self,
        c: &Config,
        job: &Job,
        core: Message,
        audit: Vec<AuditEvent>,
        email: crate::mime::Email,
    ) -> Result<()> {
        if core.id != message_id(&email.body) {
            return Err(IntakeError("body_identity"));
        }
        if core.revision != c.revision || core.command_ids != c.command_ids() {
            return Err(IntakeError("source_routing_projection_mismatch"));
        }
        core.validate()
            .map_err(|_| IntakeError("projection_validation"))?;
        let receipt = self
            .store
            .get("receipt", &job.receipt_id)?
            .ok_or(IntakeError("receipt_missing"))?;
        if receipt.record.state != "staged" {
            return Ok(());
        }
        let key = format!("{}@{}", core.id, core.revision);
        let extra = serde_json::to_vec(&audit)
            .map_err(|_| IntakeError("audit_json"))?
            .len()
            + serde_json::to_vec(&core)
                .map_err(|_| IntakeError("projection_json"))?
                .len();
        self.capacity(c, extra as u64, 0)?;
        let projection=self.store.update("projection",&key,|old| {
            if let Some(old)=old {
                let mut row=old.clone();
                let previous_subject=row.payload["selected_subject"].as_str();
                let conflict=row.payload["subject_conflict"]==true || previous_subject!=email.subject.as_deref();
                let old_time=row.payload["selected_received_at"].as_str().map(str::to_owned);
                let select=match (job.server_received_at.as_deref(),old_time.as_deref()) {(Some(a),Some(b))=>a>b || (a==b && job.sequence>row.order),_=>false};
                let mut selected:Message=serde_json::from_value(row.payload["core"].clone()).map_err(|_|parse_command_state::Error("state_record"))?;
                if select {selected.subject=parse_command_parser_api::display_subject(email.subject.as_deref()).map(str::to_owned);row.order=job.sequence;row.payload["selected_received_at"]=json!(job.server_received_at);row.payload["selected_subject"]=json!(email.subject);}
                for (flag,active) in [("subject_conflict",conflict),("subject_order_review",job.server_received_at.is_none() || old_time.is_none())] {if active && !selected.review_flags.iter().any(|f|f==flag) {selected.review_flags.push(flag.into());}}
                let value=serde_json::to_value(selected).map_err(|_|parse_command_state::Error("state_record"))?;
                if row.payload["core"]!=value {row.state="pending".into();row.payload["core"]=value;}
                row.payload["subject_conflict"]=json!(conflict);row.bytes=row.payload.to_string().len() as u64;Ok(row)
            } else {
                let mut row=Record::new("projection",&key,json!({"core":core,"audits":audit,"first_receipt":job.receipt_id,"selected_subject":email.subject,"selected_received_at":job.server_received_at,"subject_conflict":false}));
                row.state="pending".into();row.source=key.clone();row.order=job.sequence;row.bytes=row.payload.to_string().len() as u64;Ok(row)
            }
        })?;
        let duplicate = projection.record.payload["first_receipt"] != job.receipt_id;
        let state = if duplicate { "duplicate" } else { "parsed" };
        let at = crate::now()?;
        let mut receipt_audit = json!({"id":event_id(&[&job.receipt_id,&c.revision,"email_received"]),"message_id":core.id,"revision":c.revision,"kind":"email_received","recorded_at":job.received_at,"issued_at":core.issued_at,"security":core.security,"payload":{"receipt_id":job.receipt_id,"email":email.metadata,"duplicate_body":duplicate,"subject_conflict":projection.record.payload["subject_conflict"],"raw_email_custody":"opensearch_hidden_index","server_received_at":job.server_received_at}});
        if core.issued_at.is_none() {
            receipt_audit
                .as_object_mut()
                .ok_or(IntakeError("audit_json"))?
                .remove("issued_at");
        }
        let mut receipt_audits = vec![receipt_audit];
        if let Some(routing) = &c.source_routing {
            let event = AuditEvent {
                id: event_id(&[&job.receipt_id, &c.revision, "source_routing_applied"]),
                message_id: core.id.clone(),
                revision: c.revision.clone(),
                kind: "source_routing_applied".into(),
                subject_id: None,
                recorded_at: parse_command_types::UtcTimestamp::new(&job.received_at)
                    .map_err(|_| IntakeError("receipt_time"))?,
                issued_at: core.issued_at.clone(),
                review_only: None,
                security: core.security.clone(),
                payload: json!({"receipt_id":job.receipt_id,"source_account_id":c.account_id,"mailbox":c.mailbox,"policy_id":routing.policy_id,"policy_fingerprint":c.routing_fingerprint(),"command_ids":c.command_ids(),"basis":"operator_approved_source_applicability","grants_access":false})
                    .as_object().cloned().ok_or(IntakeError("audit_json"))?,
            };
            receipt_audits
                .push(serde_json::to_value(event).map_err(|_| IntakeError("audit_json"))?);
        }
        let mut row = receipt.record.clone();
        row.state = state.into();
        row.source = key;
        row.payload["code"] = Value::Null;
        row.payload["subject"] = json!(email.subject);
        row.payload["metadata"] = json!(email.metadata);
        row.payload["audit"] = json!(receipt_audits);
        row.payload["audit_state"] = json!("pending");
        row.flags.push("audit_pending".into());
        event(&mut row, state, None, &at)?;
        row.bytes = row.payload.to_string().len() as u64;
        self.store.put(&row, Some(&receipt))?;
        self.bytes
            .set(self.bytes.get().saturating_add(extra as u64));
        Ok(())
    }
    pub fn status(&self) -> Result<Value> {
        self.store.refresh()?;
        let values=self.store.search(json!({"size":0,"aggs":{"receipts":{"filter":{"term":{"kind":"receipt"}},"aggs":{"states":{"terms":{"field":"state","size":20}}}},"projections":{"filter":{"term":{"kind":"projection"}}}}}))?;
        let mut counts = serde_json::Map::new();
        for b in values["aggregations"]["receipts"]["states"]["buckets"]
            .as_array()
            .ok_or(IntakeError("custody_status"))?
        {
            counts.insert(
                b["key"]
                    .as_str()
                    .ok_or(IntakeError("custody_status"))?
                    .into(),
                b["doc_count"].clone(),
            );
        }
        let cursors=self.store.list("mailbox_cursor",vec![],1000)?.into_iter().map(|d|json!({"uidvalidity":d.record.payload["validity"],"last_scanned_uid":d.record.order})).collect::<Vec<_>>();
        Ok(
            json!({"receipts":counts,"projections":values["aggregations"]["projections"]["doc_count"],"cursors":cursors,"delivery":"opensearch"}),
        )
    }
    fn export_kind(&self, kind: &str, mut out: impl std::io::Write) -> Result<()> {
        self.store.refresh()?;
        let mut after: Option<Value> = None;
        loop {
            let mut query =
                json!({"size":100,"query":{"term":{"kind":kind}},"sort":["order","key"]});
            if let Some(value) = after {
                query["search_after"] = value;
            }
            let response = self.store.search(query)?;
            let hits = response["hits"]["hits"]
                .as_array()
                .ok_or(IntakeError("custody_status"))?;
            for hit in hits {
                let mut value = if kind == "projection" {
                    hit["_source"]["payload"]["core"].clone()
                } else {
                    hit["_source"]["payload"].clone()
                };
                if kind == "receipt" {
                    if let Some(object) = value.as_object_mut() {
                        object.remove("raw");
                        object.remove("audit");
                        object.remove("metadata");
                    }
                }
                writeln!(out, "{value}")?;
            }
            if hits.len() < 100 {
                break;
            }
            after = hits.last().map(|h| h["sort"].clone());
        }
        Ok(())
    }
    pub fn export(&self, out: impl std::io::Write) -> Result<()> {
        self.export_kind("projection", out)
    }
    pub fn receipts(&self, out: impl std::io::Write) -> Result<()> {
        self.export_kind("receipt", out)
    }
}
