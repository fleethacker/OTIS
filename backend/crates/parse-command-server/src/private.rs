use crate::{Error, Result};
use parse_command_state::{Record, Store, epoch};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::Read,
    sync::{Arc, Mutex},
};
#[derive(Clone)]
pub struct Private {
    pub state: Store,
    ids: Arc<Mutex<HashMap<String, i64>>>,
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

pub fn random_token() -> Result<String> {
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
pub fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token))
}
pub fn owned_key(owner: &str, key: &str) -> String {
    format!("{owner}\0{key}")
}
impl Private {
    pub fn new(state: Store) -> Self {
        Self {
            state,
            ids: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    // Explicit local-demo sessions only. The OIDC session path follows IdP limits.
    pub async fn create_session(&self, role: &str) -> Result<String> {
        let identity = crate::api::role_identity(role)?;
        crate::settings::ensure_demo_user(&self.state, &identity).await?;
        let user = self
            .state
            .get("user", &identity.owner)
            .await?
            .ok_or_else(Error::unavailable)?;
        let token = random_token()?;
        let key = token_hash(&token);
        let expires = epoch() + 43200;
        self.state
            .reserve("demo_sessions", &key, expires, 256)
            .await?;
        let mut row = Record::new(
            "demo_session",
            &key,
            json!({"role":role,"user_epoch":user.record.payload["epoch"]}),
        );
        row.owner = identity.owner;
        row.expires = expires;
        self.state.put(&row, None).await?;
        Ok(token)
    }
    pub async fn session(&self, token: &str) -> Result<Option<String>> {
        if token.len() != 64 {
            return Ok(None);
        }
        let Some(doc) = self
            .state
            .get("demo_session", &token_hash(token))
            .await?
            .filter(|d| d.record.expires > epoch())
        else {
            return Ok(None);
        };
        let Some(user) = self.state.get("user", &doc.record.owner).await? else {
            return Ok(None);
        };
        if user.record.payload["enabled"] != true
            || user.record.payload["epoch"] != doc.record.payload["user_epoch"]
        {
            return Ok(None);
        }
        Ok(doc.record.payload["role"].as_str().map(str::to_owned))
    }
    pub async fn logout(&self, token: &str) -> Result<()> {
        if let Some(doc) = self.state.get("demo_session", &token_hash(token)).await? {
            self.state.delete(&doc).await?;
        }
        self.state
            .release("demo_sessions", &token_hash(token))
            .await?;
        Ok(())
    }
    pub async fn id(&self, key: &str) -> Result<i64> {
        if let Some(id) = self
            .ids
            .lock()
            .map_err(|_| Error::unavailable())?
            .get(key)
            .copied()
        {
            return Ok(id);
        }
        let doc = if let Some(doc) = self.state.get("identity", key).await? {
            doc
        } else {
            let sequence = self.state.next("identities").await?;
            self.state
                .update("identity", key, |old| {
                    if let Some(old) = old {
                        return Ok(old.clone());
                    }
                    let mut row = Record::new("identity", key, json!({}));
                    row.order = sequence;
                    Ok(row)
                })
                .await?
        };
        let mut cache = self.ids.lock().map_err(|_| Error::unavailable())?;
        if cache.len() >= 2048 {
            cache.clear();
        }
        cache.insert(key.into(), doc.record.order);
        Ok(doc.record.order)
    }
    pub async fn draft(&self, owner: &str, key: &str) -> Result<Value> {
        let Some(doc) = self.state.get("draft", &owned_key(owner, key)).await? else {
            return Ok(json!({}));
        };
        if doc.record.owner != owner || doc.record.source != key {
            return Err(Error::unavailable());
        }
        Ok(
            json!({"draft":{"id":doc.record.order.to_string(),"messageId":self.id(key).await?.to_string(),"text":doc.record.payload["text"],"status":"unsent","savedAt":doc.record.payload["saved_at"]}}),
        )
    }
    pub async fn save_draft(&self, owner: &str, key: &str, text: &str) -> Result<Value> {
        if text.len() > 65536 {
            return Err(Error::invalid("Draft exceeds 65536 UTF-8 bytes"));
        }
        let id = self.id(&format!("draft:{}", owned_key(owner, key))).await?;
        self.state
            .update("draft", &owned_key(owner, key), |_| {
                let mut row = Record::new(
                    "draft",
                    &owned_key(owner, key),
                    json!({"text":text,"saved_at":now()}),
                );
                row.owner = owner.into();
                row.source = key.into();
                row.order = id;
                Ok(row)
            })
            .await?;
        self.draft(owner, key).await
    }
    pub async fn preparation(&self, owner: &str, key: &str) -> Result<Value> {
        let doc = self
            .state
            .get("preparation", &owned_key(owner, key))
            .await?;
        let row = doc.as_ref().map(|d| &d.record.payload);
        let history = row
            .and_then(|v| v["history"].as_array())
            .cloned()
            .unwrap_or_default();
        let history = &history[history.len().saturating_sub(100)..];
        Ok(
            json!({"fieldsJson":row.and_then(|v|v["fields_json"].as_str()).unwrap_or("{}"),"generatedText":row.and_then(|v|v["generated_text"].as_str()).unwrap_or(""),"acknowledged":row.and_then(|v|v["acknowledged"].as_bool()).unwrap_or(false),"historyJson":serde_json::to_string(history).map_err(|_|Error::unavailable())?}),
        )
    }
    pub async fn save_preparation(
        &self,
        owner: &str,
        key: &str,
        raw: &str,
        generate: bool,
    ) -> Result<Value> {
        let (fields, text) = crate::preparation::prepare(raw, generate)?;
        let event = json!({"id":random_token()?,"kind":if generate {"generated"} else {"saved"},"recorder":owner,"recorded_at":now(),"occurred_at":null,"note":"","provenance":"user-reported"});
        self.state
            .update("preparation", &owned_key(owner, key), |old| {
                let mut row = old.cloned().unwrap_or_else(|| {
                    Record::new("preparation", &owned_key(owner, key), json!({"history":[]}))
                });
                row.owner = owner.into();
                row.source = key.into();
                row.payload["fields_json"] = json!(fields);
                row.payload["generated_text"] = json!(text);
                let events = row.payload["history"]
                    .as_array_mut()
                    .ok_or(parse_command_state::Error("state_record"))?;
                if events.len() >= 10000 {
                    return Err(parse_command_state::Error("state_capacity"));
                }
                events.push(event.clone());
                Ok(row)
            })
            .await?;
        self.preparation(owner, key).await
    }
    pub async fn acknowledge(
        &self,
        _owner: &str,
        _key: &str,
        _ack: bool,
        _confirmed: bool,
        _note: &str,
        _occurred: &str,
    ) -> Result<Value> {
        Err(Error::config("Acknowledgement sending is not configured"))
    }
    pub async fn put_read_window(&self, fingerprint: &str, value: &Value) -> Result<String> {
        if value.to_string().len() > 524288 {
            return Err(Error::new(
                "resource_exhausted",
                "Result window exceeds configured bound",
            ));
        }
        let id = random_token()?;
        let expires = epoch() + 110;
        self.state.reserve("read_windows", &id, expires, 64).await?;
        let mut row = Record::new(
            "read_window",
            &id,
            json!({"fingerprint":fingerprint,"value":value}),
        );
        row.expires = expires;
        self.state.put(&row, None).await?;
        Ok(id)
    }
    pub async fn read_window(&self, id: &str, fingerprint: &str) -> Result<Value> {
        let doc = self
            .state
            .get("read_window", id)
            .await?
            .ok_or_else(|| Error::invalid("Results expired; refresh the search"))?;
        if doc.record.expires <= epoch() || doc.record.payload["fingerprint"] != fingerprint {
            return Err(Error::invalid(
                "Results expired or changed; refresh the search",
            ));
        }
        let value = doc.record.payload["value"].clone();
        self.state
            .reserve("read_windows", id, epoch() + 110, 64)
            .await?;
        self.state
            .update("read_window", id, |old| {
                let mut row = old
                    .cloned()
                    .ok_or(parse_command_state::Error("state_record"))?;
                if row.expires <= epoch() || row.payload["fingerprint"] != fingerprint {
                    return Err(parse_command_state::Error("state_record"));
                }
                row.expires = epoch() + 110;
                Ok(row)
            })
            .await?;
        Ok(value)
    }
    pub async fn save_read_window(&self, id: &str, fingerprint: &str, value: &Value) -> Result<()> {
        if value.to_string().len() > 524288 {
            return Err(Error::new(
                "resource_exhausted",
                "Result window exceeds configured bound",
            ));
        }
        self.state
            .reserve("read_windows", id, epoch() + 110, 64)
            .await?;
        self.state
            .update("read_window", id, |old| {
                let mut row = old
                    .cloned()
                    .ok_or(parse_command_state::Error("state_record"))?;
                if row.expires <= epoch() || row.payload["fingerprint"] != fingerprint {
                    return Err(parse_command_state::Error("state_record"));
                }
                row.expires = epoch() + 110;
                row.payload["value"] = value.clone();
                Ok(row)
            })
            .await?;
        Ok(())
    }
    pub async fn cursor(&self, pit: &str, after: &Value, fingerprint: &str) -> Result<String> {
        self.put_read_window(fingerprint, &json!({"pit":pit,"after":after}))
            .await
    }
    pub async fn legacy(&self, key: &str) -> Result<Value> {
        Ok(self
            .state
            .get("legacy_message", key)
            .await?
            .ok_or_else(|| Error::new("not_found", "Legacy record unavailable"))?
            .record
            .payload)
    }
    pub async fn legacy_list(&self) -> Result<Vec<Value>> {
        Ok(self
            .state
            .list("legacy_message", vec![], 100)
            .await?
            .into_iter()
            .map(|d| d.record.payload)
            .collect())
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
