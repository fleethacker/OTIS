//! Bounded, metadata-only suggestions from published scanner evidence in custody.
//! SQLite verifies byte spans and computes line bounds; raw bodies never leave SQLite here.
use crate::{Error, Result, private::timestamp};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path, time::Duration};

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
pub fn read(path: &Path) -> Result<Metadata> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.busy_timeout(Duration::from_millis(250))?;
    db.execute_batch("BEGIN")?;
    read_connection(&db)
}
fn unsigned(value: i64) -> Result<u64> {
    u64::try_from(value).map_err(|_| Error::unavailable())
}
pub fn read_connection(db: &Connection) -> Result<Metadata> {
    let count: i64 = db.query_row("SELECT count(*) FROM (SELECT 1 FROM projections WHERE delivery_state='published' LIMIT 201)", [], |r| r.get(0))?;
    // Only EXER/OPER first fields from supported profiles, matched byte-for-byte to
    // the same revision's source-preserved audit. No participant/originator candidates.
    let mut query = db.prepare(r#"
      WITH recent AS (
        SELECT message_id,revision FROM projections WHERE delivery_state='published'
        ORDER BY rowid DESC LIMIT 200
      ), fields AS (
        SELECT a.message_id,a.revision,a.id AS audit_id,
          json_extract(a.document,'$.recorded_at') AS recorded,
          json_extract(r.value,'$.set_id') AS set_id,
          json_extract(f.value,'$.raw_text') AS value,
          json_extract(f.value,'$.start_byte') AS first,
          json_extract(f.value,'$.end_byte') AS last,
          CAST(json_extract(s.document,'$.payload.source.raw_text') AS BLOB) AS raw
        FROM recent p
        JOIN audit_outbox a ON a.message_id=p.message_id AND a.revision=p.revision
        JOIN audit_outbox s ON s.message_id=p.message_id AND s.revision=p.revision
        JOIN json_each(a.document,'$.payload.records') r
        JOIN json_each(r.value,'$.fields') f
        WHERE a.delivery_state='published' AND s.delivery_state='published'
          AND json_extract(a.document,'$.kind')='parse_completed'
          AND json_extract(s.document,'$.kind')='source_preserved'
          AND json_extract(s.document,'$.payload.source.sha256')=substr(p.message_id,8)
          AND json_extract(a.document,'$.payload.profile') IN ('usmtf-2003-subset-v1','observed-optask-extensions-v1')
          AND json_extract(r.value,'$.set_id') IN ('EXER','OPER')
          AND json_extract(f.value,'$.position')=1
          AND json_type(f.value,'$.start_byte')='integer' AND json_type(f.value,'$.end_byte')='integer'
      )
      SELECT message_id,revision,audit_id,recorded,set_id,value,first,last,
        1+length(CAST(substr(raw,1,first) AS TEXT))-length(replace(CAST(substr(raw,1,first) AS TEXT),char(10),'')),
        1+length(CAST(substr(raw,1,last-1) AS TEXT))-length(replace(CAST(substr(raw,1,last-1) AS TEXT),char(10),''))
      FROM fields WHERE first>=0 AND last>first AND last<=length(raw)
        AND length(CAST(value AS BLOB))=last-first
        AND substr(raw,first+1,last-first)=CAST(value AS BLOB)
        AND length(value) BETWEEN 1 AND 128
      ORDER BY recorded DESC,message_id,first LIMIT 401
    "#)?;
    let records = query.query_map([], |r| Ok((
        r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?,
        r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, String>(5)?,
        r.get::<_, i64>(6)?, r.get::<_, i64>(7)?, r.get::<_, i64>(8)?, r.get::<_, i64>(9)?,
    )))?;
    let mut groups: BTreeMap<String, Suggestion> = BTreeMap::new();
    let mut limited = count > 200;
    for (index, record) in records.enumerate() {
        if index == 400 { limited = true; break; }
        let (id, revision, audit, recorded, set, raw_value, start, end, line_start, line_end) = record?;
        let (start, end, line_start, line_end) = (unsigned(start)?, unsigned(end)?, unsigned(line_start)?, unsigned(line_end)?);
        let value = raw_value.split_whitespace().collect::<Vec<_>>().join(" ");
        if value.is_empty() || value == "-" || value.len() > 128 { continue; }
        parse_command_types::validate_hash_id(&id, "message_id").map_err(|_| Error::unavailable())?;
        parse_command_types::validate_revision(&revision, "revision").map_err(|_| Error::unavailable())?;
        parse_command_types::validate_event_id(&audit, "audit_id").map_err(|_| Error::unavailable())?;
        let group = groups.entry(value.clone()).or_insert_with(|| Suggestion {
            id: format!("context:{:x}", Sha256::digest(format!("operationName\0{value}").as_bytes())),
            field: "operationName", values: vec![value], sources: Vec::new(),
        });
        if !group.sources.iter().any(|s| s.message_key == format!("{id}@{revision}") && s.start_byte == start) {
            group.sources.push(Citation {
                message_key: format!("{id}@{revision}"), audit_id: audit, set_id: set,
                recorded_at: timestamp(&recorded)?, start_byte: start, end_byte: end, line_start, line_end,
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
    use serde_json::json;
    fn evidence(db: &Connection, index: usize, corrupt: bool) {
        let raw = format!("MSGID/FICTIONAL É{index}//\nEXER/FICTIONAL COPPER//\nGENTEXT/PRIVATE BODY NEVER RETURNED//");
        let id = parse_command_types::message_id(&raw);
        let start = raw.find("FICTIONAL COPPER").unwrap();
        let field = json!({"position":1,"raw_text":"FICTIONAL COPPER","start_byte":start,"end_byte":start+if corrupt { 1 } else { "FICTIONAL COPPER".len() }});
        db.execute("INSERT INTO projections VALUES(?,'r1','published')", [&id]).unwrap();
        for (kind, payload) in [
            ("source_preserved", json!({"source":{"raw_text":raw,"sha256":id.trim_start_matches("sha256:")}})),
            ("parse_completed", json!({"profile":"observed-optask-extensions-v1","records":[{"set_id":"EXER","fields":[field],"rows":[]}]})),
        ] {
            let audit = parse_command_types::event_id(&[&id, kind]);
            let doc = json!({"id":audit,"kind":kind,"recorded_at":format!("2026-11-05T{index:02}:00:00Z"),"payload":payload});
            db.execute("INSERT INTO audit_outbox VALUES(?,?,'r1',?,'published')", rusqlite::params![audit,id,doc.to_string()]).unwrap();
        }
    }
    #[test]
    fn sqlite_signed_bounds_are_checked_without_exposing_input() {
        assert_eq!(unsigned(0).unwrap(), 0);
        assert_eq!(unsigned(i64::MAX).unwrap(), 9_223_372_036_854_775_807u64);
        assert_eq!(unsigned(-1).err().unwrap().code, "unavailable");
    }
    #[test]
    fn grouped_metadata_verifies_spans_counts_unicode_lines_and_caps_citations() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE projections(message_id TEXT,revision TEXT,delivery_state TEXT); CREATE TABLE audit_outbox(id TEXT,message_id TEXT,revision TEXT,document TEXT,delivery_state TEXT)").unwrap();
        evidence(&db, 0, true);
        assert!(read_connection(&db).unwrap().suggestions.is_empty());
        for index in 1..=21 { evidence(&db, index, false); }
        let metadata = read_connection(&db).unwrap();
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
