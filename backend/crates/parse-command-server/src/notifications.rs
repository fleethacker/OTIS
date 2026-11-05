//! Idempotent notification projection. The source cursor advances only after all
//! writes for an event have been acknowledged. Replay never increments a group twice.
use crate::{
    Error, Result,
    api::App,
    private::{text, timestamp},
};
use axum::{
    extract::{Json, Path, State},
    http::HeaderMap,
};
use parse_command_state::{Record, Store};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
const BATCH: usize = 32;
const PAGE: usize = 20;
#[derive(Default)]
struct Source {
    key: String,
    subject: String,
    context: String,
}
async fn source(store: &Store, key: &str) -> Result<Source> {
    if key.is_empty() {
        return Ok(Source::default());
    }
    let Some(doc) = store.get("projection", key).await? else {
        return Ok(Source::default());
    };
    let core = &doc.record.payload["core"];
    Ok(Source {
        key: if doc.record.state == "published" {
            key.into()
        } else {
            String::new()
        },
        subject: text(core, "subject").chars().take(240).collect(),
        context: [text(core, "type"), text(core, "originator")]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" · ")
            .chars()
            .take(240)
            .collect(),
    })
}
async fn notice(
    store: &Store,
    key: &str,
    version: i64,
    kind: &str,
    source: &Source,
    at: &str,
    detail: &str,
) -> Result<()> {
    let mut row = Record::new(
        "notification",
        key,
        json!({"id":version,"kind":kind,"context":source.context,"messageKey":source.key,"at":at,"detail":detail,"resolvedAt":null,"count":1,"members":{}}),
    );
    row.order = version;
    let notice = store
        .update("notification", key, |old| {
            Ok(old.cloned().unwrap_or_else(|| row.clone()))
        })
        .await?;
    let id = notice.record.payload["id"]
        .as_i64()
        .ok_or_else(Error::unavailable)?;
    // A grouped traffic notice keeps its first ID while its version advances.
    // Only that public ID needs a lookup row; replay repairs a missing lookup.
    store
        .update("notification_id", &id.to_string(), |old| {
            Ok(old.cloned().unwrap_or_else(|| {
                Record::new("notification_id", &id.to_string(), json!({"key":key}))
            }))
        })
        .await?;
    Ok(())
}
async fn traffic(store: &Store, event: &Record, source: &Source, at: &str) -> Result<()> {
    if source.key.is_empty() {
        return Ok(());
    }
    let body = source
        .key
        .rsplit_once('@')
        .map_or(source.key.as_str(), |(body, _)| body);
    let old = store.get("notification_seen", body).await?;
    let seen = if let Some(old) = old {
        old
    } else {
        let version = store.next("notifications").await?;
        let seconds = chrono::DateTime::parse_from_rfc3339(at)
            .map_err(|_| Error::unavailable())?
            .timestamp();
        let key = format!("traffic:{}", seconds.div_euclid(300));
        let mut row = Record::new(
            "notification_seen",
            body,
            json!({"event":event.key,"group":key,"at":at}),
        );
        row.order = version;
        store.put(&row, None).await?
    };
    if seen.record.payload["event"] != event.key {
        return Ok(());
    }
    let group = text(&seen.record.payload, "group");
    let version = seen.record.order;
    notice(store, group, version, "traffic", source, at, "").await?;
    store.update("notification",group,|old| {
        let mut row=old.cloned().ok_or(parse_command_state::Error("state_record"))?;
        let members=row.payload["members"].as_object_mut().ok_or(parse_command_state::Error("state_record"))?;
        if members.contains_key(body){return Ok(row);}
        if members.len()>=20000{return Err(parse_command_state::Error("state_capacity"));}
        members.insert(body.into(),json!({"messageKey":source.key,"subject":source.subject,"context":source.context,"at":at,"version":version}));
        let count=members.len();row.payload["count"]=json!(count);row.order=row.order.max(version);
        if at>text(&row.payload,"at"){row.payload["at"]=json!(at);}
        if count>1{row.payload["context"]=json!("");row.payload["messageKey"]=json!("");}Ok(row)
    }).await?;
    Ok(())
}
async fn incident(
    store: &Store,
    scope: &str,
    event: &Record,
    source: &Source,
    at: &str,
    detail: Option<&str>,
) -> Result<()> {
    let old = store.get("notification_incident", scope).await?;
    if let Some(detail) = detail {
        let doc = if let Some(old) = old.filter(|d| d.record.state == "open") {
            old
        } else {
            let version = store.next("notifications").await?;
            store.update("notification_incident",scope,|old| {
                if let Some(old)=old.filter(|r|r.state=="open"){return Ok(old.clone());}
                let mut row=Record::new("notification_incident",scope,json!({"failure":format!("failure:{scope}:{}",event.key),"at":at,"detail":detail}));row.state="open".into();row.order=version;Ok(row)
            }).await?
        };
        notice(
            store,
            text(&doc.record.payload, "failure"),
            doc.record.order,
            "failed",
            source,
            text(&doc.record.payload, "at"),
            text(&doc.record.payload, "detail"),
        )
        .await?;
    } else if let Some(old) = old {
        let doc = if old.record.state == "open" {
            let version = store.next("notifications").await?;
            let mut row = old.record.clone();
            row.state = "closed".into();
            row.payload["recovery_event"] = json!(event.key);
            row.payload["recovered_at"] = json!(at);
            row.payload["recovery_version"] = json!(version);
            store.put(&row, Some(&old)).await?
        } else {
            old
        };
        if doc.record.payload["recovery_event"] == event.key {
            let failure = text(&doc.record.payload, "failure");
            store
                .update("notification", failure, |old| {
                    let mut row = old
                        .cloned()
                        .ok_or(parse_command_state::Error("state_record"))?;
                    row.payload["resolvedAt"] = json!(at);
                    Ok(row)
                })
                .await?;
            notice(
                store,
                &format!("recovery:{failure}"),
                doc.record.payload["recovery_version"]
                    .as_i64()
                    .ok_or_else(Error::unavailable)?,
                "recovered",
                source,
                at,
                "",
            )
            .await?;
        }
    }
    Ok(())
}
pub async fn sync(store: &Store, custody: &Store) -> Result<bool> {
    let mut catching_up = false;
    for kind in ["custody_event", "publication_event"] {
        let old = store.get("notification_cursor", kind).await?;
        let cursor = old.as_ref().map(|d| d.record.order).unwrap_or(0);
        let events = custody
            .list(kind, vec![json!({"range":{"order":{"gt":cursor}}})], BATCH)
            .await?;
        for doc in &events {
            let row = &doc.record;
            let at = timestamp(text(&row.payload, "at"))?;
            let source = source(custody, &row.source).await?;
            let scope = format!("{kind}:{}", row.owner);
            if kind == "custody_event" {
                match row.state.as_str() {
                    "quarantined" | "unsupported" | "retrying" | "fetch_failed" | "rejected" => {
                        incident(
                            store,
                            &scope,
                            row,
                            &source,
                            &at,
                            Some(intake_reason(text(&row.payload, "code"))),
                        )
                        .await?
                    }
                    "parsed" | "duplicate" => {
                        incident(store, &scope, row, &source, &at, None).await?
                    }
                    _ => {}
                }
            } else if row.state == "publication_succeeded" {
                incident(store, &scope, row, &source, &at, None).await?;
                if row.category == "message" {
                    traffic(store, row, &source, &at).await?;
                }
            } else {
                let detail = match row.category.as_str() {
                    "message" => "Message indexing failed",
                    "passage" => "Search indexing failed",
                    "enrich" => "Embedding failed",
                    "audit" => "Audit storage failed",
                    _ => "Publication failed",
                };
                incident(store, &scope, row, &source, &at, Some(detail)).await?;
            }
        }
        if let Some(last) = events.last() {
            let mut row = Record::new("notification_cursor", kind, json!({}));
            row.order = last.record.order;
            store.put(&row, old.as_ref()).await?;
        }
        catching_up |= events.len() == BATCH;
    }
    prune(store).await?;
    let status = store.get("notification_status", "sync").await?;
    if status
        .as_ref()
        .is_none_or(|old| old.record.payload["catchingUp"] != catching_up)
    {
        let row = Record::new(
            "notification_status",
            "sync",
            json!({"catchingUp":catching_up}),
        );
        store.put(&row, status.as_ref()).await?;
    }
    Ok(catching_up)
}
async fn prune(store: &Store) -> Result<()> {
    let result=store.search(json!({"size":128,"from":5000,"query":{"term":{"kind":"notification"}},"sort":[{"order":"desc"},"key"]})).await?;
    let docs = parse_command_state::hits(&result)?;
    for doc in docs {
        // Read markers for expired notices are removed lazily on the next read
        // mutation using the monotonically increasing retained floor.
        store
            .update("notification_floor", "retained", |old| {
                let mut row = old
                    .cloned()
                    .unwrap_or_else(|| Record::new("notification_floor", "retained", json!({})));
                row.order = row.order.max(doc.record.order);
                Ok(row)
            })
            .await?;
        if let Some(id) = doc.record.payload["id"].as_i64()
            && let Some(reference) = store.get("notification_id", &id.to_string()).await?
        {
            store.delete(&reference).await?;
        }
        store.delete(&doc).await?;
    }
    Ok(())
}
fn intake_reason(code: &str) -> &'static str {
    if code.contains("size") || code.contains("limit") {
        "Message exceeds intake limits"
    } else if code.contains("mime") || code.contains("encoding") || code.contains("utf") {
        "Email body could not be decoded"
    } else if code.contains("unsupported") || code.contains("profile") {
        "Message format could not be matched"
    } else if code.contains("fetch") {
        "Email retrieval failed"
    } else if code.contains("journal") || code.contains("storage") {
        "Message storage failed"
    } else {
        "Message processing failed"
    }
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub before: Option<i64>,
    pub id: Option<i64>,
    pub version: Option<i64>,
    pub through: Option<i64>,
}
fn positive(value: Option<i64>) -> Result<i64> {
    value
        .filter(|v| *v > 0 && *v <= 9_007_199_254_740_991)
        .ok_or_else(|| Error::invalid("Invalid notification selection"))
}
async fn selected(store: &Store, id: i64) -> Result<parse_command_state::Document> {
    let reference = store
        .get("notification_id", &id.to_string())
        .await?
        .ok_or_else(|| Error::invalid("Notification is unavailable"))?;
    store
        .get("notification", text(&reference.record.payload, "key"))
        .await?
        .ok_or_else(|| Error::invalid("Notification is unavailable"))
}
pub async fn execute(
    store: &Store,
    owner: &str,
    operation: &str,
    request: Request,
) -> Result<Value> {
    let watermark = store
        .get("counter", "notifications")
        .await?
        .map(|d| d.record.order)
        .unwrap_or(0);
    let read = store
        .get("notification_reads", owner)
        .await?
        .map(|d| d.record.payload)
        .unwrap_or_else(|| json!({"through":0,"versions":{}}));
    let through = read["through"].as_i64().unwrap_or(0);
    match operation {
        "list" => {
            let before = request
                .before
                .map(|v| positive(Some(v)))
                .transpose()?
                .unwrap_or(i64::MAX);
            let value=store.search(json!({"size":PAGE+1,"_source":{"excludes":["payload.members"]},"query":{"bool":{"filter":[{"term":{"kind":"notification"}},{"range":{"order":{"lt":before}}}]}},"sort":[{"order":"desc"},"key"]})).await?;
            let rows = parse_command_state::hits(&value)?;
            let more = rows.len() > PAGE;
            let mut items = Vec::new();
            for doc in rows.into_iter().take(PAGE) {
                let mut item = doc.record.payload;
                let id = item["id"].as_i64().ok_or_else(Error::unavailable)?;
                item["version"] = json!(doc.record.order);
                item["unread"] = json!(
                    doc.record.order
                        > through.max(read["versions"][id.to_string()].as_i64().unwrap_or(0))
                );
                items.push(item);
            }
            // The server owns the bounded inbox. Read markers are compared with
            // indexed versions; payload/member traffic is excluded from this scan.
            let mut unread = 0;
            let mut after = None;
            let mut scanned = 0;
            loop {
                let mut q = json!({"size":500,"_source":["kind","key","order","payload.id"],"query":{"bool":{"filter":[{"term":{"kind":"notification"}},{"range":{"order":{"gt":through}}}]}},"sort":[{"order":"desc"},"key"]});
                if let Some(v) = after {
                    q["search_after"] = v;
                }
                let value = store.search(q).await?;
                let hits = value["hits"]["hits"]
                    .as_array()
                    .ok_or_else(Error::unavailable)?;
                for hit in hits {
                    let row = &hit["_source"];
                    let id = row["payload"]["id"]
                        .as_i64()
                        .ok_or_else(Error::unavailable)?
                        .to_string();
                    if row["order"].as_i64().unwrap_or(0)
                        > read["versions"][&id].as_i64().unwrap_or(0)
                    {
                        unread += 1;
                    }
                }
                scanned += hits.len();
                if hits.len() < 500 || scanned >= 5000 {
                    break;
                }
                after = hits.last().map(|h| h["sort"].clone());
            }
            let next = if more {
                items.last().map(|i| i["version"].clone())
            } else {
                None
            };
            let catching_up = store
                .get("notification_status", "sync")
                .await?
                .is_none_or(|doc| doc.record.payload["catchingUp"] == true);
            Ok(
                json!({"items":items,"unread":unread,"watermark":watermark,"nextBefore":next,"catchingUp":catching_up}),
            )
        }
        "members" => {
            let doc = selected(store, positive(request.id)?).await?;
            let before = request
                .before
                .map(|v| positive(Some(v)))
                .transpose()?
                .unwrap_or(i64::MAX);
            let mut items = doc.record.payload["members"]
                .as_object()
                .map(|v| {
                    v.values()
                        .filter(|v| v["version"].as_i64().is_some_and(|n| n < before))
                        .cloned()
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            items.sort_by_key(|v| std::cmp::Reverse(v["version"].as_i64().unwrap_or(0)));
            let more = items.len() > PAGE;
            items.truncate(PAGE);
            let next = if more {
                items.last().map(|i| i["version"].clone())
            } else {
                None
            };
            Ok(json!({"items":items,"nextBefore":next}))
        }
        "read" => {
            let change = if let Some(through) = request.through {
                if request.id.is_some()
                    || request.version.is_some()
                    || through < 0
                    || through > watermark
                {
                    return Err(Error::invalid("Invalid read snapshot"));
                }
                None
            } else {
                let id = positive(request.id)?;
                let version = positive(request.version)?;
                let doc = selected(store, id).await?;
                if version > doc.record.order {
                    return Err(Error::invalid("Invalid notification version"));
                }
                Some((id, version))
            };
            let floor = store
                .get("notification_floor", "retained")
                .await?
                .map(|d| d.record.order)
                .unwrap_or(0);
            store
                .update("notification_reads", owner, |old| {
                    let mut row = old.cloned().unwrap_or_else(|| {
                        Record::new(
                            "notification_reads",
                            owner,
                            json!({"through":0,"versions":{}}),
                        )
                    });
                    row.owner = owner.into();
                    let through = row.payload["through"]
                        .as_i64()
                        .unwrap_or(0)
                        .max(request.through.unwrap_or(0))
                        .max(floor);
                    row.payload["through"] = json!(through);
                    let versions = row.payload["versions"]
                        .as_object_mut()
                        .ok_or(parse_command_state::Error("state_record"))?;
                    versions.retain(|_, v| v.as_i64().is_some_and(|n| n > through));
                    if let Some((id, version)) = change {
                        let key = id.to_string();
                        let current = versions.get(&key).and_then(Value::as_i64).unwrap_or(0);
                        if version > through {
                            versions.insert(key, json!(current.max(version)));
                        }
                    }
                    if versions.len() > 5000 {
                        return Err(parse_command_state::Error("state_capacity"));
                    }
                    Ok(row)
                })
                .await?;
            Ok(json!({"saved":true}))
        }
        _ => Err(Error::new("not_found", "Unknown notification operation")),
    }
}
pub async fn handle(
    State(app): State<Arc<App>>,
    Path(operation): Path<String>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Result<Json<Value>> {
    let owner = app.headers_identity(&headers).await?.owner;
    let scope = crate::station::effective_scope(&app.private, &owner).await?;
    Ok(Json(
        execute_scoped(&app, &owner, &operation, request, &scope).await?,
    ))
}
/// Scope applies before grouped counts, membership and unread calculations. Read
/// markers are separately owned by the exact station/profile fingerprint.
pub async fn execute_scoped(
    app: &App,
    owner: &str,
    operation: &str,
    request: Request,
    scope: &crate::station::ResolvedScope,
) -> Result<Value> {
    let scoped_owner = format!("{owner}:scope:{}", scope.fingerprint);
    if scope.unrestricted() {
        return execute(&app.private.state, &scoped_owner, operation, request).await;
    }
    let mut allowed = std::collections::BTreeSet::new();
    for entry in crate::briefing::published(&app.custody).await? {
        if scope.matches(&entry["core"])?
            && let Some(key) = entry["messageKey"].as_str()
        {
            allowed.insert(key.to_owned());
        }
    }
    let store = &app.private.state;
    let mut visible = Vec::new();
    let mut scanned = 0;
    let mut after = None;
    loop {
        let mut query = json!({"size":100,"query":{"term":{"kind":"notification"}},"sort":[{"order":"desc"},"key"]});
        if let Some(cursor) = after {
            query["search_after"] = cursor;
        }
        let response = store.search(query).await?;
        let hits = response["hits"]["hits"]
            .as_array()
            .ok_or_else(Error::unavailable)?;
        scanned += hits.len();
        for doc in parse_command_state::hits(&response)? {
            let keep_members =
                operation == "members" && doc.record.payload["id"].as_i64() == request.id;
            if let Some(row) = scope_notice(doc.record, &allowed, keep_members)? {
                visible.push(row);
            }
        }
        if hits.len() < 100 {
            break;
        }
        if scanned > 5000 {
            return Err(Error::new(
                "resource_exhausted",
                "Scoped inbox exceeds retained notification bound",
            ));
        }
        after = hits.last().map(|h| h["sort"].clone());
    }
    visible.sort_by_key(|r| std::cmp::Reverse(r.order));
    let watermark = visible.iter().map(|r| r.order).max().unwrap_or(0);
    let read = store
        .get("notification_reads", &scoped_owner)
        .await?
        .map(|d| d.record.payload)
        .unwrap_or_else(|| json!({"through":0,"versions":{}}));
    match operation {
        "list" => {
            let before = request
                .before
                .map(|v| positive(Some(v)))
                .transpose()?
                .unwrap_or(i64::MAX);
            let unread = visible
                .iter()
                .filter(|r| {
                    r.order
                        > read["through"].as_i64().unwrap_or(0).max(
                            read["versions"][r.payload["id"].to_string()]
                                .as_i64()
                                .unwrap_or(0),
                        )
                })
                .count();
            let mut rows = visible
                .into_iter()
                .filter(|r| r.order < before)
                .collect::<Vec<_>>();
            let more = rows.len() > PAGE;
            rows.truncate(PAGE);
            let next = more.then(|| rows.last().map(|r| r.order)).flatten();
            let items = rows
                .into_iter()
                .map(|r| {
                    let mut p = r.payload;
                    let id = p["id"].to_string();
                    p.as_object_mut().map(|p| p.remove("members"));
                    p["version"] = json!(r.order);
                    p["unread"] = json!(
                        r.order
                            > read["through"]
                                .as_i64()
                                .unwrap_or(0)
                                .max(read["versions"][id].as_i64().unwrap_or(0))
                    );
                    p
                })
                .collect::<Vec<_>>();
            let catching_up = store
                .get("notification_status", "sync")
                .await?
                .is_none_or(|d| d.record.payload["catchingUp"] == true);
            Ok(
                json!({"items":items,"unread":unread,"watermark":watermark,"nextBefore":next,"catchingUp":catching_up}),
            )
        }
        "members" => {
            let id = positive(request.id)?;
            let row = visible
                .iter()
                .find(|r| r.payload["id"] == id)
                .ok_or_else(|| Error::invalid("Notification unavailable in this station scope"))?;
            let before = request
                .before
                .map(|v| positive(Some(v)))
                .transpose()?
                .unwrap_or(i64::MAX);
            let mut items = row.payload["members"]
                .as_object()
                .into_iter()
                .flat_map(|v| v.values())
                .filter(|v| v["version"].as_i64().is_some_and(|v| v < before))
                .cloned()
                .collect::<Vec<_>>();
            items.sort_by_key(|v| std::cmp::Reverse(v["version"].as_i64().unwrap_or(0)));
            let more = items.len() > PAGE;
            items.truncate(PAGE);
            let next = if more {
                items.last().map(|v| v["version"].clone())
            } else {
                None
            };
            Ok(json!({"items":items,"nextBefore":next}))
        }
        "read" => {
            if let Some(through) = request.through {
                if through > watermark {
                    return Err(Error::invalid("Invalid scope snapshot"));
                }
            } else {
                let id = positive(request.id)?;
                let version = positive(request.version)?;
                if !visible
                    .iter()
                    .any(|r| r.payload["id"] == id && version <= r.order)
                {
                    return Err(Error::invalid(
                        "Notification unavailable in this station scope",
                    ));
                }
            }
            execute(store, &scoped_owner, operation, request).await
        }
        _ => Err(Error::new("not_found", "Unknown notification operation")),
    }
}

fn scope_notice(
    mut row: Record,
    allowed: &std::collections::BTreeSet<String>,
    keep_members: bool,
) -> Result<Option<Record>> {
    if row.payload["kind"] == "traffic" {
        let mut members = row.payload["members"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        members.retain(|_, v| {
            v["messageKey"]
                .as_str()
                .is_some_and(|key| allowed.contains(key))
        });
        if members.is_empty() {
            return Ok(None);
        }
        row.order = members
            .values()
            .filter_map(|v| v["version"].as_i64())
            .max()
            .ok_or_else(Error::unavailable)?;
        row.payload["count"] = json!(members.len());
        let latest = members
            .values()
            .max_by_key(|v| v["version"].as_i64().unwrap_or(0))
            .ok_or_else(Error::unavailable)?;
        row.payload["at"] = latest["at"].clone();
        row.payload["context"] = if members.len() == 1 {
            latest["context"].clone()
        } else {
            json!("")
        };
        row.payload["messageKey"] = if members.len() == 1 {
            latest["messageKey"].clone()
        } else {
            json!("")
        };
        row.payload["members"] = if keep_members {
            json!(members)
        } else {
            json!({})
        };
    } else if !row.payload["messageKey"]
        .as_str()
        .is_some_and(|key| allowed.contains(key))
    {
        return Ok(None);
    }
    Ok(Some(row))
}
