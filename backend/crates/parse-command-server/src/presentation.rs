use crate::{
    Error, Result,
    private::{Private, text, timestamp},
};
use serde_json::{Value, json};
/// Display only the persisted scanner's source fields, never audit/rule IDs or inferred facts.
/// Verify every field against the same hash-checked decoded body used by the detail response.
pub fn source_sets(audits: &[Value], raw: &str) -> Result<(String, Value)> {
    let Some(completed) = audits
        .iter()
        .filter(|v| v["kind"] == "parse_completed")
        .max_by_key(|v| v["recorded_at"].as_str().unwrap_or(""))
    else {
        return Ok((String::new(), json!([])));
    };
    let payload = &completed["payload"];
    let records = payload["records"]
        .as_array()
        .ok_or_else(Error::unavailable)?;
    let fields = |values: &Value| -> Result<Vec<Value>> {
        values
            .as_array()
            .ok_or_else(Error::unavailable)?
            .iter()
            .map(|f| {
                let start = f["start_byte"]
                    .as_u64()
                    .and_then(|v| usize::try_from(v).ok())
                    .ok_or_else(Error::unavailable)?;
                let end = f["end_byte"]
                    .as_u64()
                    .and_then(|v| usize::try_from(v).ok())
                    .ok_or_else(Error::unavailable)?;
                let value = f["raw_text"].as_str().ok_or_else(Error::unavailable)?;
                if raw.get(start..end) != Some(value) || !f["position"].is_u64() {
                    return Err(Error::unavailable());
                }
                Ok(json!({"position":f["position"],"value":value}))
            })
            .collect()
    };
    let mut sets = Vec::with_capacity(records.len());
    for record in records {
        let name = record["set_id"].as_str().ok_or_else(Error::unavailable)?;
        let mut rows = Vec::new();
        for row in record["rows"].as_array().ok_or_else(Error::unavailable)? {
            rows.push(json!({"fields":fields(&row["fields"])?}));
        }
        sets.push(json!({"set_id":name,"fields":fields(&record["fields"])? ,"rows":rows}));
    }
    Ok((text(payload, "profile").to_owned(), json!(sets)))
}
/// Bounded browse/search header fields; full records remain a detail read.
pub fn message_header(core: &Value) -> Value {
    let mut header = serde_json::Map::new();
    for (source, target) in [
        ("type", "type"),
        ("originator", "originator"),
        ("issued_at", "issuedAt"),
    ] {
        if let Some(value) = core[source].as_str() {
            header.insert(target.into(), json!(value));
        }
    }
    Value::Object(header)
}
pub fn message(
    core: &Value,
    private: &Private,
    detail: bool,
    raw: Option<&str>,
    received: Option<&str>,
) -> Result<Value> {
    let key = format!("{}@{}", text(core, "id"), text(core, "revision"));
    let id = private.id(&key)?;
    let mut result = json!({"id":id.to_string(),"sourceMessageId":key,"rawText":raw.unwrap_or(""),"processingStatus":"needs_review","provenance":"upstream","events":[],"lifecycleEntries":[]});
    // Canonical publication follows successful scanning and schema validation.
    // Semantic uncertainty (partial dates, named areas, inferred profiles) is not
    // a failed parse. Specific record interpretation errors still require review.
    result["processingStatus"] = json!(if core["review_flags"]
        .as_array()
        .is_some_and(|flags| flags.iter().any(|v| v == "record_review"))
    {
        "needs_review"
    } else {
        "parsed"
    });
    if let Some(subject) = core["subject"].as_str() {
        result["subject"] = json!(subject);
    }
    if let Some(origin) = core["originator"].as_str() {
        result["sender"] = json!(origin);
    }
    if let Some(received) = received {
        result["receivedAt"] = json!(timestamp(received)?);
    }
    if detail {
        result["structuredPayloadJson"] = json!(core.to_string());
    }
    let mut events = Vec::new();
    if let Some(activities) = core["activities"].as_array() {
        for fact in activities {
            let event_key = format!("{key}#{}", text(fact, "id"));
            let mut e = json!({"id":private.id(&event_key)?.to_string(),"messageId":id.to_string(),"sourceEventId":text(fact,"id"),"title":text(fact,"type").replace('_'," "),"scheduleStatus":"needs_review","reviewReason":"Extracted source fact; operational confirmation and command assignment remain unvalidated","isRevised":false,"revisions":[]});
            for (from, to) in [("start_at", "startAt"), ("end_at", "endAt")] {
                if let Some(t) = fact[from].as_str() {
                    e[to] = json!(timestamp(t)?);
                }
            }
            if core["command_ids"].as_array().is_some_and(|v| v.len() == 1) {
                e["unit"] = core["command_ids"][0].clone();
            }
            events.push(e);
        }
    }
    result["events"] = json!(events);
    Ok(result)
}
pub fn timeline(core: &Value, from: &str, to: &str) -> Result<(Vec<Value>, Vec<Value>)> {
    timeline_with_limit(core, from, to, 2048)
}
fn timeline_add(target: &mut Vec<Value>, other: usize, item: Value, limit: usize) -> Result<()> {
    if target.len() + other >= limit { return Err(Error::new("resource_exhausted", "Timeline fact bound reached; narrow the window")); }
    target.push(item);
    Ok(())
}
pub fn timeline_with_limit(core: &Value, from: &str, to: &str, limit: usize) -> Result<(Vec<Value>, Vec<Value>)> {
    let mut items = Vec::new();
    let mut review = Vec::new();
    let key = format!("{}@{}", text(core, "id"), text(core, "revision"));
    let mut represented = std::collections::BTreeSet::new();
    for raw in core["recurrences"].as_array().into_iter().flatten() {
        let rule: parse_command_types::Recurrence = serde_json::from_value(raw.clone()).map_err(|_| Error::unavailable())?;
        match crate::recurrence::expand(&rule, from, to, limit.saturating_sub(items.len()+review.len()))? {
            crate::recurrence::Expansion::Ready { instants, description, ongoing } => {
                if let Some(activity) = &rule.activity_id { represented.insert(activity.clone()); }
                for at in instants {
                    let occurrence = format!("{}@{at}",rule.id);
                    let item = json!({"key":format!("{key}#{occurrence}"),"messageKey":key,"factId":occurrence,
                        "sourceFactId":rule.id,"title":rule.kind.replace('_'," "),"commandIds":core["command_ids"],
                        "reviewRequired":true,"confirmation":"unvalidated","sourceType":core["type"],"kind":"point","at":at,
                        "recurrence":{"ruleFactId":rule.id,"occurrenceId":occurrence,"rule":rule.rule,"description":description,"ongoing":ongoing}});
                    timeline_add(&mut items, review.len(), item, limit)?;
                }
            }
            crate::recurrence::Expansion::Review { code, reason } => {
                let item = json!({"key":format!("{key}#{}",rule.id),"messageKey":key,"factId":rule.id,
                    "title":rule.kind.replace('_'," "),"commandIds":core["command_ids"],"reviewRequired":true,"sourceType":core["type"],
                    "kind":"unresolved","reasonCode":code,"reason":format!("{reason}; not plotted. Rule: {}",rule.rule)});
                timeline_add(&mut review, items.len(), item, limit)?;
            }
        }
    }
    let Some(facts) = core["activities"].as_array() else {
        return Ok((items, review));
    };
    for fact in facts {
        // A companion replaces only the unresolved prototype, never an independently dated fact.
        if represented.contains(text(fact,"id")) && fact["at"].is_null() && fact["start_at"].is_null() && fact["end_at"].is_null() { continue; }
        let mut item = json!({"key":format!("{key}#{}",text(fact,"id")),"messageKey":key,"factId":fact["id"],"title":text(fact,"type").replace('_'," "),"commandIds":core["command_ids"],"reviewRequired":true,"confirmation":"unvalidated","sourceType":core["type"]});
        if let Some(at) = fact["at"].as_str() {
            if timestamp(at)?.as_str() >= from && timestamp(at)?.as_str() < to {
                item["kind"] = json!("point");
                item["at"] = json!(at);
                timeline_add(&mut items, review.len(), item, limit)?;
            }
            continue;
        }
        if let (Some(start), Some(end)) = (fact["start_at"].as_str(), fact["end_at"].as_str()) {
            let a = timestamp(start)?;
            let b = timestamp(end)?;
            if b > a {
                if a.as_str() < to && b.as_str() > from {
                    item["kind"] = json!("interval");
                    item["start"] = json!(start);
                    item["end"] = json!(end);
                    timeline_add(&mut items, review.len(), item, limit)?;
                }
                continue;
            }
        }
        item["kind"] = json!("unresolved");
        item["reason"] = json!(
            "Date/time or positive interval is unresolved; no duration or date has been inferred"
        );
        timeline_add(&mut review, items.len(), item, limit)?;
    }
    Ok((items, review))
}
pub fn legacy(row: &Value, private: &Private, detail: bool) -> Result<Value> {
    let key = text(row, "source_key");
    let id = private.id(key)?;
    let mut result = json!({"id":id.to_string(),"sourceMessageId":key,"rawText":if detail{text(row,"raw_text")}else{""},"processingStatus":text(row,"processing_status"),"provenance":text(row,"provenance"),"events":[],"lifecycleEntries":[]});
    for (from, to) in [
        ("subject", "subject"),
        ("sender", "sender"),
        ("reference_attribution", "referenceAttribution"),
    ] {
        if let Some(v) = row[from].as_str() {
            result[to] = json!(v);
        }
    }
    if detail && let Some(v) = row["structured_payload_json"].as_str() {
        result["structuredPayloadJson"] = json!(v);
    }
    if let Some(v) = row["received_at"].as_str() {
        result["receivedAt"] = json!(timestamp(v)?);
    }
    if let Some(v) = row["recipients"].as_str() {
        let values: Value = serde_json::from_str(v)
            .map_err(|_| Error::config("Legacy recipient data is invalid"))?;
        result["recipients"] = json!({"values":values});
    }
    if let Some(value) = row["lifecycle_entries"].as_str() {
        let entries: Vec<Value> =
            serde_json::from_str(value).map_err(|_| Error::config("Legacy lifecycle data"))?;
        result["lifecycleEntries"]=json!(entries.into_iter().map(|e|{let mut value=json!({"id":e["id"],"milestone":e["milestone"],"detail":e["detail"],"provenance":e["provenance"]});if let Some(t)=e["recorded_at"].as_str(){value["recordedAt"]=json!(t);}value}).collect::<Vec<_>>());
    }
    let mut events = Vec::new();
    for event in row["events"].as_array().into_iter().flatten() {
        let mut e = json!({"id":private.id(&format!("{key}#legacy-{}",event["id"]))?.to_string(),"messageId":id.to_string(),"title":event["title"],"scheduleStatus":event["schedule_status"],"isRevised":event["is_revised"].as_i64().unwrap_or(0)!=0,"revisions":[]});
        for (a, b) in [
            ("source_event_id", "sourceEventId"),
            ("unit", "unit"),
            ("location", "location"),
            ("review_reason", "reviewReason"),
        ] {
            if !event[a].is_null() {
                e[b] = event[a].clone();
            }
        }
        for (a, b) in [("start_at", "startAt"), ("end_at", "endAt")] {
            if let Some(v) = event[a].as_str() {
                e[b] = json!(timestamp(v)?);
            }
        }
        for (a, b) in [
            ("time_source_lines", "timeSourceLines"),
            ("location_source_lines", "locationSourceLines"),
        ] {
            if let Some(v) = event[a].as_str() {
                e[b] = json!({"lines":serde_json::from_str::<Value>(v).map_err(|_|Error::config("Legacy evidence data"))?});
            }
        }
        let mut revisions = Vec::new();
        for r in event["revisions"].as_array().into_iter().flatten() {
            let mut revision = json!({"id":r["id"].as_i64().unwrap_or(0).to_string(),"eventId":e["id"],"sequence":r["sequence"].as_i64().unwrap_or(0).to_string()});
            for (a, b) in [
                ("revised_at", "revisedAt"),
                ("prior_start_at", "priorStartAt"),
                ("prior_end_at", "priorEndAt"),
                ("replacement_start_at", "replacementStartAt"),
                ("replacement_end_at", "replacementEndAt"),
            ] {
                if let Some(v) = r[a].as_str() {
                    revision[b] = json!(timestamp(v)?);
                }
            }
            for (a, b) in [
                ("source_message_id", "sourceMessageId"),
                ("description", "description"),
            ] {
                if !r[a].is_null() {
                    revision[b] = r[a].clone();
                }
            }
            if let Some(v) = r["time_source_lines"].as_str() {
                revision["timeSourceLines"] = json!({"lines":serde_json::from_str::<Value>(v).map_err(|_|Error::config("Legacy evidence data"))?});
            }
            revisions.push(revision);
        }
        e["revisions"] = json!(revisions);
        events.push(e);
    }
    result["events"] = json!(events);
    Ok(result)
}
