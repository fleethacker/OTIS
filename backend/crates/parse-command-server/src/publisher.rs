use crate::{Error, Result, config::Config, private::now, search::*};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
const CHUNKER: &str = "narrative-wordpiece-240-overlap24-v1";
#[derive(Clone)]
pub struct Status {
    pub ready: Arc<AtomicBool>,
    pub model: Arc<AtomicBool>,
}
pub struct Publisher {
    db: Connection,
    client: reqwest::blocking::Client,
    config: Config,
    tokenizer: tokenizers::Tokenizer,
    status: Status,
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
impl Publisher {
    pub fn open(config: Config, status: Status) -> Result<Self> {
        let mut file = std::fs::File::open(&config.tokenizer)?;
        let mut bytes = Vec::new();
        file.by_ref().take(4_194_305).read_to_end(&mut bytes)?;
        if bytes.len() > 4_194_304 || hash(&bytes) != config.tokenizer_hash {
            return Err(Error::config("Approved tokenizer checksum mismatch"));
        }
        let mut tokenizer = tokenizers::Tokenizer::from_bytes(&bytes)
            .map_err(|_| Error::config("Tokenizer artifact is invalid"))?;
        tokenizer
            .with_truncation(None)
            .map_err(|_| Error::config("Tokenizer limits"))?;
        tokenizer.with_padding(None);
        let db = Connection::open(&config.intake.journal)?;
        db.busy_timeout(Duration::from_secs(2))?;
        db.execute_batch("PRAGMA foreign_keys=ON;PRAGMA synchronous=FULL;PRAGMA cache_size=-512;
            CREATE TABLE IF NOT EXISTS publication_jobs(kind TEXT NOT NULL,id TEXT NOT NULL,target TEXT NOT NULL,source TEXT NOT NULL,checksum TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,last_error TEXT,published_at TEXT,PRIMARY KEY(kind,id));
            CREATE INDEX IF NOT EXISTS publication_due ON publication_jobs(state,next_attempt);
            CREATE TABLE IF NOT EXISTS publication_indices(name TEXT PRIMARY KEY,uuid TEXT NOT NULL);")?;
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(1)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| Error::unavailable())?;
        Ok(Self {
            db,
            client,
            config,
            tokenizer,
            status,
        })
    }
    fn request(&self, method: reqwest::Method, path: &str, body: Value) -> Result<Value> {
        let response = self
            .client
            .request(method, format!("{}{path}", self.config.search))
            .json(&body)
            .send()
            .map_err(|_| Error::unavailable())?;
        if response.status().as_u16() == 404 {
            return Err(Error::new("not_found", "Index or model is not provisioned"));
        }
        if !response.status().is_success() {
            return Err(Error::unavailable());
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_RESPONSE as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_RESPONSE {
            return Err(Error::new(
                "resource_exhausted",
                "Publication response bound",
            ));
        }
        serde_json::from_slice(&bytes).map_err(|_| Error::unavailable())
    }
    fn bootstrap(&mut self) -> Result<()> {
        let health = self.request(reqwest::Method::GET, "/_cluster/health", json!({}))?;
        if !matches!(health["status"].as_str(), Some("green" | "yellow")) {
            return Err(Error::unavailable());
        }
        let definitions = [
            (
                MESSAGES,
                include_str!("../../../../docs/opensearch/messages.ui-index.json"),
            ),
            (
                AUDIT,
                include_str!("../../../../docs/opensearch/audit.ui-index.json"),
            ),
            (
                PASSAGES,
                include_str!("../../../../docs/opensearch/passages.ui-index.json"),
            ),
        ];
        for (name, body) in definitions {
            let current = self.request(reqwest::Method::GET, &format!("/{name}"), json!({}));
            let document = match current {
                Ok(value) => value,
                Err(error) if error.code == "not_found" => {
                    let mut definition: Value = serde_json::from_str(body)
                        .map_err(|_| Error::config("Index definition"))?;
                    definition["aliases"] = json!({});
                    definition["settings"] = json!({"number_of_shards":1,"number_of_replicas":0});
                    if name == PASSAGES {
                        definition["settings"]["index.knn"] = json!(true);
                        definition["mappings"]["properties"]["embedding"] = json!({"type":"knn_vector","dimension":384,"method":{"name":"hnsw","engine":"lucene","space_type":"cosinesimil","parameters":{"m":16,"ef_construction":100}}});
                    }
                    self.request(reqwest::Method::PUT, &format!("/{name}"), definition)?;
                    self.request(reqwest::Method::GET, &format!("/{name}"), json!({}))?
                }
                Err(error) => return Err(error),
            };
            let uuid = document[name]["settings"]["index"]["uuid"]
                .as_str()
                .ok_or_else(Error::unavailable)?;
            let old: Option<String> = self
                .db
                .query_row(
                    "SELECT uuid FROM publication_indices WHERE name=?",
                    [name],
                    |r| r.get(0),
                )
                .optional()?;
            if old.as_deref() != Some(uuid) {
                let tx = self.db.transaction()?;
                tx.execute("UPDATE publication_jobs SET state='pending',next_attempt=0,published_at=NULL WHERE target=?",[name])?;
                if name == MESSAGES {
                    tx.execute("UPDATE projections SET delivery_state='pending'", [])?;
                }
                if name == AUDIT {
                    tx.execute("UPDATE audit_outbox SET delivery_state='pending'", [])?;
                }
                tx.execute("INSERT INTO publication_indices VALUES(?,?) ON CONFLICT(name) DO UPDATE SET uuid=excluded.uuid",params![name,uuid])?;
                tx.commit()?;
            }
        }
        self.request(reqwest::Method::POST,"/_aliases",json!({"actions":[{"add":{"index":MESSAGES,"alias":MESSAGE_ALIAS}},{"add":{"index":PASSAGES,"alias":"parse-command-search-passages"}}]}))?;
        let model=self.request(reqwest::Method::POST,"/_plugins/_ml/models/_search",json!({"size":10,"query":{"bool":{"filter":[{"term":{"model_content_hash_value":MODEL_HASH}},{"exists":{"field":"model_config"}}]}}})).unwrap_or_else(|_|json!({"hits":{"hits":[]}}));
        let hits = model["hits"]["hits"]
            .as_array()
            .ok_or_else(Error::unavailable)?;
        let matching = hits
            .iter()
            .filter(|h| h["_source"]["model_content_hash_value"] == MODEL_HASH)
            .collect::<Vec<_>>();
        let model_id = if matching.len() == 1 {
            matching[0]["_id"].as_str()
        } else {
            None
        };
        if let Some(id) = model_id {
            if matching[0]["_source"]["model_state"] != "DEPLOYED" {
                let _ = self.request(
                    reqwest::Method::POST,
                    &format!("/_plugins/_ml/models/{id}/_deploy"),
                    json!({}),
                );
            }
            let failure = json!([{"remove":{"field":"embedding","ignore_missing":true}},{"set":{"field":"embedding_status","value":"failed"}}]);
            self.request(reqwest::Method::PUT,&format!("/_ingest/pipeline/{INGEST}"),json!({"description":"Local CPU inference; failed text remains searchable","processors":[{"fail":{"if":"ctx.text == null || ctx.text.trim().length() == 0","message":"passage_text_required"}},{"remove":{"field":"embedding","ignore_missing":true}},{"set":{"field":"embedding_status","value":"pending"}},{"text_embedding":{"model_id":id,"field_map":{"text":"embedding"},"batch_size":1,"skip_existing":true,"on_failure":failure}},{"script":{"if":"ctx.embedding_status != 'failed'","source":"if (ctx.embedding == null || ctx.embedding.size() != 384) { throw new IllegalArgumentException('embedding_dimension'); } ctx.embedding_status = 'ready';","on_failure":failure}}]}))?;
        }
        for (id, body) in templates(model_id) {
            self.request(
                reqwest::Method::PUT,
                &format!("/_scripts/{id}"),
                json!({"script":{"lang":"mustache","source":body}}),
            )?;
        }
        self.request(reqwest::Method::PUT,"/_search/pipeline/parse-command-hybrid-rrf-v1",json!({"phase_results_processors":[{"score-ranker-processor":{"combination":{"technique":"rrf","rank_constant":60}}}]}))?;
        self.status.model.store(
            model_id.is_some_and(|_| matching[0]["_source"]["model_state"] == "DEPLOYED"),
            Ordering::Relaxed,
        );
        Ok(())
    }
    fn expand(&mut self) -> Result<()> {
        let projection:Option<(String,String,String)>=self.db.query_row("SELECT message_id,revision,core FROM projections WHERE delivery_state='pending' ORDER BY message_id,revision LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        if let Some((id, revision, source)) = projection {
            let core: Value = serde_json::from_str(&source)
                .map_err(|_| Error::config("Corrupt canonical projection"))?;
            let mut query=self.db.prepare("SELECT document FROM audit_outbox WHERE message_id=? AND revision=? ORDER BY id LIMIT 8193")?;
            let rows = query.query_map(params![id, revision], |r| r.get::<_, String>(0))?;
            let mut raw = None;
            let mut records = std::collections::BTreeMap::new();
            let mut count = 0;
            for row in rows {
                count += 1;
                if count > 8192 {
                    return Err(Error::config("Audit selection bound"));
                }
                let doc: Value =
                    serde_json::from_str(&row?).map_err(|_| Error::config("Audit JSON"))?;
                if doc["kind"] == "source_preserved" {
                    raw = doc["payload"]["source"]["raw_text"]
                        .as_str()
                        .map(str::to_owned);
                }
                if matches!(
                    doc["kind"].as_str(),
                    Some("record_interpreted" | "fact_interpreted")
                ) && matches!(
                    doc["payload"]["set_id"].as_str(),
                    Some("GENTEXT" | "NARR" | "AMPN")
                ) {
                    records.insert(
                        doc["payload"]["record_sequence"]
                            .as_u64()
                            .ok_or_else(Error::unavailable)?,
                        doc["payload"].clone(),
                    );
                }
            }
            drop(query);
            let raw = raw.ok_or_else(|| Error::config("Preserved source is missing"))?;
            if raw.len() > 524288 || format!("sha256:{}", hash(raw.as_bytes())) != id {
                return Err(Error::config("Preserved source identity mismatch"));
            }
            let mut derived = Vec::new();
            let mut ordinal = 0usize;
            for record in records.values() {
                let left = record["span"]["start_byte"]
                    .as_u64()
                    .ok_or_else(Error::unavailable)? as usize;
                let right = record["span"]["end_byte"]
                    .as_u64()
                    .ok_or_else(Error::unavailable)? as usize;
                let text = raw
                    .get(left..right)
                    .ok_or_else(|| Error::config("Source byte span"))?;
                for (start, end, text) in chunks(text, &self.tokenizer)? {
                    ordinal += 1;
                    if ordinal > 2048 {
                        return Err(Error::config("Passage bound"));
                    }
                    let pid = format!(
                        "sha256:{}",
                        hash(
                            format!(
                                "{id}\0{revision}\0{CHUNKER}\0{}\0{}",
                                left + start,
                                left + end
                            )
                            .as_bytes()
                        )
                    );
                    let mut passage = json!({"id":pid,"message_id":id,"revision":revision,"ordinal":ordinal,"text":text,"embedding_status":"pending","mentioned_units":[]});
                    for key in [
                        "type",
                        "originator",
                        "issued_at",
                        "expires_at",
                        "security",
                        "command_ids",
                        "subject",
                    ] {
                        passage[key] = core[key].clone();
                    }
                    let aid = hash(format!("passage_prepared\0{pid}").as_bytes());
                    let mut audit = json!({"id":aid,"message_id":id,"revision":revision,"kind":"passage_prepared","recorded_at":now(),"security":core["security"],"payload":{"passage_id":pid,"chunker":CHUNKER,"set_id":record["set_id"],"model_sha256":MODEL_HASH,"span":{"start_byte":left+start,"end_byte":left+end,"representation":"decoded_utf8_body"}}});
                    if !core["issued_at"].is_null() {
                        audit["issued_at"] = core["issued_at"].clone();
                    }
                    derived.push((passage, audit));
                }
            }
            let tx = self.db.transaction()?;
            let same:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM projections WHERE message_id=? AND revision=? AND core=? AND delivery_state='pending')",params![id,revision,source],|r|r.get(0))?;
            if same {
                enqueue(&tx, "message", &format!("{id}:{revision}"), MESSAGES, &core)?;
                for (passage, audit) in derived {
                    let pid = passage["id"].as_str().ok_or_else(Error::unavailable)?;
                    enqueue(&tx, "passage", pid, PASSAGES, &passage)?;
                    enqueue(&tx, "enrich", pid, PASSAGES, &passage)?;
                    enqueue(
                        &tx,
                        "audit",
                        audit["id"].as_str().ok_or_else(Error::unavailable)?,
                        AUDIT,
                        &audit,
                    )?;
                }
                tx.execute("UPDATE projections SET delivery_state='queued' WHERE message_id=? AND revision=?",params![id,revision])?;
            }
            tx.commit()?;
        }
        let pending = {
            let mut q=self.db.prepare("SELECT id,document FROM audit_outbox WHERE delivery_state='pending' ORDER BY id LIMIT 64")?;
            q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        let tx = self.db.transaction()?;
        for (id, document) in pending {
            let doc = serde_json::from_str(&document).map_err(|_| Error::config("Audit JSON"))?;
            enqueue(&tx, "audit", &id, AUDIT, &doc)?;
            tx.execute(
                "UPDATE audit_outbox SET delivery_state='queued' WHERE id=? AND document=?",
                params![id, document],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    fn deliver(&mut self) -> Result<usize> {
        let rows = {
            let mut q=self.db.prepare("SELECT kind,id,target,source,checksum,attempts FROM publication_jobs WHERE state='pending' AND next_attempt<=unixepoch() AND (kind!='enrich' OR EXISTS(SELECT 1 FROM publication_jobs p WHERE p.kind='passage' AND p.id=publication_jobs.id AND p.state='published')) ORDER BY CASE kind WHEN 'message' THEN 0 WHEN 'passage' THEN 1 WHEN 'audit' THEN 2 ELSE 3 END,id LIMIT 16")?;
            q.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
        };
        if rows.is_empty() {
            return Ok(0);
        }
        let mut payload = String::new();
        let mut selected = Vec::new();
        for row in rows {
            let (kind, id, target, source, _, _) = &row;
            let action = if kind == "audit" { "create" } else { "index" };
            let pipeline = if kind == "enrich" { INGEST } else { "_none" };
            let line = format!(
                "{}\n{source}\n",
                json!({action:{"_index":target,"_id":id,"pipeline":pipeline}})
            );
            if payload.len() + line.len() > 2_097_152 {
                if selected.is_empty() {
                    return Err(Error::config("Publication document exceeds bound"));
                }
                break;
            }
            payload.push_str(&line);
            selected.push(row);
        }
        let response = self
            .client
            .post(format!("{}/_bulk?refresh=wait_for", self.config.search))
            .header("Content-Type", "application/x-ndjson")
            .body(payload)
            .send()
            .map_err(|_| Error::unavailable())?;
        if !response.status().is_success() {
            return Err(Error::unavailable());
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_RESPONSE as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_RESPONSE {
            return Err(Error::unavailable());
        }
        let result: Value = serde_json::from_slice(&bytes).map_err(|_| Error::unavailable())?;
        let items = result["items"]
            .as_array()
            .filter(|v| v.len() == selected.len())
            .ok_or_else(Error::unavailable)?;
        for ((kind, id, target, source, checksum, attempts), item) in selected.iter().zip(items) {
            let action = if kind == "audit" { "create" } else { "index" };
            let status = item[action]["status"].as_u64().unwrap_or(0);
            let mut success = matches!(status, 200 | 201);
            if kind == "audit" && status == 409 {
                let old = self.request(
                    reqwest::Method::GET,
                    &format!("/{target}/_doc/{id}"),
                    json!({}),
                )?;
                let mut previous = old["_source"].clone();
                let mut incoming: Value =
                    serde_json::from_str(source).map_err(|_| Error::unavailable())?;
                if incoming["kind"] == "passage_prepared" {
                    previous
                        .as_object_mut()
                        .ok_or_else(Error::unavailable)?
                        .remove("recorded_at");
                    incoming
                        .as_object_mut()
                        .ok_or_else(Error::unavailable)?
                        .remove("recorded_at");
                }
                success = previous == incoming;
            }
            if success && kind == "enrich" {
                let record = self.request(
                    reqwest::Method::GET,
                    &format!("/{target}/_doc/{id}?_source_includes=embedding_status"),
                    json!({}),
                )?;
                success = record["_source"]["embedding_status"] == "ready";
                self.status.model.store(success, Ordering::Relaxed);
            }
            if success {
                let tx = self.db.transaction()?;
                let updated=tx.execute("UPDATE publication_jobs SET state='published',published_at=?,last_error=NULL WHERE kind=? AND id=? AND checksum=?",params![now(),kind,id,checksum])?;
                if updated > 0 && kind == "message" {
                    let doc: Value =
                        serde_json::from_str(source).map_err(|_| Error::unavailable())?;
                    let current: Option<String> = tx
                        .query_row(
                            "SELECT core FROM projections WHERE message_id=? AND revision=?",
                            params![doc["id"].as_str(), doc["revision"].as_str()],
                            |r| r.get(0),
                        )
                        .optional()?;
                    if current
                        .as_deref()
                        .and_then(|s| serde_json::from_str::<Value>(s).ok())
                        .as_ref()
                        == Some(&doc)
                    {
                        tx.execute("UPDATE projections SET delivery_state='published' WHERE message_id=? AND revision=?",params![doc["id"].as_str(),doc["revision"].as_str()])?;
                    }
                }
                if updated > 0 && kind == "audit" {
                    tx.execute(
                        "UPDATE audit_outbox SET delivery_state='published' WHERE id=?",
                        [id],
                    )?;
                }
                tx.commit()?;
            } else {
                let delay = (1i64 << (*attempts).min(6)).min(60);
                self.db.execute("UPDATE publication_jobs SET attempts=attempts+1,next_attempt=unixepoch()+?,last_error='publication_item_failed' WHERE kind=? AND id=? AND checksum=?",params![delay,kind,id,checksum])?;
            }
        }
        Ok(selected.len())
    }
    pub fn run(mut self, cancelled: Arc<AtomicBool>) {
        let mut cycles = 0u64;
        while !cancelled.load(Ordering::Relaxed) {
            let result = (|| {
                if cycles.is_multiple_of(30) {
                    self.bootstrap()?;
                }
                self.expand()?;
                self.deliver()
            })();
            match result {
                Ok(_) => self.status.ready.store(true, Ordering::Relaxed),
                Err(_) => {
                    self.status.ready.store(false, Ordering::Relaxed);
                    eprintln!("publication_error: retry_pending");
                    cycles = u64::MAX;
                }
            }
            cycles = cycles.wrapping_add(1);
            for _ in 0..5 {
                if cancelled.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }
}
fn enqueue(
    tx: &rusqlite::Transaction<'_>,
    kind: &str,
    id: &str,
    target: &str,
    doc: &Value,
) -> Result<()> {
    let source = doc.to_string();
    let digest = hash(source.as_bytes());
    if kind == "audit" {
        let old: Option<String> = tx
            .query_row(
                "SELECT source FROM publication_jobs WHERE kind=? AND id=?",
                params![kind, id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(old) = old {
            let mut existing: Value =
                serde_json::from_str(&old).map_err(|_| Error::unavailable())?;
            let mut candidate = doc.clone();
            if candidate["kind"] == "passage_prepared" {
                existing
                    .as_object_mut()
                    .ok_or_else(Error::unavailable)?
                    .remove("recorded_at");
                candidate
                    .as_object_mut()
                    .ok_or_else(Error::unavailable)?
                    .remove("recorded_at");
            }
            if existing != candidate {
                return Err(Error::config("Immutable audit conflict"));
            }
            return Ok(());
        }
    }
    tx.execute("INSERT INTO publication_jobs(kind,id,target,source,checksum) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET source=excluded.source,checksum=excluded.checksum,state='pending',attempts=0,next_attempt=0,published_at=NULL WHERE publication_jobs.checksum!=excluded.checksum",params![kind,id,target,source,digest])?;
    Ok(())
}
pub fn chunks(
    text: &str,
    tokenizer: &tokenizers::Tokenizer,
) -> Result<Vec<(usize, usize, String)>> {
    let encoding = tokenizer
        .encode(text, false)
        .map_err(|_| Error::config("Passage tokenization failed"))?;
    let offsets = encoding.get_offsets();
    let mut output = Vec::new();
    let mut cursor = 0;
    while cursor < offsets.len() {
        let mut last = (cursor + 240).min(offsets.len());
        let start = offsets[cursor].0;
        let mut end = offsets[last - 1].1;
        while last > cursor + 1
            && (end - start > 8192
                || tokenizer
                    .encode(&text[start..end], true)
                    .map_err(|_| Error::unavailable())?
                    .len()
                    > 256)
        {
            last -= 1;
            end = offsets[last - 1].1;
        }
        if end - start > 8192 {
            let mut pos = start;
            while pos < end {
                let mut stop = (pos + 1024).min(end);
                while !text.is_char_boundary(stop) {
                    stop -= 1;
                }
                while tokenizer
                    .encode(&text[pos..stop], true)
                    .map_err(|_| Error::unavailable())?
                    .len()
                    > 256
                {
                    stop = pos + (stop - pos) / 2;
                    while !text.is_char_boundary(stop) {
                        stop -= 1;
                    }
                    if stop <= pos {
                        return Err(Error::config("Passage splitting failed"));
                    }
                }
                output.push((pos, stop, text[pos..stop].into()));
                pos = stop;
            }
        } else {
            if tokenizer
                .encode(&text[start..end], true)
                .map_err(|_| Error::unavailable())?
                .len()
                > 256
            {
                return Err(Error::config("Passage token limit"));
            }
            output.push((start, end, text[start..end].into()));
        }
        if output.len() > 2048 {
            return Err(Error::config("Passage limit"));
        }
        if last == offsets.len() {
            break;
        }
        cursor = (cursor + 1).max(last.saturating_sub(24));
    }
    Ok(output)
}
fn templates(model: Option<&str>) -> Vec<(String, String)> {
    let filters = json!({"bool":{"filter":"__FILTERS__"}});
    let lexical =
        json!({"multi_match":{"query":"__QUERY__","fields":["text","subject"],"operator":"or"}});
    let neural = json!({"neural":{"embedding":{"query_text":"__QUERY__","model_id":model.unwrap_or(""),"k":100,"filter":{"bool":{"filter":[filters,{"term":{"embedding_status":"ready"}}]}}}}});
    let mut templates = Vec::new();
    for (mode, query) in [
        (
            "keyword",
            json!({"bool":{"must":[lexical],"filter":"__FILTERS__"}}),
        ),
        ("semantic", neural.clone()),
        (
            "hybrid",
            json!({"hybrid":{"queries":[{"bool":{"must":[lexical],"filter":"__FILTERS__"}},neural]}}),
        ),
    ] {
        if mode != "keyword" && model.is_none() {
            continue;
        }
        templates.push((format!("parse-command-passages-{mode}-v2"),json!({"size":100,"timeout":"5s","track_total_hits":false,"_source":["id","message_id","revision","text","embedding_status"],"query":query}).to_string()));
    }
    templates.push(("parse-command-message-detail-v1".into(),json!({"size":2,"timeout":"5s","query":{"bool":{"filter":[{"term":{"id":"__ID__"}},{"term":{"revision":"__REV__"}}]}}}).to_string()));
    templates.push(("parse-command-messages-list-v1".into(),json!({"size":21,"_source":["id","revision","type","originator","subject","issued_at","command_ids","security","status","review_flags"],"timeout":"5s","track_total_hits":false,"query":filters,"sort":[{"issued_at":{"order":"desc","missing":"_last"}},"id","revision"],"search_after":"__AFTER__","pit":{"id":"__PIT__","keep_alive":"60s"}}).to_string()));
    templates.push(("parse-command-timeline-v1".into(),json!({"size":101,"timeout":"5s","track_total_hits":false,"query":{"bool":{"filter":"__FILTERS__","must":[{"nested":{"path":"activities","query":{"bool":{"should":[{"range":{"activities.start_at":{"lt":"__TO__"}}},{"bool":{"must_not":{"exists":{"field":"activities.start_at"}}}}],"minimum_should_match":1}}}}]}},"sort":["id","revision"]}).to_string()));
    templates.push(("parse-command-evidence-list-v1".into(),json!({"size":65,"timeout":"5s","query":{"bool":{"filter":"__FILTERS__"}},"sort":["id"],"search_after":"__AFTER__"}).to_string()));
    templates.push(("parse-command-source-status-v1".into(),json!({"size":0,"track_total_hits":true,"aggs":{"embedding_states":{"terms":{"field":"embedding_status","size":3}}}}).to_string()));
    templates
        .into_iter()
        .map(|(id, s)| {
            (
                id,
                s.replace(
                    "\"search_after\":\"__AFTER__\",",
                    "{{#has_after}}\"search_after\":{{#toJson}}after{{/toJson}},{{/has_after}}",
                )
                .replace("\"__FILTERS__\"", "{{#toJson}}filters{{/toJson}}")
                .replace("\"__QUERY__\"", "\"{{query}}\"")
                .replace("\"__ID__\"", "\"{{message_id}}\"")
                .replace("\"__REV__\"", "\"{{revision}}\"")
                .replace("\"__AFTER__\"", "{{#toJson}}after{{/toJson}}")
                .replace("\"__PIT__\"", "\"{{pit_id}}\"")
                .replace("\"__TO__\"", "\"{{to}}\""),
            )
        })
        .collect()
}
pub fn journal_counts(path: &Path) -> Result<Value> {
    let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut q =
        db.prepare("SELECT kind,state,count(*) FROM publication_jobs GROUP BY kind,state")?;
    let mut counts = Vec::new();
    for row in q.query_map([],|r|Ok(json!({"kind":r.get::<_,String>(0)?,"state":r.get::<_,String>(1)?,"count":r.get::<_,i64>(2)?})))?{counts.push(row?);}
    Ok(json!(counts))
}
