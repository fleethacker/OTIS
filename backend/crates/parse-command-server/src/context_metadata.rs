//! Bounded, metadata-only suggestions from published scanner evidence in custody.
//! Reads published custody projections; byte spans are verified against the preserved
//! source and only line bounds leave this module, never raw bodies.
use crate::{Error, Result, private::timestamp};
use serde_json::json;
use serde::{Deserialize, Serialize};
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
const PROFILES: [&str; 2] = ["usmtf-2003-subset-v1", "observed-optask-extensions-v1"];
/// Bounded custody read: the 200 most recently received published projections.
pub async fn read(store: &parse_command_state::Store) -> Result<Metadata> {
    let value = store.search(json!({"size":201,"query":{"bool":{"filter":[{"term":{"kind":"projection"}},{"term":{"state":"published"}}]}},
        "sort":[{"order":"desc"},"key"]})).await?;
    let docs = parse_command_state::hits(&value)?;
    from_projections(&docs)
}
fn line(raw: &[u8], end: usize) -> u64 {
    1 + raw[..end].iter().filter(|b| **b == b'\n').count() as u64
}
/// Only EXER/OPER first fields from supported profiles, matched byte-for-byte to the
/// same revision's source-preserved audit. No participant/originator candidates.
pub fn from_projections(docs: &[parse_command_state::Document]) -> Result<Metadata> {
    let mut rows: Vec<_> = docs.iter().filter(|d| d.record.kind == "projection" && d.record.state == "published").collect();
    rows.sort_by(|a, b| b.record.order.cmp(&a.record.order).then(a.record.key.cmp(&b.record.key)));
    let mut limited = rows.len() > 200;
    rows.truncate(200);
    let mut fields = Vec::new();
    for doc in rows {
        let core = &doc.record.payload["core"];
        let (Some(id), Some(revision)) = (core["id"].as_str(), core["revision"].as_str()) else { continue };
        let Some(audits) = doc.record.payload["audits"].as_array() else { continue };
        let Some(raw) = audits.iter().find(|a| a["kind"] == "source_preserved"
            && a["payload"]["source"]["sha256"].as_str() == id.strip_prefix("sha256:"))
            .and_then(|a| a["payload"]["source"]["raw_text"].as_str()) else { continue };
        let raw = raw.as_bytes();
        for audit in audits.iter().filter(|a| a["kind"] == "parse_completed"
            && a["payload"]["profile"].as_str().is_some_and(|p| PROFILES.contains(&p))) {
            let (Some(audit_id), Some(recorded)) = (audit["id"].as_str(), audit["recorded_at"].as_str()) else { continue };
            for record in audit["payload"]["records"].as_array().into_iter().flatten() {
                let Some(set) = record["set_id"].as_str().filter(|s| matches!(*s, "EXER" | "OPER")) else { continue };
                for field in record["fields"].as_array().into_iter().flatten().filter(|f| f["position"] == 1) {
                    let (Some(first), Some(last), Some(value)) = (field["start_byte"].as_u64(), field["end_byte"].as_u64(), field["raw_text"].as_str()) else { continue };
                    let (Ok(first), Ok(last)) = (usize::try_from(first), usize::try_from(last)) else { continue };
                    if last <= first || last > raw.len() || raw[first..last] != *value.as_bytes() || !(1..=128).contains(&value.chars().count()) { continue; }
                    fields.push((id, revision, audit_id, recorded, set, value, first, last, line(raw, first), line(raw, last - 1)));
                }
            }
        }
    }
    fields.sort_by(|a, b| b.3.cmp(a.3).then(a.0.cmp(b.0)).then(a.6.cmp(&b.6)));
    let mut groups: BTreeMap<String, Suggestion> = BTreeMap::new();
    for (index, record) in fields.into_iter().enumerate() {
        if index == 400 { limited = true; break; }
        let (id, revision, audit, recorded, set, raw_value, start, end, line_start, line_end) = record;
        let (start, end) = (start as u64, end as u64);
        let value = raw_value.split_whitespace().collect::<Vec<_>>().join(" ");
        if value.is_empty() || value == "-" || value.len() > 128 { continue; }
        parse_command_types::validate_hash_id(id, "message_id").map_err(|_| Error::unavailable())?;
        parse_command_types::validate_revision(revision, "revision").map_err(|_| Error::unavailable())?;
        parse_command_types::validate_event_id(audit, "audit_id").map_err(|_| Error::unavailable())?;
        let group = groups.entry(value.clone()).or_insert_with(|| Suggestion {
            id: format!("context:{:x}", Sha256::digest(format!("operationName\0{value}").as_bytes())),
            field: "operationName", values: vec![value], sources: Vec::new(),
        });
        if !group.sources.iter().any(|s| s.message_key == format!("{id}@{revision}") && s.start_byte == start) {
            group.sources.push(Citation {
                message_key: format!("{id}@{revision}"), audit_id: audit.into(), set_id: set.into(),
                recorded_at: timestamp(recorded)?, start_byte: start, end_byte: end, line_start, line_end,
            });
        }
    }
    let mut suggestions: Vec<_> = groups.into_values().collect();
    for group in &mut suggestions {
        group.sources.sort_by(|a, b| b.recorded_at.cmp(&a.recorded_at).then(a.message_key.cmp(&b.message_key)));
        limited |= group.sources.len() > 20;
        group.sources.truncate(20);
    }
    suggestions.sort_by(|a, b| b.sources[0].recorded_at.cmp(&a.sources[0].recorded_at).then(a.id.cmp(&b.id)));
    limited |= suggestions.len() > 20;
    suggestions.truncate(20);
    Ok(Metadata { suggestions, limited })
}

