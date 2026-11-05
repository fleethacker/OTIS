use crate::{Error, Result};
use serde_json::{Value, json};
use std::time::Duration;
pub const MESSAGES: &str = "parse-command-messages-v1";
pub const MESSAGE_ALIAS: &str = "parse-command-messages";
pub const PASSAGES: &str = "parse-command-search-passages-minilm-v1";
pub const AUDIT: &str = "parse-command-intake-test-audit-v1";
pub const INGEST: &str = "parse-command-embed-minilm-v1";
pub const MODEL_HASH: &str = "61ebca09b70c3061726fcd439dde0ad64ede6c5698cb30b594cb11b02603d64b";
pub const MAX_RESPONSE: usize = 4_194_304;
#[derive(Clone)]
pub struct Search {
    pub base: String,
    client: reqwest::Client,
}
impl Search {
    pub fn new(base: String) -> Result<Self> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(8))
            .pool_max_idle_per_host(2)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .build()
            .map_err(|_| Error::unavailable())?;
        Ok(Self { base, client })
    }
    pub async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value> {
        let mut request = self.client.request(method, format!("{}{path}", self.base));
        if let Some(body) = body {
            request = request.json(&body);
        }
        let mut response = request.send().await.map_err(|_| Error::unavailable())?;
        let status = response.status();
        if status.as_u16() == 404 {
            return Err(Error::new("not_found", "Source or index not found"));
        }
        if !status.is_success() {
            return Err(Error::unavailable());
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_RESPONSE as u64)
        {
            return Err(Error::new(
                "resource_exhausted",
                "Search response exceeds the configured bound",
            ));
        }
        let mut data = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Error::unavailable())? {
            if data.len().saturating_add(chunk.len()) > MAX_RESPONSE {
                return Err(Error::new(
                    "resource_exhausted",
                    "Search response exceeds the configured bound",
                ));
            }
            data.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&data).map_err(|_| Error::unavailable())
    }
    pub async fn get(&self, path: &str) -> Result<Value> {
        self.request(reqwest::Method::GET, path, None).await
    }
    pub async fn post(&self, path: &str, body: Value) -> Result<Value> {
        self.request(reqwest::Method::POST, path, Some(body)).await
    }
    pub async fn template(
        &self,
        index: &str,
        id: &str,
        params: Value,
        hybrid: bool,
    ) -> Result<Value> {
        let suffix = if hybrid {
            "&search_pipeline=parse-command-hybrid-rrf-v1"
        } else {
            ""
        };
        let result = self
            .post(
                &format!(
                    "{}/_search/template?allow_partial_search_results=false{suffix}",
                    if index.is_empty() {
                        String::new()
                    } else {
                        format!("/{index}")
                    }
                ),
                json!({"id":id,"params":params}),
            )
            .await?;
        if result["timed_out"] == true || result["_shards"]["failed"].as_u64().unwrap_or(1) > 0 {
            return Err(Error::unavailable());
        }
        Ok(result)
    }
    pub async fn canonical(&self, id: &str, revision: &str) -> Result<Value> {
        validate_key(id, revision)?;
        let result = self
            .template(
                MESSAGE_ALIAS,
                "parse-command-message-detail-v1",
                json!({"message_id":id,"revision":revision}),
                false,
            )
            .await?;
        let hits = result["hits"]["hits"]
            .as_array()
            .ok_or_else(Error::unavailable)?;
        if hits.len() != 1 {
            return Err(Error::new("not_found", "Message revision is unavailable"));
        }
        Ok(hits[0]["_source"].clone())
    }
}
pub fn validate_key(id: &str, revision: &str) -> Result<()> {
    if id.len() != 71
        || !id.starts_with("sha256:")
        || !id[7..]
            .bytes()
            .all(|x| x.is_ascii_hexdigit() && !x.is_ascii_uppercase())
        || parse_command_types::validate_revision(revision, "revision").is_err()
    {
        return Err(Error::invalid("Exact message ID and revision are required"));
    }
    Ok(())
}
pub fn split_key(key: &str) -> Result<(&str, &str)> {
    let (id, revision) = key
        .split_once('@')
        .ok_or_else(|| Error::invalid("A versioned message key is required"))?;
    validate_key(id, revision)?;
    Ok((id, revision))
}
