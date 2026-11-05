//! Rebuildable source-report roll-ups, never an assertion of operational readiness.
use chrono::NaiveDateTime;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
pub const INDEX: &str = "parse-command-casualties-v1";
pub const MAX_HISTORY: usize = 500;
fn string<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn initial_reference(core: &Value) -> Option<String> {
    if core["casualty"]["report_type"] == "INITIAL" {
        let issue = core["issued_at"].as_str()?;
        let dt = chrono::DateTime::parse_from_rfc3339(issue).ok()?;
        Some(dt.format("%d%H%MZ%b%Y").to_string().to_uppercase())
    } else {
        let label = core["casualty"]["initial_report_label"].as_str()?;
        NaiveDateTime::parse_from_str(label, "%d%H%MZ%b%Y").ok()?;
        Some(label.to_uppercase())
    }
}
pub fn key(core: &Value) -> String {
    // Never combine security scopes or command assignments into a lower-marked view.
    let mut commands = core["command_ids"].as_array().cloned().unwrap_or_default();
    commands.sort_by_key(Value::to_string);
    let reference = initial_reference(core).unwrap_or_else(|| {
        format!(
            "unresolved:{}@{}",
            string(core, "id"),
            string(core, "revision")
        )
    });
    format!(
        "{:x}",
        Sha256::digest(
            json!([
                core["casualty"]["reporting_uic"],
                core["casualty"]["serial"],
                reference,
                core["security"],
                commands,
                core["revision"]
            ])
            .to_string()
            .as_bytes()
        )
    )
}
pub fn project(reports: &[Value], limited: bool) -> Vec<Value> {
    let mut groups: BTreeMap<String, Vec<&Value>> = BTreeMap::new();
    for report in reports
        .iter()
        .filter(|r| r["type"] == "CASREP" && r["casualty"].is_object())
    {
        groups.entry(key(report)).or_default().push(report);
    }
    groups.into_iter().map(|(id,mut history)|{
        history.sort_by_key(|r|(string(r,"issued_at"),string(&r["casualty"],"update_sequence"),string(r,"id")));
        history.dedup_by(|a,b|a["id"]==b["id"] && a["revision"]==b["revision"]);
        let mut flags=BTreeSet::new();
        if limited{flags.insert("history_limit");}
        let initials=history.iter().filter(|r|r["casualty"]["report_type"]=="INITIAL").count();
        if initials!=1{flags.insert(if initials==0{"missing_initial"}else{"conflicting_initials"});}
        if history.iter().any(|r|initial_reference(r).is_none() || r["issued_at"].as_str().is_none()) {flags.insert("unresolved_source_time");}
        let mut sequence=0;
        let mut terminal=false;
        let mut previous_time=None;
        for r in &history{
            let c=&r["casualty"];
            if terminal {flags.insert("report_after_terminal_action");}
            terminal=matches!(string(c,"report_type"),"CORRECT"|"CANCEL");
            if previous_time==r["issued_at"].as_str(){flags.insert("conflicting_source_order");}
            previous_time=r["issued_at"].as_str();
            if c["report_type"]=="UPDATE"{
                let next=string(c,"update_sequence").parse::<u32>().unwrap_or(0);
                if next<=sequence{flags.insert("conflicting_update_sequence");}
                if next!=sequence+1{flags.insert("missing_update_sequence");}
                sequence=next;
            }
        }
        let latest=history.last().expect("nonempty group");let c=&latest["casualty"];
        let state=if !flags.is_empty(){"unresolved"}else{match string(c,"report_type"){"CORRECT"=>"reported_corrected","CANCEL"=>"report_cancelled",_=>"reported_casualty"}};
        let mut result=json!({"id":id,"projection":"casrep-source-history-v1","type":"CASREP","revision":latest["revision"],
            "serial":c["serial"],"reporting_uic":c["reporting_uic"],"state":state,"review_required":true,
            "review_flags":flags.into_iter().collect::<Vec<_>>(),"security":latest["security"],"command_ids":latest["command_ids"],
            "latest_message_key":format!("{}@{}",string(latest,"id"),string(latest,"revision")),"issued_at":latest["issued_at"],
            "history":history.iter().map(|r|json!({"key":format!("{}@{}",string(r,"id"),string(r,"revision")),"report_type":r["casualty"]["report_type"],"update_sequence":r["casualty"]["update_sequence"],"issued_at":r["issued_at"]})).collect::<Vec<_>>()});
        if let Some(reference)=initial_reference(latest){result["initial_reference"]=json!(reference);}
        for field in ["equipment","eic","category","cause","repair_estimate_date"]{if let Some(value)=c.get(field){result[field]=value.clone();}}
        result
    }).collect()
}
