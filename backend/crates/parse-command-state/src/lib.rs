//! Bounded, explicit access to hidden OpenSearch application state.
//! A document is the transaction boundary; callers use CAS for read/modify/write.
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{future::Future, time::Duration};

pub const MAX_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_HITS: usize = 1000;
pub const DEFAULT_INDEX: &str = ".parse-command-state-v1";
pub type Result<T> = std::result::Result<T, Error>;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(pub &'static str);
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for Error {}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub kind: String,
    pub key: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub flags: Vec<String>,
    #[serde(default)]
    pub order: i64,
    #[serde(default)]
    pub expires: i64,
    #[serde(default)]
    pub available: i64,
    #[serde(default)]
    pub bytes: u64,
    pub payload: Value,
}
impl Record {
    pub fn new(kind: &str, key: &str, payload: Value) -> Self {
        Self {
            kind: kind.into(),
            key: key.into(),
            owner: String::new(),
            source: String::new(),
            state: String::new(),
            category: String::new(),
            flags: Vec::new(),
            order: 0,
            expires: 0,
            available: 0,
            bytes: 0,
            payload,
        }
    }
    pub fn id(&self) -> String {
        id(&self.kind, &self.key)
    }
}
pub fn id(kind: &str, key: &str) -> String {
    format!("{:x}", Sha256::digest(format!("{kind}\0{key}")))
}
pub fn epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
#[derive(Clone, Debug)]
pub struct Document {
    pub record: Record,
    pub seq: i64,
    pub term: i64,
}
#[derive(Clone)]
pub struct Store {
    client: reqwest::Client,
    endpoint: String,
    index: String,
}
impl Store {
    pub fn new(endpoint: &str, index: &str) -> Result<Self> {
        let url = reqwest::Url::parse(endpoint).map_err(|_| Error("state_endpoint"))?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
        {
            return Err(Error("state_endpoint"));
        }
        if !index.starts_with(".parse-command-")
            || index.len() > 120
            || !index
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
        {
            return Err(Error("state_index"));
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(8))
            .pool_max_idle_per_host(2)
            .build()
            .map_err(|_| Error("state_client"))?;
        Ok(Self {
            client,
            endpoint: endpoint.trim_end_matches('/').into(),
            index: index.into(),
        })
    }
    pub fn index(&self) -> &str {
        &self.index
    }
    pub async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<(StatusCode, Value)> {
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.endpoint));
        if let Some(body) = body {
            let bytes = serde_json::to_vec(&body).map_err(|_| Error("state_json"))?;
            if bytes.len() > MAX_BYTES {
                return Err(Error("state_size"));
            }
            request = request
                .header("content-type", "application/json")
                .body(bytes);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| Error("state_unavailable"))?;
        let status = response.status();
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| Error("state_unavailable"))?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_BYTES {
                return Err(Error("state_response_bound"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value = serde_json::from_slice(&bytes).map_err(|_| Error("state_response"))?;
        Ok((status, value))
    }
    pub async fn provision(&self) -> Result<()> {
        let (status, current) = self
            .request(Method::GET, &format!("/{}", self.index), None)
            .await?;
        if status == StatusCode::NOT_FOUND {
            let definition: Value = serde_json::from_str(include_str!("../state-index.json"))
                .map_err(|_| Error("state_definition"))?;
            let (status, value) = self
                .request(Method::PUT, &format!("/{}", self.index), Some(definition))
                .await?;
            if !status.is_success() && value["error"]["type"] != "resource_already_exists_exception"
            {
                return Err(Error("state_provision"));
            }
            // Verify even after a competing bootstrap; never silently adopt another schema.
            let (status, current) = self
                .request(Method::GET, &format!("/{}", self.index), None)
                .await?;
            self.verify(status, &current)?;
            return self.ready().await;
        }
        self.verify(status, &current)?;
        self.ready().await
    }
    async fn ready(&self) -> Result<()> {
        let (status,value)=self.request(Method::GET,&format!("/_cluster/health/{}?wait_for_status=yellow&wait_for_active_shards=1&timeout=5s",self.index),None).await?;
        if !status.is_success()
            || value["timed_out"] != false
            || value["active_primary_shards"].as_u64().unwrap_or(0) < 1
        {
            return Err(Error("state_not_ready"));
        }
        Ok(())
    }
    fn verify(&self, status: StatusCode, current: &Value) -> Result<()> {
        let index = &current[&self.index];
        let expected: Value = serde_json::from_str(include_str!("../state-index.json"))
            .map_err(|_| Error("state_definition"))?;
        if !status.is_success()
            || index["settings"]["index"]["hidden"] != "true"
            || index["mappings"]["_meta"]["parse_command_state_version"] != 1
            || index["mappings"] != expected["mappings"]
        {
            return Err(Error("state_schema"));
        }
        Ok(())
    }
    pub async fn get(&self, kind: &str, key: &str) -> Result<Option<Document>> {
        let (status, value) = self
            .request(
                Method::GET,
                &format!("/{}/_doc/{}", self.index, id(kind, key)),
                None,
            )
            .await?;
        if status == StatusCode::NOT_FOUND && value["found"] == false {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(Error("state_read"));
        }
        let doc = document(&value)?;
        if doc.record.kind != kind || doc.record.key != key {
            return Err(Error("state_identity"));
        }
        Ok(Some(doc))
    }
    pub async fn put(&self, record: &Record, previous: Option<&Document>) -> Result<Document> {
        if record.kind.is_empty()
            || record.kind.len() > 64
            || record.key.len() > 4096
            || [&record.owner, &record.source, &record.category]
                .iter()
                .any(|s| s.len() > 2048)
        {
            return Err(Error("state_identity"));
        }
        let condition = if let Some(old) = previous {
            if old.record.id() != record.id() {
                return Err(Error("state_identity"));
            }
            format!("if_seq_no={}&if_primary_term={}", old.seq, old.term)
        } else {
            "op_type=create".into()
        };
        let (status, value) = self
            .request(
                Method::PUT,
                &format!("/{}/_doc/{}?{condition}", self.index, record.id()),
                Some(serde_json::to_value(record).map_err(|_| Error("state_json"))?),
            )
            .await?;
        if status == StatusCode::CONFLICT {
            return Err(Error("state_conflict"));
        }
        if !status.is_success() || value["_shards"]["failed"].as_u64() != Some(0) {
            return Err(Error("state_write"));
        }
        Ok(Document {
            record: record.clone(),
            seq: value["_seq_no"].as_i64().ok_or(Error("state_response"))?,
            term: value["_primary_term"]
                .as_i64()
                .ok_or(Error("state_response"))?,
        })
    }
    pub async fn update<F>(&self, kind: &str, key: &str, mut change: F) -> Result<Document>
    where
        F: FnMut(Option<&Record>) -> Result<Record>,
    {
        for _ in 0..5 {
            let previous = self.get(kind, key).await?;
            let record = change(previous.as_ref().map(|d| &d.record))?;
            if record.kind != kind || record.key != key {
                return Err(Error("state_identity"));
            }
            match self.put(&record, previous.as_ref()).await {
                Err(Error("state_conflict")) => continue,
                result => return result,
            }
        }
        Err(Error("state_conflict"))
    }
    pub async fn delete(&self, document: &Document) -> Result<()> {
        let (status, _) = self
            .request(
                Method::DELETE,
                &format!(
                    "/{}/_doc/{}?if_seq_no={}&if_primary_term={}",
                    self.index,
                    document.record.id(),
                    document.seq,
                    document.term
                ),
                None,
            )
            .await?;
        if status == StatusCode::CONFLICT {
            return Err(Error("state_conflict"));
        }
        if !status.is_success() && status != StatusCode::NOT_FOUND {
            return Err(Error("state_delete"));
        }
        Ok(())
    }
    pub async fn search(&self, mut body: Value) -> Result<Value> {
        if body["size"].as_u64().is_none_or(|n| n > MAX_HITS as u64) {
            return Err(Error("state_query_bound"));
        }
        body["timeout"] = json!("5s");
        body["seq_no_primary_term"] = json!(true);
        let (status, value) = self
            .request(
                Method::POST,
                &format!("/{}/_search", self.index),
                Some(body),
            )
            .await?;
        if !status.is_success()
            || value["timed_out"] != false
            || value["_shards"]["failed"].as_u64() != Some(0)
        {
            return Err(Error("state_search"));
        }
        Ok(value)
    }
    pub async fn list(
        &self,
        kind: &str,
        filters: Vec<Value>,
        size: usize,
    ) -> Result<Vec<Document>> {
        let mut filters = filters;
        filters.push(json!({"term":{"kind":kind}}));
        let value = self
            .search(json!({"size":size,"query":{"bool":{"filter":filters}},"sort":["order","key"]}))
            .await?;
        hits(&value)
    }
    pub async fn refresh(&self) -> Result<()> {
        let (status, value) = self
            .request(Method::POST, &format!("/{}/_refresh", self.index), None)
            .await?;
        if !status.is_success() || value["_shards"]["failed"].as_u64() != Some(0) {
            return Err(Error("state_refresh"));
        }
        Ok(())
    }
    pub async fn next(&self, name: &str) -> Result<i64> {
        let doc = self
            .update("counter", name, |old| {
                let n = old
                    .map(|r| r.order)
                    .unwrap_or(0)
                    .checked_add(1)
                    .ok_or(Error("state_sequence"))?;
                let mut row = Record::new("counter", name, json!({}));
                row.order = n;
                Ok(row)
            })
            .await?;
        Ok(doc.record.order)
    }
    pub async fn reserve(&self, name: &str, key: &str, expires: i64, limit: usize) -> Result<()> {
        self.update("quota", name, |old| {
            let mut row = old
                .cloned()
                .unwrap_or_else(|| Record::new("quota", name, json!({})));
            let leases = row.payload.as_object_mut().ok_or(Error("state_record"))?;
            leases.retain(|_, until| until.as_i64().is_some_and(|n| n > epoch()));
            if !leases.contains_key(key) && leases.len() >= limit {
                return Err(Error("state_capacity"));
            }
            leases.insert(key.into(), json!(expires));
            Ok(row)
        })
        .await?;
        Ok(())
    }
    pub async fn cleanup(&self) -> Result<usize> {
        let value = self.search(json!({"size":128,"query":{"bool":{"filter":[{"range":{"expires":{"gt":0,"lte":epoch()}}}]}},"sort":["expires","key"]})).await?;
        let docs = hits(&value)?;
        for doc in &docs {
            match self.delete(doc).await {
                Ok(()) | Err(Error("state_conflict")) => {}
                Err(error) => return Err(error),
            }
        }
        Ok(docs.len())
    }
    pub async fn release(&self, name: &str, key: &str) -> Result<()> {
        self.update("quota", name, |old| {
            let mut row = old
                .cloned()
                .unwrap_or_else(|| Record::new("quota", name, json!({})));
            row.payload
                .as_object_mut()
                .ok_or(Error("state_record"))?
                .remove(key);
            Ok(row)
        })
        .await?;
        Ok(())
    }
}
pub fn hits(value: &Value) -> Result<Vec<Document>> {
    value["hits"]["hits"]
        .as_array()
        .ok_or(Error("state_response"))?
        .iter()
        .map(document)
        .collect()
}
fn document(value: &Value) -> Result<Document> {
    Ok(Document {
        record: serde_json::from_value(value["_source"].clone())
            .map_err(|_| Error("state_record"))?,
        seq: value["_seq_no"].as_i64().ok_or(Error("state_response"))?,
        term: value["_primary_term"]
            .as_i64()
            .ok_or(Error("state_response"))?,
    })
}
/// Dedicated current-thread runtime for synchronous intake/publication threads only.
pub struct BlockingStore {
    pub store: Store,
    runtime: tokio::runtime::Runtime,
}
impl BlockingStore {
    pub fn new(endpoint: &str, index: &str) -> Result<Self> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| Error("state_runtime"))?;
        let store = Store::new(endpoint, index)?;
        Ok(Self { store, runtime })
    }
    pub fn run<F: Future>(&self, future: F) -> F::Output {
        self.runtime.block_on(future)
    }
    pub fn provision(&self) -> Result<()> {
        self.run(self.store.provision())
    }
    pub fn get(&self, kind: &str, key: &str) -> Result<Option<Document>> {
        self.run(self.store.get(kind, key))
    }
    pub fn put(&self, row: &Record, old: Option<&Document>) -> Result<Document> {
        self.run(self.store.put(row, old))
    }
    pub fn update<F>(&self, kind: &str, key: &str, change: F) -> Result<Document>
    where
        F: FnMut(Option<&Record>) -> Result<Record>,
    {
        self.run(self.store.update(kind, key, change))
    }
    pub fn list(&self, kind: &str, filters: Vec<Value>, size: usize) -> Result<Vec<Document>> {
        self.run(self.store.list(kind, filters, size))
    }
    pub fn search(&self, body: Value) -> Result<Value> {
        self.run(self.store.search(body))
    }
    pub fn refresh(&self) -> Result<()> {
        self.run(self.store.refresh())
    }
    pub fn next(&self, name: &str) -> Result<i64> {
        self.run(self.store.next(name))
    }
}
