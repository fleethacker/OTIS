//! Fictional bell-ringer workflow in hidden state. This is not a cross-domain guard.
pub mod model;
pub mod view;
use crate::{Error, Result, api::{App, Identity}, private::{now, text, timestamp}};
use axum::{extract::{Json, Path, State}, http::HeaderMap};
use model::{DeskNetwork, NoticePayload, ShipState, Waiting};
use parse_command_state::{Record, Store};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;

fn decode(row: &Record) -> parse_command_state::Result<ShipState> {
    serde_json::from_value(row.payload.clone()).map_err(|_| parse_command_state::Error("state_record"))
}
fn encode(row: &mut Record, state: &ShipState) -> parse_command_state::Result<()> {
    row.payload = serde_json::to_value(state).map_err(|_| parse_command_state::Error("state_record"))?;
    row.bytes = row.payload.to_string().len() as u64;
    if row.bytes > 2_097_152 { return Err(parse_command_state::Error("state_capacity")); }
    row.state = if state.episodes.last().is_some_and(|e| e.cleared_at.is_none()) { "open" } else { "cleared" }.into();
    Ok(())
}
pub async fn desk(store: &Store, owner: &str) -> Result<DeskNetwork> {
    let value = store.get("user", owner).await?.map(|d| d.record.payload["deskNetwork"].clone()).unwrap_or(Value::Null);
    if value.is_null() { return Ok(DeskNetwork::All); }
    serde_json::from_value(value).map_err(|_| Error::unavailable())
}
#[derive(Deserialize)]
struct Arrival {
    received_at: String,
    precedence: Option<parse_command_intake::network::Precedence>,
    command_ids: Vec<String>,
}
fn high(row: &Record) -> Result<Option<Arrival>> {
    if row.state != "published" || row.payload["arrivals"]["HIGH"].is_null() { return Ok(None); }
    let mut arrival: Arrival = serde_json::from_value(row.payload["arrivals"]["HIGH"].clone()).map_err(|_| Error::unavailable())?;
    arrival.received_at = timestamp(&arrival.received_at)?;
    let commands = row.payload["core"]["command_ids"].as_array();
    arrival.command_ids.retain(|id| !id.is_empty() && id.len() <= 120 && !id.chars().any(char::is_control) && commands.is_some_and(|v| v.iter().any(|c| c.as_str() == Some(id.as_str()))));
    arrival.command_ids.sort(); arrival.command_ids.dedup();
    if arrival.command_ids.len() > 32 { return Err(Error::unavailable()); }
    Ok(Some(arrival))
}
/// Called for successful publication and duplicate custody events. The stable
/// message membership is the replay marker, in the same CAS document as history.
pub async fn register(store: &Store, custody: &Store, key: &str) -> Result<()> {
    let Some(projection) = custody.get("projection", key).await? else { return Ok(()); };
    let Some(arrival) = high(&projection.record)? else { return Ok(()); };
    let copied = store.get("xnet_copy", key).await?.map(|d| text(&d.record.payload, "at").to_owned());
    let sent = now();
    for ship in arrival.command_ids {
        store.update("xnet_ship", &ship, |old| {
            let mut row = old.cloned().unwrap_or_else(|| Record::new("xnet_ship", &ship, json!({"episodes":[]})));
            let mut state = decode(&row)?;
            state.add(&ship, key, Waiting { at: arrival.received_at.clone(), precedence: arrival.precedence, copied_at: copied.clone() }, &sent)?;
            if let Some(at) = &copied { state.copied(key, at); }
            encode(&mut row, &state)?;
            Ok(row)
        }).await?;
    }
    Ok(())
}
pub async fn sync(store: &Store, custody: &Store) -> Result<()> {
    for copy in store.list("xnet_copy", vec![json!({"term":{"state":"pending"}})], 32).await? {
        register(store, custody, &copy.record.key).await?;
        complete_copy(store, &copy.record.key).await?;
    }
    for kind in ["publication_event", "custody_event"] {
        let old = store.get("xnet_cursor", kind).await?;
        let cursor = old.as_ref().map(|d| d.record.order).unwrap_or(0);
        let events = custody.list(kind, vec![json!({"range":{"order":{"gt":cursor}}})], 32).await?;
        for event in &events {
            let row = &event.record;
            if (kind == "publication_event" && row.category == "message" && row.state == "publication_succeeded")
                || (kind == "custody_event" && matches!(row.state.as_str(), "parsed" | "duplicate")) {
                register(store, custody, &row.source).await?;
            }
        }
        if let Some(last) = events.last() {
            let mut row = Record::new("xnet_cursor", kind, json!({})); row.order = last.record.order;
            store.put(&row, old.as_ref()).await?;
        }
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Notice {
    pub id: String,
    pub version: u64,
    pub payload: NoticePayload,
    pub sent_at: String,
    pub cleared_at: Option<String>,
    pub acknowledged_at: Option<String>,
    pub unread: bool,
}
pub async fn list(store: &Store, owner: &str) -> Result<Value> {
    if !desk(store, owner).await?.notices() { return Ok(json!({"items":[]})); }
    let rows = store.list("xnet_ship", vec![], 101).await?;
    if rows.len() > 100 { return Err(Error::new("resource_exhausted", "Fictional notice desk exceeds 100 ships")); }
    let mut items = Vec::new();
    for row in rows {
        let state = decode(&row.record)?;
        for episode in state.episodes {
            let ack = episode.acknowledgements.get(owner);
            items.push(Notice { id: episode.id.clone(), version: episode.version, payload: episode.payload(&row.record.key), sent_at: episode.sent_at.clone(), cleared_at: episode.cleared_at.clone(), acknowledged_at: ack.map(|a| a.at.clone()), unread: episode.cleared_at.is_none() && ack.is_none_or(|a| a.version < episode.version) });
        }
    }
    items.sort_by(|a, b| b.sent_at.cmp(&a.sent_at).then_with(|| a.id.cmp(&b.id)));
    let value = json!({"items":items});
    if value.to_string().len() > 2_097_152 { return Err(Error::new("resource_exhausted", "Fictional notice history exceeds response bound")); }
    Ok(value)
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub ship_id: Option<String>,
    pub id: Option<String>,
    pub version: Option<u64>,
    pub key: Option<String>,
}
pub async fn acknowledge(store: &Store, identity: &Identity, request: &Request) -> Result<Value> {
    let ship = request.ship_id.as_deref().filter(|s| !s.is_empty() && s.len() <= 120).ok_or_else(|| Error::invalid("Select a ship"))?;
    let id = request.id.as_deref().filter(|s| s.len() == 64).ok_or_else(|| Error::invalid("Select a notice"))?;
    let version = request.version.filter(|v| *v > 0).ok_or_else(|| Error::invalid("Select a notice version"))?;
    if !desk(store, &identity.owner).await?.notices() { return Err(Error::invalid("Use the LOW or ALL desk to acknowledge")); }
    let at = now();
    store.update("xnet_ship", ship, |old| {
        let mut row = old.cloned().ok_or(parse_command_state::Error("state_record"))?;
        let mut state = decode(&row)?;
        let episode = state.episodes.iter_mut().find(|e| e.id == id).ok_or(parse_command_state::Error("state_record"))?;
        episode.acknowledge(&identity.owner, &identity.username, &at, version)?;
        encode(&mut row, &state)?; Ok(row)
    }).await?;
    store.refresh().await?;
    Ok(json!({"saved":true}))
}
/// The UI calls this only after displaying a successfully fetched message. LOW
/// reads never copy. Identity and desk preference come from server state, not JSON.
async fn complete_copy(store: &Store, key: &str) -> Result<()> {
    store.update("xnet_copy", key, |old| {
        let mut row = old.cloned().ok_or(parse_command_state::Error("state_record"))?;
        row.state = "complete".into(); Ok(row)
    }).await?;
    Ok(())
}
pub async fn opened(store: &Store, custody: &Store, identity: &Identity, key: &str) -> Result<Value> {
    if !desk(store, &identity.owner).await?.copies() { return Ok(json!({"copied":false})); }
    let Some(projection) = custody.get("projection", key).await? else { return Ok(json!({"copied":false})); };
    if high(&projection.record)?.is_none() { return Ok(json!({"copied":false})); }
    let at = now();
    store.update("xnet_copy", key, |old| {
        Ok(old.cloned().unwrap_or_else(|| {
            let mut row = Record::new("xnet_copy", key, json!({"at":at})); row.owner = identity.owner.clone(); row.state = "pending".into(); row
        }))
    }).await?;
    // Replay also repairs partial multi-ship updates after a lost response.
    register(store, custody, key).await?;
    complete_copy(store, key).await?;
    store.refresh().await?;
    Ok(json!({"copied":true}))
}
pub async fn message(store: &Store, custody: &Store, owner: &str, key: &str) -> Result<Value> {
    let mut items = Vec::new();
    if desk(store, owner).await?.copies()
        && let Some(projection) = custody.get("projection", key).await?
        && let Some(arrival) = high(&projection.record)? {
        for ship in arrival.command_ids {
            if let Some(row) = store.get("xnet_ship", &ship).await? {
                for episode in decode(&row.record)?.episodes {
                    if episode.members.contains_key(key) {
                        let acknowledgements = episode.acknowledgements.values().map(|a| json!({"username":a.username,"at":a.at,"version":a.version})).collect::<Vec<_>>();
                        items.push(json!({"shipId":ship,"sentAt":episode.sent_at,"clearedAt":episode.cleared_at,"version":episode.version,"acknowledgements":acknowledgements}));
                    }
                }
            }
        }
    }
    Ok(json!({"items":items}))
}
pub async fn handle(State(app): State<Arc<App>>, Path(operation): Path<String>, headers: HeaderMap, Json(request): Json<Request>) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    let _guard = app.notification_sync.lock().await;
    let store = &app.private.state;
    let value = match operation.as_str() {
        "list" => list(store, &identity.owner).await?,
        "acknowledge" => acknowledge(store, &identity, &request).await?,
        "opened" | "message" => {
            let key = request.key.as_deref().ok_or_else(|| Error::invalid("Select a message"))?;
            app.scope(key).await?;
            if operation == "opened" { opened(store, &app.custody, &identity, key).await? }
            else { message(store, &app.custody, &identity.owner, key).await? }
        }
        _ => return Err(Error::new("not_found", "Unknown notice operation")),
    };
    Ok(Json(value))
}
