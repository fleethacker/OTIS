//! Demo view filtering, not authorization. Keep network metadata out of ICD core
//! and search mappings; use a bounded custody lookup before executing templates.
use super::{desk, model::DeskNetwork};
use crate::{Error, Result, private::text};
use parse_command_state::Store;
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub async fn apply(store: &Store, custody: &Store, owner: &str, filters: &mut Value) -> Result<()> {
    let Some(network) = desk(store, owner).await?.network() else { return Ok(()); };
    let result = custody.search(json!({"size":501,"_source":["payload.core.id","payload.core.revision"],"query":{"bool":{"filter":[{"term":{"kind":"projection"}},{"term":{"flags":format!("arrival:{network}")}}]}},"sort":["key"]})).await?;
    let hits = result["hits"]["hits"].as_array().ok_or_else(Error::unavailable)?;
    if hits.len() > 500 { return Err(Error::new("resource_exhausted", "Demo network view exceeds 500 messages; select ALL")); }
    let mut revisions: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for hit in hits {
        let core = &hit["_source"]["payload"]["core"];
        revisions.entry(text(core, "revision").into()).or_default().push(text(core, "id").into());
    }
    let pairs = revisions.into_iter().map(|(revision, ids)| json!({"bool":{"filter":[{"term":{"revision":revision}}],"should":[{"terms":{"id":ids}},{"terms":{"message_id":ids}}],"minimum_should_match":1}})).collect::<Vec<_>>();
    filters.as_array_mut().ok_or_else(Error::unavailable)?.push(if pairs.is_empty() { json!({"match_none":{}}) } else { json!({"bool":{"should":pairs,"minimum_should_match":1}}) });
    Ok(())
}
pub async fn decorate(custody: &Store, value: &mut Value) -> Result<()> {
    let keys = value["messages"].as_array().into_iter().flatten().filter_map(|v| v["sourceMessageId"].as_str()).filter(|key| !key.starts_with("legacy:")).map(str::to_owned).collect::<Vec<_>>();
    let mut networks = serde_json::Map::new();
    if !keys.is_empty() {
        let ids = keys.iter().map(|k| parse_command_state::id("projection", k)).collect::<Vec<_>>();
        let (status, response) = custody.request(reqwest::Method::POST, &format!("/{}/_mget?_source_includes=payload.arrivals", custody.index()), Some(json!({"ids":ids}))).await?;
        if !status.is_success() { return Err(Error::unavailable()); }
        let docs = response["docs"].as_array().filter(|docs| docs.len() == keys.len()).ok_or_else(Error::unavailable)?;
        for (key, doc) in keys.iter().zip(docs) {
            if doc.get("error").is_some() { return Err(Error::unavailable()); }
            let arrivals = &doc["_source"]["payload"]["arrivals"];
            let labels = ["HIGH", "LOW"].into_iter().filter(|n| arrivals.get(*n).is_some()).collect::<Vec<_>>();
            networks.insert(key.clone(), json!(labels));
        }
    }
    if value["meta"].is_object() { value["meta"]["arrivalNetworks"] = json!(networks); }
    Ok(())
}
pub fn notification_filter(desk: DeskNetwork) -> Value {
    desk.network().map_or_else(|| json!({"match_all":{}}), |network| json!({"term":{"flags":format!("arrival:{network}")}}))
}
pub fn notification_visible(desk: DeskNetwork, flags: &[String]) -> bool {
    desk.network().is_none_or(|n| flags.contains(&format!("arrival:{n}")))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_arrivals_are_only_in_all_and_high_content_is_not_in_low_bell() {
        assert!(notification_visible(DeskNetwork::All, &[]));
        assert!(!notification_visible(DeskNetwork::Low, &[]));
        assert!(!notification_visible(DeskNetwork::Low, &["arrival:HIGH".into()]));
        assert!(notification_visible(DeskNetwork::High, &["arrival:HIGH".into()]));
        assert!(notification_visible(DeskNetwork::Low, &["arrival:HIGH".into(), "arrival:LOW".into()]));
    }
}
