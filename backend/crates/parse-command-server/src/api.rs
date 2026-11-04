use crate::{
    Error, Result,
    config::Config,
    presentation,
    private::{Private, now, text, timestamp},
    publisher::{Status, journal_counts},
    search::*,
};
use axum::{
    extract::{Json, Path, State},
    http::HeaderMap,
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    sync::{Arc, Mutex, atomic::Ordering},
    time::Duration,
};
#[derive(Clone)]
pub struct App {
    pub config: Config,
    pub search: Search,
    pub private: Arc<Mutex<Private>>,
    pub status: Status,
    pub inference: Arc<tokio::sync::Semaphore>,
}
impl App {
    pub fn store(&self) -> Result<std::sync::MutexGuard<'_, Private>> {
        self.private.lock().map_err(|_| Error::unavailable())
    }
    pub fn identity(
        &self,
        cookie: Option<&str>,
        origin: Option<&str>,
        host: Option<&str>,
    ) -> Result<Identity> {
        if let Some(origin) = origin {
            let expected = format!("http://{}", host.unwrap_or(""));
            if origin != expected {
                return Err(Error::new(
                    "unauthenticated",
                    "Cross-origin requests are not accepted",
                ));
            }
        }
        if let Some(cookie) = cookie
            && let Some(token) = session_token(cookie)
        {
            let role = self
                .store()?
                .session(token)?
                .ok_or_else(|| Error::new("unauthenticated", "Session expired; sign in again"))?;
            return role_identity(&role);
        }
        self.config
            .auto_role
            .as_deref()
            .map(role_identity)
            .transpose()?
            .ok_or_else(|| Error::new("unauthenticated", "Sign in to Parse Command"))
    }
    pub fn headers_identity(&self, headers: &HeaderMap) -> Result<Identity> {
        self.identity(
            headers.get("cookie").and_then(|v| v.to_str().ok()),
            headers.get("origin").and_then(|v| v.to_str().ok()),
            headers.get("host").and_then(|v| v.to_str().ok()),
        )
    }
    pub async fn scope(&self, key: &str) -> Result<()> {
        if key.starts_with("legacy:") {
            if !self.config.allow_fixtures {
                return Err(Error::config("Legacy fixture mode is disabled"));
            }
            self.store()?.legacy(key)?;
            return Ok(());
        }
        let (id, revision) = split_key(key)?;
        self.search.canonical(id, revision).await?;
        Ok(())
    }
    pub async fn execute(&self, op: &str, request: ReadRequest, owner: &str) -> Result<Value> {
        let filters = request.filters.validate()?;
        if request.dataset == Dataset::Legacy {
            if !self.config.allow_fixtures {
                return Err(Error::config("Legacy fixture mode is disabled"));
            }
            let store = self.store()?;
            let documents = if op == "detail" {
                vec![
                    store.legacy(
                        request
                            .key
                            .as_deref()
                            .ok_or_else(|| Error::invalid("message key is required"))?,
                    )?,
                ]
            } else {
                store.legacy_list()?
            };
            let mut messages = Vec::new();
            for row in documents {
                let value = presentation::legacy(&row, &store, op == "detail")?;
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
            "search" => self.search_messages(request, filters).await,
            "detail" => {
                self.detail(
                    request
                        .key
                        .as_deref()
                        .ok_or_else(|| Error::invalid("message key is required"))?,
                )
                .await
            }
            "timeline" => self.timeline(request, filters).await,
            "evidence" => self.evidence_request(request).await,
            _ => Err(Error::new("not_found", "Unknown read operation")),
        }
    }
    async fn list(&self, request: ReadRequest, filters: Value, owner: &str) -> Result<Value> {
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(
                json!({"owner":owner,"filters":filters})
                    .to_string()
                    .as_bytes()
            )
        );
        let (pit, after) = if let Some(token) = request.page_token {
            if token.len() != 64 {
                return Err(Error::invalid("Invalid page token"));
            }
            let store = self.store()?;
            let value:Option<(String,String,String)>=store.db.query_row("SELECT pit,after_json,fingerprint FROM cursors WHERE token=? AND expires>=unixepoch()",[token],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
            let (pit, after, expected) =
                value.ok_or_else(|| Error::invalid("Page expired; restart browsing"))?;
            if expected != fingerprint {
                return Err(Error::invalid(
                    "Page token does not match the query and identity",
                ));
            }
            (
                pit,
                serde_json::from_str(&after).map_err(|_| Error::unavailable())?,
            )
        } else {
            let value = self
                .search
                .post(
                    &format!("/{MESSAGE_ALIAS}/_search/point_in_time?keep_alive=60s"),
                    json!({}),
                )
                .await?;
            (
                value["pit_id"]
                    .as_str()
                    .ok_or_else(Error::unavailable)?
                    .to_owned(),
                json!([]),
            )
        };
        let response=self.search.template("","parse-command-messages-list-v1",json!({"filters":filters,"pit_id":pit,"after":after,"has_after":after.as_array().is_some_and(|v|!v.is_empty())}),false).await?;
        let hits = response["hits"]["hits"]
            .as_array()
            .ok_or_else(Error::unavailable)?;
        let more = hits.len() > 20;
        let mut messages = Vec::new();
        {
            let store = self.store()?;
            for hit in hits.iter().take(20) {
                messages.push(presentation::message(
                    &hit["_source"],
                    &store,
                    false,
                    None,
                    None,
                )?);
            }
        }
        let next = if more {
            let sort = hits[19]["sort"].clone();
            let token = self.store()?.cursor(&pit, &sort, &fingerprint)?;
            Some(token)
        } else {
            let _ = self
                .search
                .request(
                    reqwest::Method::DELETE,
                    "/_search/point_in_time",
                    Some(json!({"pit_id":[pit]})),
                )
                .await;
            None
        };
        Ok(envelope(
            messages,
            "Canonical messages from OpenSearch; extraction and command assignments require review",
            json!({"dataset":"canonical","executedMode":"browse","nextPageToken":next,"limit":20}),
        ))
    }
    async fn search_messages(&self, request: ReadRequest, filters: Value) -> Result<Value> {
        if request.query.trim().is_empty() {
            return Err(Error::invalid("Use message browsing for an empty query"));
        }
        if request.query.len() > 240 {
            return Err(Error::invalid("Search query exceeds 240 UTF-8 bytes"));
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
            if !excerpts.contains_key(&key) && candidates.len() < 20 {
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
            self.search.post(&format!("/{MESSAGES}/_mget?_source_includes=id,revision,type,originator,subject,status,review_flags,issued_at,expires_at,command_ids,security"),json!({"ids":candidates.iter().map(|(id,r,_)|format!("{id}:{r}")).collect::<Vec<_>>()})).await?
        };
        let docs = hydrated["docs"].as_array().ok_or_else(Error::unavailable)?;
        let mut messages = Vec::new();
        let mut stale = 0;
        {
            let store = self.store()?;
            for ((id, revision, _), doc) in candidates.iter().zip(docs) {
                if doc["found"] != true
                    || doc["_source"]["id"] != *id
                    || doc["_source"]["revision"] != *revision
                    || !request.filters.matches(&doc["_source"])?
                {
                    stale += 1;
                    continue;
                }
                messages.push(presentation::message(
                    &doc["_source"],
                    &store,
                    false,
                    None,
                    None,
                )?);
            }
        }
        Ok(envelope(
            messages,
            "Ranked message results from a bounded passage candidate window; no complete result count is claimed",
            json!({"dataset":"canonical","requestedMode":mode,"executedMode":mode,"limit":20,"candidateLimit":100,"windowLimited":hits.len()>=100,"staleHitsDropped":stale,"matchedExcerpts":excerpts,"tookMs":response["took"]}),
        ))
    }
    pub async fn detail(&self, key: &str) -> Result<Value> {
        let (id, revision) = split_key(key)?;
        let core = self.search.canonical(id, revision).await?;
        let audits = self
            .audit_records(
                id,
                revision,
                Some(vec!["source_preserved", "email_received"]),
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
        let record = presentation::message(&core, &*self.store()?, true, raw, received)?;
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
    async fn timeline(&self, request: ReadRequest, filters: Value) -> Result<Value> {
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
        if !request.query.trim().is_empty() {
            let search_request = ReadRequest {
                query: request.query.clone(),
                mode: request.mode.clone(),
                filters: request.filters.clone(),
                ..ReadRequest::default()
            };
            let results = self
                .search_messages(search_request, filters.clone())
                .await?;
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
                "parse-command-timeline-v1",
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
                let (mut dated, mut unresolved) = presentation::timeline(core, &from, &to)?;
                items.append(&mut dated);
                review.append(&mut unresolved);
                messages.push(presentation::message(core, &store, false, None, None)?);
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
            json!({"dataset":"canonical","timelineItems":items,"reviewItems":review,"from":from,"to":to,"windowLimited":hits.len()>100||search_limited,"messageLimit":100}),
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
        let jobs = journal_counts(&self.config.intake.journal)?;
        Ok(
            json!({"source":"opensearch","cluster":health["status"],"publicationReady":self.status.ready.load(Ordering::Relaxed),"modelReady":self.status.model.load(Ordering::Relaxed),"publication":jobs,"embeddings":embeddings["aggregations"]["embedding_states"]["buckets"],"observedAt":now()}),
        )
    }
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
}
pub fn role_identity(role: &str) -> Result<Identity> {
    match role {
        "user" => Ok(Identity {
            username: "dev-user".into(),
            email: "dev@localhost".into(),
            groups: vec![],
            role: role.into(),
        }),
        "platform_admin" => Ok(Identity {
            username: "dev-admin".into(),
            email: "admin@localhost".into(),
            groups: vec!["/platform-admin".into()],
            role: role.into(),
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
    pub classifications: Vec<String>,
    pub issued_from: Option<String>,
    pub issued_to: Option<String>,
    pub unassigned_only: bool,
    pub no_commands: bool,
}
impl Filters {
    pub fn validate(&self) -> Result<Value> {
        let mut filters = Vec::new();
        for (name, values) in [
            ("command_ids", &self.command_ids),
            ("type", &self.message_types),
            ("security.classification", &self.classifications),
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
        if !self.classifications.is_empty()
            && !self
                .classifications
                .iter()
                .any(|t| core["security"]["classification"] == *t)
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
    let owner = app.headers_identity(&headers)?;
    if request.query.len() > 240 {
        return Err(Error::invalid("Query exceeds 240 bytes"));
    }
    let value = tokio::time::timeout(
        Duration::from_secs(7),
        app.execute(&op, request, &owner.username),
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
    app.headers_identity(&headers)?;
    Ok(Json(app.source_status().await?))
}
