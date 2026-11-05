//! Metadata suggestions verify byte spans against preserved source audits.
use crate::{
    Error, Result,
    private::{text, timestamp},
};
use parse_command_state::Store;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Citation {
    pub message_key: String,
    pub audit_id: String,
    pub set_id: String,
    pub recorded_at: String,
    pub start_byte: u64,
    pub end_byte: u64,
    pub line_start: u64,
    pub line_end: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub id: String,
    pub field: &'static str,
    pub values: Vec<String>,
    pub sources: Vec<Citation>,
}
#[derive(Default)]
pub struct Metadata {
    pub suggestions: Vec<Suggestion>,
    pub limited: bool,
}
pub async fn read_scoped(store: &Store, scope: &crate::station::ResolvedScope) -> Result<Metadata> {
    let rows = store
        .list(
            "projection",
            vec![json!({"term":{"state":"published"}})],
            201,
        )
        .await?;
    let mut metadata = Metadata {
        suggestions: Vec::new(),
        limited: rows.len() > 200,
    };
    let mut groups: BTreeMap<String, Suggestion> = BTreeMap::new();
    let mut count = 0;
    for doc in rows.into_iter().take(200) {
        let core = &doc.record.payload["core"];
        if !scope.matches(core)? {
            continue;
        }
        let audits = doc.record.payload["audits"]
            .as_array()
            .ok_or_else(Error::unavailable)?;
        let raw = audits
            .iter()
            .find(|a| a["kind"] == "source_preserved")
            .and_then(|a| a["payload"]["source"]["raw_text"].as_str())
            .unwrap_or("");
        if format!("sha256:{:x}", Sha256::digest(raw.as_bytes())) != text(core, "id") {
            continue;
        }
        for audit in audits.iter().filter(|a| {
            a["kind"] == "parse_completed"
                && matches!(
                    a["payload"]["profile"].as_str(),
                    Some("usmtf-2003-subset-v1" | "observed-optask-extensions-v1")
                )
        }) {
            for record in audit["payload"]["records"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|r| matches!(r["set_id"].as_str(), Some("EXER" | "OPER")))
            {
                for field in record["fields"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|f| f["position"] == 1)
                {
                    let (Some(start), Some(end)) =
                        (field["start_byte"].as_u64(), field["end_byte"].as_u64())
                    else {
                        continue;
                    };
                    let value = text(field, "raw_text");
                    if start >= end
                        || raw.get(start as usize..end as usize) != Some(value)
                        || value.len() > 128
                    {
                        continue;
                    }
                    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
                    if value.is_empty() || value == "-" {
                        continue;
                    }
                    count += 1;
                    if count > 400 {
                        metadata.limited = true;
                        break;
                    }
                    let group = groups.entry(value.clone()).or_insert_with(|| Suggestion {
                        id: format!(
                            "context:{:x}",
                            Sha256::digest(format!("operationName\0{value}").as_bytes())
                        ),
                        field: "operationName",
                        values: vec![value],
                        sources: Vec::new(),
                    });
                    if group.sources.len() >= 20 {
                        metadata.limited = true;
                        continue;
                    }
                    group.sources.push(Citation {
                        message_key: format!("{}@{}", text(core, "id"), text(core, "revision")),
                        audit_id: text(audit, "id").into(),
                        set_id: text(record, "set_id").into(),
                        recorded_at: timestamp(text(audit, "recorded_at"))?,
                        start_byte: start,
                        end_byte: end,
                        line_start: 1 + raw.as_bytes()[..start as usize]
                            .iter()
                            .filter(|&&b| b == b'\n')
                            .count() as u64,
                        line_end: 1 + raw.as_bytes()[..end as usize - 1]
                            .iter()
                            .filter(|&&b| b == b'\n')
                            .count() as u64,
                    });
                }
            }
        }
    }
    metadata.limited |= groups.len() > 20;
    metadata.suggestions = groups.into_values().take(20).collect();
    Ok(metadata)
}
