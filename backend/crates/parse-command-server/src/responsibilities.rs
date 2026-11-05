//! Explicit department/watch metadata never grants authentication privileges.
use crate::{Error, Result};
use parse_command_state::Store;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub message_types: Vec<String>,
}
pub async fn resolve(store: &Store, ids: &[String]) -> Result<Vec<Profile>> {
    let mut result = Vec::new();
    for id in ids.iter().collect::<BTreeSet<_>>() {
        let d=store.get("responsibility",id).await?.ok_or_else(||Error::config("A selected department or watch profile is unavailable; update your account settings"))?;
        result.push(serde_json::from_value(d.record.payload).map_err(|_| Error::unavailable())?);
    }
    Ok(result)
}
