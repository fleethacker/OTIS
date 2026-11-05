use crate::{
    Error, Result,
    config::Config,
    pagination::{self, PAGE_SIZE, SEARCH_DEPTH, Sort},
    presentation,
    private::{Private, now, text, timestamp},
    publisher::{Status, journal_counts},
    search::*,
};
use axum::{
    extract::{Json, Path, State},
    http::HeaderMap,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
#[derive(Clone)]
pub struct App {
    pub config: Config,
    pub auth: crate::auth::Auth,
    pub search: Search,
    pub private: Private,
    pub custody: parse_command_state::Store,
    pub notification_sync: Arc<tokio::sync::Mutex<()>>,
    pub status: Status,
    pub inference: Arc<tokio::sync::Semaphore>,
}
impl App {
    pub fn store(&self) -> Result<&Private> {
        Ok(&self.private)
    }
    pub async fn identity(
        &self,
        cookie: Option<&str>,
        origin: Option<&str>,
        host: Option<&str>,
    ) -> Result<Identity> {
        self.auth.config.origin(origin)?;
        let _ = host;
        if self.config.auth.mode == "oidc" {
            return self.auth.identity(cookie).await;
        }
        if let Some(cookie) = cookie
            && let Some(token) = session_token(cookie)
        {
            let role =
                self.store()?.session(token).await?.ok_or_else(|| {
                    Error::new("unauthenticated", "Session expired; sign in again")
                })?;
            let identity = role_identity(&role)?;
            crate::settings::ensure_demo_user(&self.private.state, &identity).await?;
            return Ok(identity);
        }
        let identity = self
            .config
            .auto_role
            .as_deref()
            .map(role_identity)
            .transpose()?
            .ok_or_else(|| Error::new("unauthenticated", "Sign in to Parse Command"))?;
        crate::settings::ensure_demo_user(&self.private.state, &identity).await?;
        Ok(identity)
    }
    pub async fn headers_identity(&self, headers: &HeaderMap) -> Result<Identity> {
        self.identity(
            headers.get("cookie").and_then(|v| v.to_str().ok()),
            headers.get("origin").and_then(|v| v.to_str().ok()),
            headers.get("host").and_then(|v| v.to_str().ok()),
        )
        .await
    }
    pub async fn scope(&self, key: &str) -> Result<()> {
        if key.starts_with("legacy:") {
            if !self.config.allow_fixtures {
                return Err(Error::config("Legacy fixture mode is disabled"));
            }
            self.store()?.legacy(key).await?;
            return Ok(());
        }
        let (id, revision) = split_key(key)?;
        self.search.canonical(id, revision).await?;
        Ok(())
    }
    pub async fn execute(&self, op: &str, request: ReadRequest, owner: &str) -> Result<Value> {
        let mut value = self.execute_inner(op, request, owner).await?;
        crate::xnet::view::decorate(&self.custody, &mut value).await?;
        Ok(value)
    }
    async fn execute_inner(&self, op: &str, request: ReadRequest, owner: &str) -> Result<Value> {
        let mut filters = request.filters.validate()?;
        if matches!(op, "list" | "options" | "search" | "timeline") {
            crate::xnet::view::apply(&self.private.state, &self.custody, owner, &mut filters).await?;
        }
        if request.dataset == Dataset::Legacy {
            if !self.config.allow_fixtures {
                return Err(Error::config("Legacy fixture mode is disabled"));
            }
            let store = self.store()?;
            let documents = if op == "detail" {
                vec![
                    store
                        .legacy(
                            request
                                .key
                                .as_deref()
                                .ok_or_else(|| Error::invalid("message key is required"))?,
                        )
                        .await?,
                ]
            } else {
                store.legacy_list().await?
            };
            let mut messages = Vec::new();
            for row in documents {
                let value = presentation::legacy(&row, store, op == "detail").await?;
                if request.query.is_empty()
                    || row
                        .to_string()
                        .to_lowercase()
                        .contains(&request.query.to_lowercase())
                {
                    messages.push(value);
                }
            }
            return Ok(envelope(
                messages,
                "Explicit legacy fixture dataset; not operational source data",
                json!({"dataset":"legacy","executedMode":"fixture","limit":100}),
            ));
        }
        match op {
            "list" => self.list(request, filters, owner).await,
            "options" => self.options(filters).await,
            "search" => self.search_messages(request, filters, owner).await,
            "detail" => {
                self.detail(
                    request
                        .key
                        .as_deref()
                        .ok_or_else(|| Error::invalid("message key is required"))?,
                )
                .await
            }
            "timeline" => self.timeline(request, filters, owner).await,
            "evidence" => self.evidence_request(request).await,
            _ => Err(Error::new("not_found", "Unknown read operation")),
        }
    }
    async fn options(&self, filters: Value) -> Result<Value> {
        let result = self
            .search
            .template(
                MESSAGE_ALIAS,
                "parse-command-message-options-v1",
                json!({"filters":filters}),
                false,
            )
            .await?;
        let values = |name: &str| {
            result["aggregations"][name]["buckets"]
                .as_array()
                .map(|v| {
                    v.iter()
                        .filter_map(|b| b["key"].as_str().map(str::to_owned))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        };
        Ok(envelope(
            vec![],
            "Source metadata filter options",
            json!({"filterOptions":{"messageTypes":values("types"),"originators":values("originators")}}),
        ))
    }
    async fn list(&self, request: ReadRequest, filters: Value, owner: &str) -> Result<Value> {
        let fingerprint = read_fingerprint("browse", owner, &request, &filters);
        let (id, page, mut state) = if let Some(value) = &request.page_token {
            let (id, page) = pagination::split_token(value)?;
            (
                id.to_owned(),
                page,
                self.store()?.read_window(id, &fingerprint).await?,
            )
        } else {
            let value = self
                .search
                .post(
                    &format!("/{MESSAGE_ALIAS}/_search/point_in_time?keep_alive=120s"),
                    json!({}),
                )
                .await?;
            let pit = value["pit_id"]
                .as_str()
                .ok_or_else(Error::unavailable)?
                .to_owned();
            let state = json!({"kind":"browse","pit":pit,"anchors":[[]]});
            let stored = { self.store()?.put_read_window(&fingerprint, &state).await };
            match stored {
                Ok(id) => (id, 0, state),
                Err(error) => {
                    let _ = self
                        .search
                        .request(
                            reqwest::Method::DELETE,
                            "/_search/point_in_time",
                            Some(json!({"pit_id":[pit]})),
                        )
                        .await;
                    return Err(error);
                }
            }
        };
        if state["kind"] != "browse" {
            return Err(Error::invalid("Invalid result page"));
        }
        let pit = state["pit"]
            .as_str()
            .ok_or_else(Error::unavailable)?
            .to_owned();
        let after = state["anchors"]
            .as_array()
            .and_then(|v| v.get(page))
            .ok_or_else(|| Error::invalid("Result page is not available"))?
            .clone();
        let response=self.search.template("","parse-command-messages-list-v2",json!({"filters":filters,"pit_id":pit,"after":after,"has_after":after.as_array().is_some_and(|v|!v.is_empty()),"sort":request.sort.browse()}),false).await?;
        let hits = response["hits"]["hits"]
            .as_array()
            .ok_or_else(Error::unavailable)?;
        let more = hits.len() > PAGE_SIZE;
        if more {
            let anchor = hits[PAGE_SIZE - 1]["sort"].clone();
            let anchors = state["anchors"]
                .as_array_mut()
                .ok_or_else(Error::unavailable)?;
            if anchors.len() == page + 1 {
                anchors.push(anchor);
            } else if anchors.get(page + 1) != Some(&anchor) {
                return Err(Error::unavailable());
            }
        }
        self.store()?
            .save_read_window(&id, &fingerprint, &state)
            .await?;
        let total = response["hits"]["total"]["value"]
            .as_u64()
            .ok_or_else(Error::unavailable)?;
        let relation = response["hits"]["total"]["relation"]
            .as_str()
            .ok_or_else(Error::unavailable)?;
        let mut messages = Vec::new();
        let mut headers = serde_json::Map::new();
        {
            let store = self.store()?;
            for hit in hits.iter().take(PAGE_SIZE) {
                let core = &hit["_source"];
                headers.insert(
                    format!("{}@{}", text(core, "id"), text(core, "revision")),
                    presentation::message_header(core),
                );
                messages.push(presentation::message(core, store, false, None, None).await?);
            }
        }
        let mut meta = pagination::metadata(&id, page, total, relation, more, "records");
        meta["dataset"] = json!("canonical");
        meta["executedMode"] = json!("browse");
        meta["messageHeaders"] = json!(headers);
        Ok(envelope(messages, "Canonical message page", meta))
    }
    async fn search_messages(
        &self,
        request: ReadRequest,
        filters: Value,
        owner: &str,
    ) -> Result<Value> {
        if request.query.trim().is_empty() {
            return Err(Error::invalid("Use message browsing for an empty query"));
        }
        if request.query.len() > 240 {
            return Err(Error::invalid("Search query exceeds 240 UTF-8 bytes"));
        }
        let fingerprint = read_fingerprint("search", owner, &request, &filters);
        if let Some(value) = &request.page_token {
            let (id, page) = pagination::split_token(value)?;
            let state = self.store()?.read_window(id, &fingerprint).await?;
            return self.search_page(id, page, &state).await;
        }
        let mode = request.mode.as_str();
        let _permit = if mode != "keyword" {
            if !self.status.model.load(Ordering::Relaxed) {
                return Err(Error::new(
                    "unavailable",
                    "Local embedding model is unavailable; keyword search remains available",
                ));
            }
            Some(self.inference.clone().try_acquire_owned().map_err(|_| {
                Error::new(
                    "resource_exhausted",
                    "An inference request is already running; retry shortly",
                )
            })?)
        } else {
            None
        };
        let response = self
            .search
            .template(
                "parse-command-search-passages",
                &format!("parse-command-passages-{mode}-v2"),
                json!({"query":request.query,"filters":filters}),
                mode == "hybrid",
            )
            .await?;
        let hits = response["hits"]["hits"]
            .as_array()
            .ok_or_else(Error::unavailable)?;
        let mut candidates = Vec::new();
        let mut excerpts = serde_json::Map::new();
        for hit in hits {
            let src = &hit["_source"];
            let id = text(src, "message_id");
            let revision = text(src, "revision");
            validate_key(id, revision)?;
            let key = format!("{id}@{revision}");
            if !excerpts.contains_key(&key) && candidates.len() < SEARCH_DEPTH {
                candidates.push((id.to_owned(), revision.to_owned(), hit["_score"].clone()));
                excerpts.insert(key.clone(), json!([]));
            }
            if let Some(array) = excerpts.get_mut(&key).and_then(Value::as_array_mut)
                && array.len() < 2
            {
                let source = text(src, "text");
                let bounded = source.chars().take(800).collect::<String>();
                array.push(json!({"passageId":src["id"],"text":bounded,"embeddingStatus":src["embedding_status"]}));
            }
        }
        let ids = candidates
            .iter()
            .map(|(id, r, _)| json!({"id":id,"revision":r}))
            .collect::<Vec<_>>();
        let hydrated = if ids.is_empty() {
            json!({"docs":[]})
        } else {
            self.search.post(&format!("/{MESSAGES}/_mget?_source_includes=id,revision,type,originator,subject,status,review_flags,issued_at,expires_at,command_ids,security,casualty.serial,casualty.reporting_uic,casualty.category,casualty.report_type,casualty.eic,casualty.identifiers"),json!({"ids":candidates.iter().map(|(id,r,_)|format!("{id}:{r}")).collect::<Vec<_>>()})).await?
        };
        let docs = hydrated["docs"].as_array().ok_or_else(Error::unavailable)?;
        let mut documents = Vec::new();
        let mut stale = 0;
        for ((id, revision, _), doc) in candidates.iter().zip(docs) {
            if doc["found"] != true
                || doc["_source"]["id"] != *id
                || doc["_source"]["revision"] != *revision
                || !request.filters.matches(&doc["_source"])?
            {
                stale += 1;
                continue;
            }
            documents.push(doc["_source"].clone());
        }
        pagination::sort_documents(&mut documents, request.sort)?;
        let state = json!({"kind":"search","documents":documents,"excerpts":excerpts,"mode":mode,"windowLimited":hits.len()>=SEARCH_DEPTH,"staleHitsDropped":stale,"tookMs":response["took"],"snapshotAt":now()});
        let id = self.store()?.put_read_window(&fingerprint, &state).await?;
        self.search_page(&id, 0, &state).await
    }
    async fn search_page(&self, id: &str, page: usize, state: &Value) -> Result<Value> {
        if state["kind"] != "search" {
            return Err(Error::invalid("Invalid result page"));
        }
        let docs = state["documents"]
            .as_array()
            .ok_or_else(Error::unavailable)?;
        let start = page
            .checked_mul(PAGE_SIZE)
            .ok_or_else(|| Error::invalid("Invalid result page"))?;
        if page > 0 && start >= docs.len() {
            return Err(Error::invalid("Result page is not available"));
        }
        let mut messages = Vec::new();
        let mut headers = serde_json::Map::new();
        let mut excerpts = serde_json::Map::new();
        {
            let store = self.store()?;
            for core in docs.iter().skip(start).take(PAGE_SIZE) {
                let key = format!("{}@{}", text(core, "id"), text(core, "revision"));
                headers.insert(key.clone(), presentation::message_header(core));
                if let Some(value) = state["excerpts"].get(&key) {
                    excerpts.insert(key.clone(), value.clone());
                }
                messages.push(presentation::message(core, store, false, None, None).await?);
            }
        }
        let mut meta = pagination::metadata(
            id,
            page,
            docs.len() as u64,
            "eq",
            start + PAGE_SIZE < docs.len(),
            "ranked_matches",
        );
        meta["dataset"] = json!("canonical");
        meta["snapshotAt"] = state["snapshotAt"].clone();
        meta["requestedMode"] = state["mode"].clone();
        meta["tookMs"] = state["tookMs"].clone();
        meta["executedMode"] = state["mode"].clone();
        meta["windowLimited"] = state["windowLimited"].clone();
        meta["candidateLimit"] = json!(SEARCH_DEPTH);
        meta["messageHeaders"] = json!(headers);
        meta["matchedExcerpts"] = json!(excerpts);
        meta["staleHitsDropped"] = state["staleHitsDropped"].clone();
        Ok(envelope(messages, "Page of ranked message matches", meta))
    }
    pub async fn detail(&self, key: &str) -> Result<Value> {
        let (id, revision) = split_key(key)?;
        let core = self.search.canonical(id, revision).await?;
        let audits = self
            .audit_records(
                id,
                revision,
                Some(vec![
                    "source_preserved",
                    "email_received",
                    "parse_completed",
                ]),
                None,
            )
            .await?;
        let mut raw = None;
        let mut received = None;
        for doc in &audits {
            if doc["kind"] == "source_preserved" {
                raw = doc["payload"]["source"]["raw_text"].as_str();
            }
            if doc["kind"] == "email_received"
                && let Some(at) = doc["payload"]["server_received_at"]
                    .as_str()
                    .or(doc["recorded_at"].as_str())
                && received.is_none_or(|old| at > old)
            {
                received = Some(at);
            }
        }
        if let Some(source) = raw
            && format!("sha256:{:x}", Sha256::digest(source.as_bytes())) != id
        {
            return Err(Error::unavailable());
        }
        let mut record = presentation::message(&core, self.store()?, true, raw, received).await?;
        let mut payload = core.clone();
        let history = crate::lifecycle::read(&self.custody, id, revision).await;
        match history {
            Ok(history) => {
                record["lifecycleEntries"] = history["entries"].clone();
                payload["lifecycle_state"] = json!("available");
                payload["lifecycle_limited"] = history["limited"].clone();
            }
            _ => {
                payload["lifecycle_state"] = json!("unavailable");
            }
        }
        if let Some(issue) = core["issued_at"].as_str() {
            record["lifecycleEntries"].as_array_mut().ok_or_else(Error::unavailable)?.insert(0,json!({"id":"issued","milestone":"issued","recordedAt":timestamp(issue)?,"detail":"","provenance":"source"}));
        }
        if let Some(source) = raw {
            let (profile, sets) = presentation::source_sets(&audits, source)?;
            payload["source_profile"] = json!(profile);
            payload["sets"] = sets;
        }
        if core["type"] == "CASREP" {
            let key = crate::casualties::key(&core);
            match self
                .search
                .post(
                    &format!("/{}/_search", crate::casualties::INDEX),
                    json!({"size":1,"query":{"term":{"id":key}}}),
                )
                .await
            {
                Ok(value) if value["hits"]["hits"][0]["_source"]["id"] == key => {
                    payload["casualty_history"] = value["hits"]["hits"][0]["_source"].clone();
                }
                _ => {
                    payload["casualty_history_state"] = json!("unavailable");
                }
            }
        }
        record["structuredPayloadJson"] = json!(payload.to_string());
        Ok(envelope(
            vec![record],
            "Canonical parsed record; evidence is separate and all extraction/review states are preserved",
            json!({"dataset":"canonical","evidenceState":if raw.is_some(){"available"}else{"pending"},"messageKey":key}),
        ))
    }
    pub async fn audit_records(
        &self,
        id: &str,
        revision: &str,
        kinds: Option<Vec<&str>>,
        fact: Option<&str>,
    ) -> Result<Vec<Value>> {
        let mut filters = vec![
            json!({"term":{"message_id":id}}),
            json!({"term":{"revision":revision}}),
        ];
        if let Some(kinds) = kinds {
            filters.push(json!({"terms":{"kind":kinds}}));
        }
        if let Some(fact) = fact {
            filters.push(json!({"term":{"subject_id":fact}}));
        }
        let mut after = json!([]);
        let mut values = Vec::new();
        let mut bytes = 0usize;
        for _ in 0..128 {
            let result=self.search.template(AUDIT,"parse-command-evidence-list-v1",json!({"filters":filters,"after":after,"has_after":after.as_array().is_some_and(|v|!v.is_empty())}),false).await?;
            let hits = result["hits"]["hits"]
                .as_array()
                .ok_or_else(Error::unavailable)?;
            let more = hits.len() > 64;
            for hit in hits.iter().take(64) {
                let source = hit["_source"].clone();
                bytes = bytes.saturating_add(source.to_string().len());
                if bytes > 2_097_152 {
                    return Err(Error::new(
                        "resource_exhausted",
                        "Evidence selection exceeds the response bound; request a specific fact",
                    ));
                }
                values.push(source);
            }
            if !more {
                return Ok(values);
            }
            after = hits[63]["sort"].clone();
        }
        Err(Error::new(
            "resource_exhausted",
            "Evidence page bound reached",
        ))
    }
    async fn evidence_request(&self, request: ReadRequest) -> Result<Value> {
        let key = request
            .key
            .ok_or_else(|| Error::invalid("Message key is required"))?;
        let (id, revision) = split_key(&key)?;
        self.search.canonical(id, revision).await?;
        let fact = request.fact_id.as_deref();
        if fact.is_some_and(|s| parse_command_types::validate_subject_id(s, None, "fact").is_err())
        {
            return Err(Error::invalid("Invalid fact ID"));
        }
        let mut audits = self
            .audit_records(
                id,
                revision,
                if request.passage_id.is_some() {
                    Some(vec!["passage_prepared"])
                } else {
                    None
                },
                fact,
            )
            .await?;
        if let Some(passage) = request.passage_id {
            if passage.len() != 71 || !passage.starts_with("sha256:") {
                return Err(Error::invalid("Invalid passage ID"));
            }
            audits.retain(|v| v["payload"]["passage_id"] == passage);
        }
        Ok(json!({"messageKey":key,"records":audits,"retrievedAt":now(),"state":"available"}))
    }
    async fn timeline(&self, request: ReadRequest, filters: Value, owner: &str) -> Result<Value> {
        let from = timestamp(
            request
                .from
                .as_deref()
                .ok_or_else(|| Error::invalid("UTC window start is required"))?,
        )?;
        let to = timestamp(
            request
                .to
                .as_deref()
                .ok_or_else(|| Error::invalid("UTC window end is required"))?,
        )?;
        let duration = chrono::DateTime::parse_from_rfc3339(&to)
            .map_err(|_| Error::invalid("Window"))?
            .signed_duration_since(
                chrono::DateTime::parse_from_rfc3339(&from)
                    .map_err(|_| Error::invalid("Window"))?,
            );
        if duration <= chrono::Duration::zero() || duration > chrono::Duration::days(42) {
            return Err(Error::invalid(
                "Timeline window must be positive and at most 42 days",
            ));
        }
        let mut filters = filters;
        let mut search_limited = false;
        let mut executed_mode = json!("browse");
        if !request.query.trim().is_empty() {
            let search_request = ReadRequest {
                query: request.query.clone(),
                mode: request.mode.clone(),
                filters: request.filters.clone(),
                ..ReadRequest::default()
            };
            let results = self
                .search_messages(search_request, filters.clone(), owner)
                .await?;
            // Forward execution metadata only; preserve the existing ranking/filter path.
            executed_mode = results["meta"]["executedMode"].clone();
            search_limited = results["meta"]["windowLimited"] == true
                || results["messages"]
                    .as_array()
                    .is_some_and(|v| v.len() >= 20);
            let pairs = results["messages"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| v["sourceMessageId"].as_str())
                .map(|key| {
                    let (id, rev) = split_key(key)?;
                    Ok(json!({"bool":{"filter":[{"term":{"id":id}},{"term":{"revision":rev}}]}}))
                })
                .collect::<Result<Vec<Value>>>()?;
            filters
                .as_array_mut()
                .ok_or_else(Error::unavailable)?
                .push(if pairs.is_empty() {
                    json!({"match_none":{}})
                } else {
                    json!({"bool":{"should":pairs,"minimum_should_match":1}})
                });
        }
        let response = self
            .search
            .template(
                MESSAGE_ALIAS,
                TIMELINE_TEMPLATE,
                json!({"filters":filters,"from":from,"to":to}),
                false,
            )
            .await?;
        let hits = response["hits"]["hits"]
            .as_array()
            .ok_or_else(Error::unavailable)?;
        let mut items = Vec::new();
        let mut review = Vec::new();
        let mut messages = Vec::new();
        {
            let store = self.store()?;
            for hit in hits.iter().take(100) {
                let core = &hit["_source"];
                let (mut dated, mut unresolved) = presentation::timeline_with_limit(
                    core,
                    &from,
                    &to,
                    2048usize.saturating_sub(items.len() + review.len()),
                )?;
                items.append(&mut dated);
                review.append(&mut unresolved);
                messages.push(presentation::message(core, store, false, None, None).await?);
            }
        }
        if items.len() + review.len() > 2048 {
            return Err(Error::new(
                "resource_exhausted",
                "Timeline fact bound reached; narrow the command/time selection",
            ));
        }
        Ok(envelope(
            messages,
            "Resolved source times are displayed as extracted facts requiring review, not operational confirmation",
            json!({"dataset":"canonical","executedMode":executed_mode,"timelineItems":items,"reviewItems":review,"from":from,"to":to,"windowLimited":hits.len()>100||search_limited,"messageLimit":100}),
        ))
    }
    pub async fn source_status(&self) -> Result<Value> {
        let health = self.search.get("/_cluster/health").await?;
        let embeddings = self
            .search
            .template(
                "parse-command-search-passages",
                "parse-command-source-status-v1",
                json!({}),
                false,
            )
            .await?;
        let jobs = journal_counts(&self.custody).await?;
        Ok(
            json!({"source":"opensearch","cluster":health["status"],"publicationReady":self.status.ready.load(Ordering::Relaxed),"modelReady":self.status.model.load(Ordering::Relaxed),"publication":jobs,"embeddings":embeddings["aggregations"]["embedding_states"]["buckets"],"observedAt":now()}),
        )
    }
}
fn read_fingerprint(kind: &str, owner: &str, request: &ReadRequest, filters: &Value) -> String {
    format!("{:x}",Sha256::digest(json!({"kind":kind,"owner":owner,"query":request.query,"mode":request.mode.as_str(),"sort":request.sort.as_str(),"filters":filters}).to_string().as_bytes()))
}
fn envelope(messages: Vec<Value>, notice: &str, meta: Value) -> Value {
    json!({"messages":messages,"source":"parse-command-opensearch","notice":notice,"retrievedAt":now(),"meta":meta})
}
#[derive(Clone, Serialize)]
pub struct Identity {
    pub username: String,
    pub email: String,
    pub groups: Vec<String>,
    pub role: String,
    #[serde(skip)]
    pub owner: String,
}
pub fn role_identity(role: &str) -> Result<Identity> {
    match role {
        "user" | "viewer" => Ok(Identity {
            username: "dev-user".into(),
            owner: "demo:dev-user".into(),
            email: "dev@localhost".into(),
            groups: vec![],
            role: "viewer".into(),
        }),
        "platform_admin" | "admin" => Ok(Identity {
            username: "dev-admin".into(),
            owner: "demo:dev-admin".into(),
            email: "admin@localhost".into(),
            groups: vec!["/Parse Command/Admin".into()],
            role: "admin".into(),
        }),
        _ => Err(Error::new("unauthenticated", "Unknown demo identity")),
    }
}
pub fn session_token(cookie: &str) -> Option<&str> {
    cookie
        .split(';')
        .map(str::trim)
        .find_map(|v| v.strip_prefix("parse_command_session="))
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Filters {
    pub command_ids: Vec<String>,
    pub message_types: Vec<String>,
    pub originators: Vec<String>,
    pub classifications: Vec<String>,
    pub issued_from: Option<String>,
    pub issued_to: Option<String>,
    pub unassigned_only: bool,
    pub no_commands: bool,
    pub casualty_serials: Vec<String>,
    pub casualty_uics: Vec<String>,
    pub casualty_categories: Vec<String>,
    pub casualty_report_types: Vec<String>,
    pub casualty_eics: Vec<String>,
    pub casualty_identifiers: Vec<String>,
}
impl Filters {
    pub fn validate(&self) -> Result<Value> {
        let mut filters = Vec::new();
        for (name, values) in [
            ("command_ids", &self.command_ids),
            ("type", &self.message_types),
            ("originator", &self.originators),
            ("security.classification", &self.classifications),
            ("casualty.serial", &self.casualty_serials),
            ("casualty.reporting_uic", &self.casualty_uics),
            ("casualty.category", &self.casualty_categories),
            ("casualty.report_type", &self.casualty_report_types),
            ("casualty.eic", &self.casualty_eics),
            ("casualty.identifiers", &self.casualty_identifiers),
        ] {
            if values.len() > 32 || values.iter().any(|v| v.trim().is_empty() || v.len() > 256) {
                return Err(Error::invalid("Invalid metadata filter bounds"));
            }
            if !values.is_empty() {
                if name == "command_ids" && self.unassigned_only {
                    filters.push(json!({"bool":{"should":[{"terms":{name:values}},{"bool":{"must_not":[{"exists":{"field":"command_ids"}}]}}],"minimum_should_match":1}}));
                } else {
                    filters.push(json!({"terms":{name:values}}));
                }
            }
        }
        if self.no_commands {
            filters.push(json!({"match_none":{}}));
        }
        if self.unassigned_only && self.command_ids.is_empty() {
            filters.push(json!({"bool":{"must_not":[{"exists":{"field":"command_ids"}}]}}));
        }
        let from = self.issued_from.as_deref().map(timestamp).transpose()?;
        let to = self.issued_to.as_deref().map(timestamp).transpose()?;
        if from.as_ref().zip(to.as_ref()).is_some_and(|(a, b)| a >= b) {
            return Err(Error::invalid("Issue-time interval order"));
        }
        if let Some(from) = from {
            filters.push(json!({"range":{"issued_at":{"gte":from}}}));
        }
        if let Some(to) = to {
            filters.push(json!({"range":{"issued_at":{"lt":to}}}));
        }
        if filters.is_empty() {
            filters.push(json!({"match_all":{}}));
        }
        Ok(json!(filters))
    }
    fn matches(&self, core: &Value) -> Result<bool> {
        self.validate()?;
        let commands = core["command_ids"].as_array();
        if self.no_commands {
            return Ok(false);
        }
        let unassigned = commands.is_none_or(|v| v.is_empty());
        if self.unassigned_only && self.command_ids.is_empty() && !unassigned {
            return Ok(false);
        }
        if !self.command_ids.is_empty()
            && !(self.unassigned_only && unassigned)
            && !commands.is_some_and(|v| {
                v.iter().any(|c| {
                    c.as_str()
                        .is_some_and(|c| self.command_ids.iter().any(|id| id == c))
                })
            })
        {
            return Ok(false);
        }
        if !self.message_types.is_empty() && !self.message_types.iter().any(|t| core["type"] == *t)
        {
            return Ok(false);
        }
        if !self.originators.is_empty()
            && !self.originators.iter().any(|v| core["originator"] == *v)
        {
            return Ok(false);
        }
        if !self.classifications.is_empty()
            && !self
                .classifications
                .iter()
                .any(|t| core["security"]["classification"] == *t)
        {
            return Ok(false);
        }
        for (field, values) in [
            ("serial", &self.casualty_serials),
            ("reporting_uic", &self.casualty_uics),
            ("category", &self.casualty_categories),
            ("report_type", &self.casualty_report_types),
            ("eic", &self.casualty_eics),
        ] {
            if !values.is_empty() && !values.iter().any(|v| core["casualty"][field] == *v) {
                return Ok(false);
            }
        }
        if !self.casualty_identifiers.is_empty()
            && !core["casualty"]["identifiers"]
                .as_array()
                .is_some_and(|ids| {
                    ids.iter()
                        .any(|id| self.casualty_identifiers.iter().any(|v| id == v))
                })
        {
            return Ok(false);
        }
        if let Some(from) = &self.issued_from {
            let Some(at) = core["issued_at"].as_str() else {
                return Ok(false);
            };
            if timestamp(at)? < timestamp(from)? {
                return Ok(false);
            }
        }
        if let Some(to) = &self.issued_to {
            let Some(at) = core["issued_at"].as_str() else {
                return Ok(false);
            };
            if timestamp(at)? >= timestamp(to)? {
                return Ok(false);
            }
        }
        Ok(true)
    }
}
#[derive(Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Keyword,
    Semantic,
    #[default]
    Hybrid,
}
impl Mode {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Keyword => "keyword",
            Self::Semantic => "semantic",
            Self::Hybrid => "hybrid",
        }
    }
}
#[derive(Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Dataset {
    #[default]
    Canonical,
    Legacy,
}
#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct ReadRequest {
    pub query: String,
    pub mode: Mode,
    pub sort: Sort,
    pub filters: Filters,
    pub page_token: Option<String>,
    pub key: Option<String>,
    pub dataset: Dataset,
    pub from: Option<String>,
    pub to: Option<String>,
    pub fact_id: Option<String>,
    pub passage_id: Option<String>,
}
pub async fn read(
    State(app): State<Arc<App>>,
    Path(op): Path<String>,
    headers: HeaderMap,
    Json(request): Json<ReadRequest>,
) -> Result<Json<Value>> {
    let owner = app.headers_identity(&headers).await?;
    if request.query.len() > 240 {
        return Err(Error::invalid("Query exceeds 240 bytes"));
    }
    let value = tokio::time::timeout(
        Duration::from_secs(7),
        app.execute(&op, request, &owner.owner),
    )
    .await
    .map_err(|_| Error::unavailable())??;
    if value.to_string().len() > 2_097_152 {
        return Err(Error::new(
            "resource_exhausted",
            "Read response exceeds bound",
        ));
    }
    Ok(Json(value))
}
pub async fn status(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    app.headers_identity(&headers).await?;
    Ok(Json(app.source_status().await?))
}