#[cfg(test)]
mod tests {
    use super::*;
    use parse_command_state::{Document, Record};
    fn evidence(docs: &mut Vec<Document>, index: usize, corrupt: bool) {
        let raw = format!("MSGID/FICTIONAL É{index}//\nEXER/FICTIONAL COPPER//\nGENTEXT/PRIVATE BODY NEVER RETURNED//");
        let id = parse_command_types::message_id(&raw);
        let start = raw.find("FICTIONAL COPPER").unwrap();
        let field = json!({"position":1,"raw_text":"FICTIONAL COPPER","start_byte":start,"end_byte":start+if corrupt { 1 } else { "FICTIONAL COPPER".len() }});
        let audits: Vec<_> = [
            ("source_preserved", json!({"source":{"raw_text":raw,"sha256":id.trim_start_matches("sha256:")}})),
            ("parse_completed", json!({"profile":"observed-optask-extensions-v1","records":[{"set_id":"EXER","fields":[field],"rows":[]}]})),
        ].into_iter().map(|(kind, payload)| json!({"id":parse_command_types::event_id(&[&id, kind]),"kind":kind,"recorded_at":format!("2026-11-05T{index:02}:00:00Z"),"payload":payload})).collect();
        let mut row = Record::new("projection", &format!("{id}@r1"), json!({"core":{"id":id,"revision":"r1"},"audits":audits}));
        row.state = "published".into();
        row.order = index as i64 + 1;
        docs.push(Document { record: row, seq: 0, term: 1 });
    }
    #[test]
    fn grouped_metadata_verifies_spans_counts_unicode_lines_and_caps_citations() {
        let mut docs = Vec::new();
        evidence(&mut docs, 0, true);
        assert!(from_projections(&docs).unwrap().suggestions.is_empty());
        for index in 1..=21 { evidence(&mut docs, index, false); }
        let mut pending = docs[1].clone();
        pending.record.state = "pending".into();
        pending.record.key = "unpublished".into();
        docs.push(pending);
        let metadata = from_projections(&docs).unwrap();
        assert!(metadata.limited);
        assert_eq!(metadata.suggestions.len(), 1);
        let group = &metadata.suggestions[0];
        assert_eq!(group.values, ["FICTIONAL COPPER"]);
        assert_eq!(group.sources.len(), 20);
        assert_eq!(group.sources[0].line_start, 2);
        assert_eq!(group.sources[0].line_end, 2);
        assert!(group.sources[0].recorded_at.contains("T21:"));
        let response = serde_json::to_string(group).unwrap();
        assert!(!response.contains("PRIVATE BODY"));
        assert!(!response.contains("raw_text"));
    }
}
