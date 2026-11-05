//! Projects managed events from the same resolver as task/review/planning APIs.
use crate::{
    Error, Result, anchor, anchor_lineage,
    api::{App, Identity, ReadRequest},
    private::text,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub struct Rows<'a> {
    pub from: &'a str,
    pub to: &'a str,
    pub messages: &'a mut Vec<Value>,
    pub items: &'a mut Vec<Value>,
    pub review: &'a mut Vec<Value>,
}

pub async fn overlay(
    app: &App,
    owner: &str,
    effective: &crate::station::ResolvedScope,
    request: &ReadRequest,
    matched: Option<&BTreeSet<String>>,
    rows: Rows<'_>,
) -> Result<Vec<Value>> {
    let reserved: Vec<crate::work::Binding> =
        serde_json::from_str(include_str!("../../../config/priority-2/sources.json"))
            .map_err(|_| Error::config("Invalid ANCHOR source bindings"))?;
    // Explicit scenario candidates cannot appear as unrelated active instructions before registration.
    let mut managed: BTreeSet<(String, String)> = reserved
        .into_iter()
        .filter_map(|source| source.fact_id.map(|fact| (source.source_key, fact)))
        .collect();
    let loaded = crate::work::load(app).await?;
    if let Some((_, workflow)) = &loaded {
        let lineage = anchor::lineage(workflow)?;
        managed.extend(lineage.events.values().flat_map(|h| {
            anchor_lineage::managed_facts(&h.versions)
                .into_iter()
                .map(|(key, fact)| (key.to_owned(), fact.to_owned()))
        }));
    }
    // Use raw declarations, including invalid ones, to avoid plotting obsolete facts.
    for items in [&mut *rows.items, &mut *rows.review] {
        items.retain(|row| {
            !managed.contains(&(text(row, "messageKey").into(), text(row, "factId").into()))
        });
    }
    let Some((_, workflow)) = loaded else {
        return Ok(vec![]);
    };
    let account = crate::accounts::account(&app.private.state, owner).await?;
    account.require("schedule:read")?;
    let actor = Identity {
        owner: owner.into(),
        role: account.role,
        username: account.username,
        email: account.email,
        groups: vec![],
    };
    let mut views = Vec::new();
    for event in anchor::current_views(&workflow)? {
        let mut cores = BTreeMap::new();
        let mut allowed = true;
        for version in &event.history {
            let (id, revision) = crate::search::split_key(&version.source.message_key)?;
            let core = app.search.canonical(id, revision).await?;
            if !effective.matches(&core)? {
                allowed = false;
                break;
            }
            cores.insert(version.source.message_key.clone(), core);
        }
        if !allowed {
            continue;
        }
        let Some(reference) = event
            .current
            .as_ref()
            .or(event.original.as_ref())
            .or(event.history.first())
        else {
            continue;
        };
        let core = cores
            .get(&reference.source.message_key)
            .ok_or_else(Error::unavailable)?;
        if !request.filters.matches(core)?
            || matched.is_some_and(|keys| {
                !event
                    .history
                    .iter()
                    .any(|v| keys.contains(&v.source.message_key))
            })
        {
            continue;
        }
        // History remains visible on the affected date after a move or cancellation.
        let relevant = event.history.iter().any(|v| {
            v.interval
                .as_ref()
                .is_some_and(|i| i.start.as_str() < rows.to && i.end.as_str() > rows.from)
        });
        if !relevant && event.history.iter().any(|v| v.interval.is_some()) {
            continue;
        }
        if !rows
            .messages
            .iter()
            .any(|m| m["sourceMessageId"] == reference.source.message_key)
        {
            rows.messages
                .push(crate::presentation::message(core, &app.private, false, None, None).await?);
        }
        if let Some(interval) = event.scheduling_interval() {
            if interval.start.as_str() < rows.to && interval.end.as_str() > rows.from {
                rows.items.push(json!({"key":format!("{}#{}",reference.source.message_key,reference.source.fact_id.as_deref().unwrap_or("")),"messageKey":reference.source.message_key,"factId":reference.source.fact_id,"logicalEventId":event.logical_event_id,"currentVersionToken":event.version_token,"title":"MERIDIAN COMMS · current instruction","kind":"interval","start":interval.start,"end":interval.end,"commandIds":core["command_ids"],"sourceType":core["type"],"reviewRequired":true,"confirmation":"unvalidated"}));
            }
        } else if event.status != anchor_lineage::Status::Cancelled {
            rows.review.push(json!({"key":format!("anchor:{}",event.logical_event_id),"messageKey":reference.source.message_key,"factId":reference.source.fact_id,"title":if event.status==anchor_lineage::Status::Unresolved {"Current version unresolved"} else {"Current event time unavailable"},"kind":"unresolved","reasonCode":"anchor_lineage","reason":format!("Message history requires review: {:?}",event.problems),"commandIds":core["command_ids"],"reviewRequired":true}));
        }
        views.push(anchor::event_view(&workflow, &actor, &event)?);
    }
    Ok(views)
}
