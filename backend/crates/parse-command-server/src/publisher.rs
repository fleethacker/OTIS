use crate::{Error, Result, config::Config, private::now, search::*};
use parse_command_state::{BlockingStore, Document, Record, epoch};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
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
    store: BlockingStore,
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
        let store = BlockingStore::new(&config.search, &config.intake.custody_index)?;
        store.provision()?;
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(1)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| Error::unavailable())?;
        Ok(Self {
            store,
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
            self.reset_index(name, uuid)?;
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
        // Persisted model metadata is insufficient after a node restart.
        let inference_ready = model_id.is_some() && self.request(
            reqwest::Method::POST,
            &format!("/_ingest/pipeline/{INGEST}/_simulate"),
            json!({"docs":[{"_index":PASSAGES,"_id":"readiness-probe","_source":{"text":"Coordinate the communications plan and reporting requirements."}}]}),
        ).is_ok_and(|value| {
            let source = &value["docs"][0]["doc"]["_source"];
            source["embedding_status"] == "ready" && source["embedding"].as_array().is_some_and(|v|
                v.len() == 384 && v.iter().all(|n| n.as_f64().is_some_and(f64::is_finite)))
        });
        self.status.model.store(inference_ready, Ordering::Relaxed);
        if !inference_ready && let Some(id) = model_id {
            let _ = self.request(
                reqwest::Method::POST,
                &format!("/_plugins/_ml/models/{id}/_deploy"),
                json!({}),
            );
        }
        Ok(())
    }
    fn reset_index(&self, target: &str, uuid: &str) -> Result<()> {
        let previous = self.store.get("publication_index", target)?;
        if previous
            .as_ref()
            .is_some_and(|d| d.record.payload["uuid"] == uuid)
        {
            return Ok(());
        }
        let mut after = None;
        loop {
            let mut q = json!({"size":32,"query":{"bool":{"filter":[{"term":{"kind":"publication"}},{"term":{"owner":target}}]}},"sort":["key"]});
            if let Some(value) = after {
                q["search_after"] = value;
            }
            let result = self.store.search(q)?;
            let docs = parse_command_state::hits(&result)?;
            for doc in &docs {
                let mut row = doc.record.clone();
                row.state = "pending".into();
                row.available = 0;
                row.payload["published_at"] = Value::Null;
                self.store.put(&row, Some(doc))?;
            }
            if docs.len() < 32 {
                break;
            }
            after = result["hits"]["hits"]
                .as_array()
                .and_then(|h| h.last())
                .map(|h| h["sort"].clone());
        }
        self.store.put(
            &Record::new("publication_index", target, json!({"uuid":uuid})),
            previous.as_ref(),
        )?;
        Ok(())
    }
    fn enqueue(&self, kind: &str, id: &str, target: &str, value: &Value) -> Result<()> {
        let key = format!("{kind}:{id}");
        let digest = hash(value.to_string().as_bytes());
        self.store.update("publication", &key, |old| {
            if let Some(old) = old {
                if kind == "audit" {
                    let mut previous = old.payload["document"].clone();
                    let mut candidate = value.clone();
                    if candidate["kind"] == "passage_prepared" {
                        previous
                            .as_object_mut()
                            .ok_or(parse_command_state::Error("state_record"))?
                            .remove("recorded_at");
                        candidate
                            .as_object_mut()
                            .ok_or(parse_command_state::Error("state_record"))?
                            .remove("recorded_at");
                    }
                    if previous != candidate {
                        return Err(parse_command_state::Error("immutable_audit_conflict"));
                    }
                    return Ok(old.clone());
                }
                if old.payload["checksum"] == digest {
                    return Ok(old.clone());
                }
            }
            let message = if kind == "message" {
                &value["id"]
            } else {
                &value["message_id"]
            };
            let mut row = old
                .cloned()
                .unwrap_or_else(|| Record::new("publication", &key, json!({"events":[]})));
            row.owner = target.into();
            row.category = kind.into();
            row.state = "pending".into();
            row.available = 0;
            row.source = format!(
                "{}@{}",
                message.as_str().unwrap_or(""),
                value["revision"].as_str().unwrap_or("")
            );
            row.order = match kind {
                "message" => 0,
                "passage" => 1,
                "audit" => 2,
                _ => 3,
            };
            for (key, value) in [
                ("id", json!(id)),
                ("document", value.clone()),
                ("checksum", json!(digest)),
                ("attempts", json!(0)),
                ("published_at", Value::Null),
                ("in_flight", json!(false)),
            ] {
                row.payload[key] = value;
            }
            row.bytes = row.payload.to_string().len() as u64;
            Ok(row)
        })?;
        Ok(())
    }
    fn flush_events(&self, kind: &str, row: &Record) -> Result<()> {
        let event_kind = if kind == "receipt" {
            "custody_event"
        } else {
            "publication_event"
        };
        let events = row.payload["events"]
            .as_array()
            .ok_or_else(Error::unavailable)?;
        for (i, event) in events.iter().enumerate() {
            let key = format!("{}:{i}", row.key);
            let old = self.store.get(event_kind, &key)?;
            let mut value = old
                .as_ref()
                .map(|d| d.record.clone())
                .unwrap_or_else(|| Record::new(event_kind, &key, event.clone()));
            if old.is_none() {
                value.order = self.store.next(event_kind)?;
            }
            value.source = row.source.clone();
            value.owner = row.key.clone();
            value.category = row.category.clone();
            value.state = event["state"].as_str().unwrap_or("").into();
            if old.as_ref().is_none_or(|d| d.record.source != value.source) {
                self.store.put(&value, old.as_ref())?;
            }
        }
        Ok(())
    }
    fn flush_receipts(&self) -> Result<()> {
        let rows = self.store.list(
            "receipt",
            vec![json!({"terms":{"flags":["events_pending","audit_pending"]}})],
            4,
        )?;
        for doc in rows {
            self.flush_events("receipt", &doc.record)?;
            for audit in doc.record.payload["audit"]
                .as_array()
                .ok_or_else(Error::unavailable)?
            {
                self.enqueue(
                    "audit",
                    audit["id"].as_str().ok_or_else(Error::unavailable)?,
                    AUDIT,
                    audit,
                )?;
            }
            let mut row = doc.record.clone();
            row.flags
                .retain(|f| !matches!(f.as_str(), "audit_pending" | "events_pending"));
            row.payload["audit_state"] = json!("queued");
            // A concurrent intake append keeps its flags and will be replayed.
            match self.store.put(&row, Some(&doc)) {
                Ok(_) | Err(parse_command_state::Error("state_conflict")) => {}
                Err(e) => return Err(e.into()),
            }
        }
        for doc in self.store.list(
            "publication",
            vec![json!({"term":{"flags":"events_pending"}})],
            16,
        )? {
            self.flush_events("publication", &doc.record)?;
            let mut row = doc.record.clone();
            row.flags.retain(|f| f != "events_pending");
            self.store.put(&row, Some(&doc))?;
        }
        Ok(())
    }
    fn expand(&self) -> Result<()> {
        self.store.refresh()?;
        self.flush_receipts()?;
        for doc in self
            .store
            .list("projection", vec![json!({"term":{"state":"pending"}})], 1)?
        {
            let core = &doc.record.payload["core"];
            let id = core["id"].as_str().ok_or_else(Error::unavailable)?;
            let revision = core["revision"].as_str().ok_or_else(Error::unavailable)?;
            let mut raw = None;
            let mut records = std::collections::BTreeMap::new();
            let audits = doc.record.payload["audits"]
                .as_array()
                .ok_or_else(Error::unavailable)?;
            if audits.len() > 8192 {
                return Err(Error::config("Audit selection bound"));
            }
            for audit in audits {
                if audit["kind"] == "source_preserved" {
                    raw = audit["payload"]["source"]["raw_text"]
                        .as_str()
                        .map(str::to_owned);
                }
                if matches!(
                    audit["kind"].as_str(),
                    Some("record_interpreted" | "fact_interpreted")
                ) && matches!(
                    audit["payload"]["set_id"].as_str(),
                    Some("GENTEXT" | "NARR" | "AMPN")
                ) {
                    records.insert(
                        audit["payload"]["record_sequence"]
                            .as_u64()
                            .ok_or_else(Error::unavailable)?,
                        audit["payload"].clone(),
                    );
                }
            }
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

            self.enqueue("message", &format!("{id}:{revision}"), MESSAGES, core)?;
            for (passage, audit) in derived {
                let pid = passage["id"].as_str().ok_or_else(Error::unavailable)?;
                self.enqueue("passage", pid, PASSAGES, &passage)?;
                self.enqueue("enrich", pid, PASSAGES, &passage)?;
                self.enqueue(
                    "audit",
                    audit["id"].as_str().ok_or_else(Error::unavailable)?,
                    AUDIT,
                    &audit,
                )?;
            }
            for audit in audits {
                self.enqueue(
                    "audit",
                    audit["id"].as_str().ok_or_else(Error::unavailable)?,
                    AUDIT,
                    audit,
                )?;
            }
            let mut row = doc.record.clone();
            row.state = "queued".into();
            // If intake selected a newer subject while expanding, the newer
            // projection remains pending and replaces these jobs on the next cycle.
            match self.store.put(&row, Some(&doc)) {
                Ok(_) | Err(parse_command_state::Error("state_conflict")) => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }
    fn record_delivery(&self, doc: &Document, success: bool, code: &str) -> Result<()> {
        let mut row = doc.record.clone();
        row.payload["in_flight"] = json!(false);
        let attempt = row.payload["attempts"].clone();
        let events = row.payload["events"]
            .as_array_mut()
            .ok_or_else(Error::unavailable)?;
        let last_failed = events
            .last()
            .is_some_and(|e| e["state"] != "publication_succeeded");
        let at = now();
        if !success || row.category == "message" || last_failed {
            if events.len() >= 10000 {
                return Err(Error::config("Publication history bound"));
            }
            events.push(json!({"state":if success {"publication_succeeded"} else {code},"code":code,"at":at,"attempt":attempt}));
            if !row.flags.iter().any(|f| f == "events_pending") {
                row.flags.push("events_pending".into());
            }
        }
        if success {
            row.state = "published".into();
            row.payload["published_at"] = json!(at);
            row.payload["last_error"] = Value::Null;
        } else {
            row.payload["last_error"] = json!(code);
        }
        self.store.put(&row, Some(doc))?;
        if success && row.category == "message" {
            self.store.update("projection", &row.source, |old| {
                let mut record = old
                    .cloned()
                    .ok_or(parse_command_state::Error("state_record"))?;
                if record.payload["core"] == row.payload["document"] {
                    record.state = "published".into();
                }
                Ok(record)
            })?;
        }
        Ok(())
    }
    fn deliver(&self) -> Result<usize> {
        let rows = self.store.list(
            "publication",
            vec![
                json!({"term":{"state":"pending"}}),
                json!({"range":{"available":{"lte":epoch()}}}),
            ],
            16,
        )?;
        let mut payload = String::new();
        let mut selected = Vec::new();
        for candidate in rows {
            // Search is near-real-time. Never deliver a stale source or an already
            // published job from an earlier refresh.
            let Some(mut doc) = self.store.get("publication", &candidate.record.key)? else {
                continue;
            };
            if doc.record.state != "pending" || doc.record.available > epoch() {
                continue;
            }
            let kind = doc.record.category.clone();
            let target = doc.record.owner.clone();
            let id = doc.record.payload["id"]
                .as_str()
                .ok_or_else(Error::unavailable)?
                .to_owned();
            if kind == "enrich"
                && !self
                    .store
                    .get("publication", &format!("passage:{id}"))?
                    .is_some_and(|d| d.record.state == "published")
            {
                continue;
            }
            let action = if kind == "audit" { "create" } else { "index" };
            let pipeline = if kind == "enrich" { INGEST } else { "_none" };
            let line = format!(
                "{}\n{}\n",
                json!({action:{"_index":target,"_id":id,"pipeline":pipeline}}),
                doc.record.payload["document"]
            );
            if payload.len() + line.len() > 2_097_152 {
                if selected.is_empty() {
                    return Err(Error::config("Publication document exceeds bound"));
                }
                break;
            }
            if doc.record.payload["in_flight"] == true {
                self.record_delivery(&doc, false, "publication_confirmation_missing")?;
                doc = self
                    .store
                    .get("publication", &doc.record.key)?
                    .ok_or_else(Error::unavailable)?;
            }
            let mut row = doc.record.clone();
            let attempt = row.payload["attempts"]
                .as_u64()
                .unwrap_or(0)
                .saturating_add(1);
            row.payload["attempts"] = json!(attempt);
            row.payload["in_flight"] = json!(true);
            row.available = epoch() + (1i64 << (attempt - 1).min(6)).min(60);
            let claimed = self.store.put(&row, Some(&doc))?;
            selected.push(claimed);
            payload.push_str(&line);
        }
        if selected.is_empty() {
            return Ok(0);
        }
        let bulk = (|| -> Result<Value> {
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
            serde_json::from_slice(&bytes).map_err(|_| Error::unavailable())
        })();
        let result = match bulk {
            Ok(value) => value,
            Err(error) => {
                for doc in &selected {
                    let _ = self.record_delivery(doc, false, "publication_unavailable");
                }
                return Err(error);
            }
        };
        let items = result["items"]
            .as_array()
            .filter(|v| v.len() == selected.len())
            .ok_or_else(Error::unavailable)?;
        for (doc, item) in selected.iter().zip(items) {
            let row = &doc.record;
            let kind = row.category.as_str();
            let target = &row.owner;
            let id = row.payload["id"].as_str().ok_or_else(Error::unavailable)?;
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
                let mut incoming = row.payload["document"].clone();
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
                let value = self.request(
                    reqwest::Method::GET,
                    &format!("/{target}/_doc/{id}?_source_includes=embedding_status"),
                    json!({}),
                )?;
                success = value["_source"]["embedding_status"] == "ready";
                self.status.model.store(success, Ordering::Relaxed);
            }
            self.record_delivery(
                doc,
                success,
                if success {
                    "publication_succeeded"
                } else {
                    "publication_item_failed"
                },
            )?;
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
            json!({"hybrid":{"pagination_depth":100,"queries":[{"bool":{"must":[lexical],"filter":"__FILTERS__"}},neural]}}),
        ),
    ] {
        if mode != "keyword" && model.is_none() {
            continue;
        }
        templates.push((format!("parse-command-passages-{mode}-v2"),json!({"size":100,"timeout":"5s","track_total_hits":false,"_source":["id","message_id","revision","text","embedding_status"],"query":query}).to_string()));
    }
    templates.push(("parse-command-message-detail-v1".into(),json!({"size":2,"timeout":"5s","query":{"bool":{"filter":[{"term":{"id":"__ID__"}},{"term":{"revision":"__REV__"}}]}}}).to_string()));
    templates.push(("parse-command-messages-list-v1".into(),json!({"size":21,"_source":["id","revision","type","originator","subject","issued_at","command_ids","security","status","review_flags"],"timeout":"5s","track_total_hits":false,"query":filters,"sort":[{"issued_at":{"order":"desc","missing":"_last"}},"id","revision"],"search_after":"__AFTER__","pit":{"id":"__PIT__","keep_alive":"60s"}}).to_string()));
    templates.push(("parse-command-messages-list-v2".into(),json!({"size":21,"_source":["id","revision","type","originator","subject","issued_at","command_ids","security","status","review_flags"],"timeout":"5s","track_total_hits":10000,"query":filters,"sort":"__SORT__","search_after":"__AFTER__","pit":{"id":"__PIT__","keep_alive":"120s"}}).to_string()));
    templates.push(("parse-command-message-options-v1".into(),json!({"size":0,"timeout":"5s","track_total_hits":false,"query":filters,"aggs":{"types":{"terms":{"field":"type","size":32,"order":{"_key":"asc"}}},"originators":{"terms":{"field":"originator","size":256,"order":{"_key":"asc"}}}}}).to_string()));
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
                .replace("\"__SORT__\"", "{{#toJson}}sort{{/toJson}}")
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
pub async fn journal_counts(store: &parse_command_state::Store) -> Result<Value> {
    let response=store.search(json!({"size":0,"query":{"term":{"kind":"publication"}},"aggs":{"states":{"multi_terms":{"terms":[{"field":"category"},{"field":"state"}],"size":32}}}})).await?;
    Ok(json!(response["aggregations"]["states"]["buckets"]))
}
