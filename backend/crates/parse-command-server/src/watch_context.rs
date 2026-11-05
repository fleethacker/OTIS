//! App-wide demo context. Admin writes retain server actor; durable audit/CAS are deferred.
use crate::{Error, Result, access::require_admin, api::App, context_metadata::{self, Citation, Metadata}, private::now};
use axum::{Json, extract::{Path, State}, http::HeaderMap};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc, time::Duration};

pub const UNASSIGNED: &str = "unassigned:";
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Field { OwnShipId, ShipName, OperationName, GroupCommand, DefaultShips, TurnoverUtc }
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Context {
    pub own_ship_id: String,
    pub ship_name: String,
    pub operation_name: String,
    pub group_command: String,
    pub default_ships: Vec<String>,
    pub turnover_utc: Vec<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Confirmation {
    pub actor: String,
    pub recorded_at: String,
    pub sources: Vec<Citation>,
    pub confirmed_hide_unassigned: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Snapshot {
    pub context: Context,
    pub confirmations: BTreeMap<Field, Confirmation>,
    pub updated_by: Option<String>,
    pub updated_at: Option<String>,
    pub dismissed: Vec<String>,
}
#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Request {
    pub include_suggestions: bool,
    pub field: Option<Field>,
    pub values: Option<Vec<String>>,
    pub suggestion_id: Option<String>,
    pub dismiss: bool,
    pub confirm_hide_unassigned: bool,
}
pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS watch_context(singleton INTEGER PRIMARY KEY CHECK(singleton=1), document TEXT NOT NULL)")?;
    Ok(())
}
fn load(db: &Connection, demo: bool) -> Result<Snapshot> {
    let row: Option<String> = db.query_row("SELECT document FROM watch_context WHERE singleton=1", [], |r| r.get(0)).optional()?;
    if let Some(row) = row {
        if row.len() > 65536 { return Err(Error::config("Context exceeds storage bound")); }
        return serde_json::from_str(&row).map_err(|_| Error::config("Stored context is invalid"));
    }
    let roster = crate::commands::catalog(demo)?;
    Ok(Snapshot {
        context: Context {
            own_ship_id: roster.commands.iter().find(|c| c.is_own_ship).map(|c| c.id.clone()).unwrap_or_default(),
            ship_name: String::new(), operation_name: String::new(), group_command: String::new(),
            default_ships: roster.commands.iter().map(|c| format!("unit:{}", c.id)).chain([UNASSIGNED.into()]).collect(),
            turnover_utc: ["0000Z", "0400Z", "0800Z", "1200Z", "1600Z", "2000Z"].map(str::to_owned).to_vec(),
        },
        confirmations: BTreeMap::new(), updated_by: None, updated_at: None, dismissed: Vec::new(),
    })
}
/// Suppress stored IDs outside the active roster without rewriting user data.
fn visible(mut snapshot: Snapshot, demo: bool) -> Result<Snapshot> {
    let roster = crate::commands::catalog(demo)?;
    let known = |id: &str| roster.commands.iter().any(|c| c.id == id);
    if !known(&snapshot.context.own_ship_id) && !snapshot.context.own_ship_id.is_empty() {
        snapshot.context.own_ship_id.clear();
        snapshot.confirmations.remove(&Field::OwnShipId);
    }
    let old = snapshot.context.default_ships.len();
    snapshot.context.default_ships.retain(|id| id == UNASSIGNED || id.strip_prefix("unit:").is_some_and(known));
    if old != snapshot.context.default_ships.len() { snapshot.confirmations.remove(&Field::DefaultShips); }
    Ok(snapshot)
}
pub fn read(db: &Connection, demo: bool) -> Result<Snapshot> {
    visible(load(db, demo)?, demo)
}
fn values(field: Field, values: &[String], confirm: bool, demo: bool) -> Result<()> {
    let roster = crate::commands::catalog(demo)?;
    let known = |id: &str| roster.commands.iter().any(|c| c.id == id);
    if values.len() > 32 || values.iter().any(|v| v.len() > 128 || v.trim() != v || v.chars().any(char::is_control)) {
        return Err(Error::invalid("Context values exceed bounds or contain control characters"));
    }
    if confirm && (field != Field::DefaultShips || values.iter().any(|v| v == UNASSIGNED)) {
        return Err(Error::invalid("Hide confirmation is valid only for manually hidden Unassigned defaults"));
    }
    match field {
        Field::DefaultShips => {
            if values.iter().any(|v| v != UNASSIGNED && !v.strip_prefix("unit:").is_some_and(known)) {
                return Err(Error::invalid("Unknown default ship"));
            }
            if !values.iter().any(|v| v == UNASSIGNED) && !confirm {
                return Err(Error::config("Explicit confirmation is required to hide Unassigned"));
            }
        }
        Field::TurnoverUtc => {
            if values.is_empty() || values.len() > 24 || values.iter().any(|v| {
                let b = v.as_bytes();
                b.len() != 5 || b[4] != b'Z' || !b[..4].iter().all(u8::is_ascii_digit)
                    || &v[..2] > "23" || &v[2..4] > "59"
            }) { return Err(Error::invalid("Use UTC turnover times such as 0400Z")); }
        }
        _ => {
            if values.len() != 1 { return Err(Error::invalid("Exactly one context value is required")); }
            if field == Field::OwnShipId && !values[0].is_empty() && !known(&values[0]) {
                return Err(Error::invalid("Own ship must be selected manually from the roster"));
            }
        }
    }
    Ok(())
}
/// Called only after require_admin; actor is server identity, never request JSON.
pub fn update(db: &mut Connection, request: Request, actor: &str, metadata: &Metadata, demo: bool) -> Result<Snapshot> {
    if actor.is_empty() { return Err(Error::new("unauthenticated", "Missing actor")); }
    let tx = db.transaction()?;
    let mut snapshot = load(&tx, demo)?;
    let (field, mut selected, sources) = if let Some(id) = &request.suggestion_id {
        if request.field.is_some() || request.values.is_some() || request.confirm_hide_unassigned || id.len() > 128 {
            return Err(Error::invalid("Suggestions accept only suggestionId and optional dismiss"));
        }
        let suggestion = metadata.suggestions.iter().find(|s| &s.id == id)
            .ok_or_else(|| Error::config("Suggestion source is unavailable; refresh Settings"))?;
        if suggestion.field != "operationName" || suggestion.sources.is_empty() {
            return Err(Error::config("Suggestion lacks supported source evidence"));
        }
        if snapshot.dismissed.contains(id) { return Err(Error::config("Suggestion group was dismissed")); }
        if request.dismiss {
            if snapshot.dismissed.len() >= 200 { return Err(Error::config("Dismissed-group limit reached")); }
            snapshot.dismissed.push(id.clone());
        }
        (Field::OperationName, suggestion.values.clone(), suggestion.sources.clone())
    } else {
        if request.dismiss { return Err(Error::invalid("Dismiss requires a suggestion ID")); }
        (request.field.ok_or_else(|| Error::invalid("Missing field"))?, request.values.clone().ok_or_else(|| Error::invalid("Missing values"))?, Vec::new())
    };
    if !request.dismiss {
        values(field, &selected, request.confirm_hide_unassigned, demo)?;
        if matches!(field, Field::DefaultShips | Field::TurnoverUtc) { selected.sort(); selected.dedup(); }
        match field {
            Field::OwnShipId => snapshot.context.own_ship_id = selected[0].clone(),
            Field::ShipName => snapshot.context.ship_name = selected[0].clone(),
            Field::OperationName => snapshot.context.operation_name = selected[0].clone(),
            Field::GroupCommand => snapshot.context.group_command = selected[0].clone(),
            Field::DefaultShips => snapshot.context.default_ships = selected,
            Field::TurnoverUtc => snapshot.context.turnover_utc = selected,
        }
        snapshot.confirmations.insert(field, Confirmation {
            actor: actor.into(), recorded_at: now(), sources,
            confirmed_hide_unassigned: request.confirm_hide_unassigned,
        });
    }
    snapshot.updated_by = Some(actor.into());
    snapshot.updated_at = Some(now());
    let document = serde_json::to_string(&snapshot).map_err(|_| Error::unavailable())?;
    if document.len() > 65536 { return Err(Error::config("Context storage bound reached")); }
    let response = visible(snapshot, demo)?;
    tx.execute("INSERT INTO watch_context VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET document=excluded.document", [document])?;
    tx.commit()?;
    Ok(response)
}
static METADATA_READS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
async fn bounded_metadata<F>(read: F, duration: Duration) -> (Metadata, bool)
where F: FnOnce() -> Result<Metadata> + Send + 'static {
    let Ok(permit) = METADATA_READS.try_acquire() else { return (Metadata::default(), false); };
    // Timed-out readers retain their permit until they actually exit; leave the
    // remaining blocking workers free for context reads/writes.
    let job = tokio::task::spawn_blocking(move || { let _permit = permit; read() });
    match tokio::time::timeout(duration, job).await {
        Ok(Ok(Ok(metadata))) => (metadata, true),
        _ => (Metadata::default(), false),
    }
}
pub async fn handle(State(app): State<Arc<App>>, Path(operation): Path<String>, headers: HeaderMap, Json(request): Json<Request>) -> Result<Json<Value>> {
    let identity = if operation == "update" { require_admin(&app, &headers)? } else { app.headers_identity(&headers)? };
    if operation != "get" && operation != "update" { return Err(Error::new("not_found", "Unknown watch-context operation")); }
    if operation == "get" && (request.field.is_some() || request.values.is_some() || request.suggestion_id.is_some() || request.dismiss || request.confirm_hide_unassigned) {
        return Err(Error::invalid("Context get accepts only includeSuggestions"));
    }
    let needs_metadata = request.include_suggestions || request.suggestion_id.is_some();
    let (metadata, available) = if needs_metadata {
        let path = app.config.intake.journal.clone();
        bounded_metadata(move || context_metadata::read(&path), Duration::from_secs(7)).await
    } else { (Metadata::default(), false) };
    // Only the read-only suggestion job may outlive its deadline. Never time out a
    // blocking context transaction and let it commit after reporting failure.
    let value = tokio::task::spawn_blocking(move || {
        let demo = app.config.intake.demo_fixture_assignments;
        let identity = if operation == "update" { require_admin(&app, &headers)? } else { identity };
        let mut store = app.store()?;
        let snapshot = if operation == "update" {
            update(&mut store.db, request, &identity.username, &metadata, demo)?
        } else { read(&store.db, demo)? };
        let suggestions: Vec<_> = metadata.suggestions.iter().filter(|s| !snapshot.dismissed.contains(&s.id)).collect();
        Ok::<_, Error>(json!({
            "context": snapshot.context, "confirmations": snapshot.confirmations,
            "updatedBy": snapshot.updated_by, "updatedAt": snapshot.updated_at,
            "canEdit": identity.role == "platform_admin", "suggestions": suggestions,
            "suggestionState": if !needs_metadata { "not_requested" } else if available { "available" } else { "unavailable" },
            "suggestionsLimited": metadata.limited,
            "suggestionScope": "At most 200 published records, 400 metadata fields, 20 groups and 20 citations per group",
            "demoRoster": demo,
            "defaultsSource": if demo { parse_command_intake::demo::CONFIG_SOURCE } else { "Built-in UTC turnovers; no command roster configured" },
        }))
    }).await.map_err(|_| Error::unavailable())??;
    if value.to_string().len() > 2_097_152 { return Err(Error::new("resource_exhausted", "Context response exceeds bound")); }
    Ok(Json(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    // Existing context tests opt into the fictional roster explicitly.
    fn update(db: &mut Connection, request: Request, actor: &str, metadata: &Metadata) -> Result<Snapshot> {
        super::update(db, request, actor, metadata, true)
    }
    fn read(db: &Connection) -> Result<Snapshot> { super::read(db, true) }
    #[test]
    fn demo_off_has_no_own_ship_and_does_not_destroy_saved_demo_context() {
        let mut db = Connection::open_in_memory().unwrap(); initialize(&db).unwrap();
        assert_eq!(super::read(&db, false).unwrap().context.own_ship_id, "");
        assert_eq!(super::read(&db, false).unwrap().context.default_ships, [UNASSIGNED]);
        let metadata = Metadata::default();
        update(&mut db, manual(Field::OwnShipId, &["demo-meridian"], false), "server-admin", &metadata).unwrap();
        let hidden = super::read(&db, false).unwrap();
        assert_eq!(hidden.context.own_ship_id, "");
        assert!(!hidden.confirmations.contains_key(&Field::OwnShipId));
        assert!(super::update(&mut db, manual(Field::OwnShipId, &["demo-tern"], false), "server-admin", &metadata, false).is_err());
        super::update(&mut db, manual(Field::OperationName, &["MANUAL CONTEXT"], false), "server-admin", &metadata, false).unwrap();
        assert_eq!(read(&db).unwrap().context.own_ship_id, "demo-meridian");
    }
    #[tokio::test]
    async fn suggestion_timeout_does_not_block_context_reads_or_manual_writes() {
        let (release, blocked) = std::sync::mpsc::channel::<()>();
        let (metadata, available) = bounded_metadata(move || {
            blocked.recv().map_err(|_| Error::unavailable())?;
            Ok(Metadata::default())
        }, Duration::from_millis(1)).await;
        assert!(!available);
        let mut db = Connection::open_in_memory().unwrap(); initialize(&db).unwrap();
        let saved = update(&mut db, manual(Field::OperationName, &["MANUAL CONTEXT"], false), "server-admin", &metadata).unwrap();
        assert_eq!(saved.context.operation_name, "MANUAL CONTEXT");
        assert_eq!(read(&db).unwrap().updated_by.as_deref(), Some("server-admin"));
        release.send(()).unwrap();
    }
    fn manual(field: Field, values: &[&str], confirm: bool) -> Request {
        Request { field: Some(field), values: Some(values.iter().map(|v| (*v).into()).collect()), confirm_hide_unassigned: confirm, ..Request::default() }
    }
    #[test]
    fn manual_visibility_requires_confirmation_and_persists_server_actor() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let metadata = Metadata::default();
        assert!(update(&mut db, manual(Field::DefaultShips, &["unit:demo-tern"], false), "server-admin", &metadata).is_err());
        let saved = update(&mut db, manual(Field::DefaultShips, &["unit:demo-tern"], true), "server-admin", &metadata).unwrap();
        assert_eq!(saved.updated_by.as_deref(), Some("server-admin"));
        assert!(saved.confirmations[&Field::DefaultShips].confirmed_hide_unassigned);
        assert_eq!(read(&db).unwrap().context.default_ships, ["unit:demo-tern"]);
        assert!(update(&mut db, manual(Field::OwnShipId, &["sender-is-not-own-ship"], false), "server-admin", &metadata).is_err());
        assert!(update(&mut db, manual(Field::DefaultShips, &[UNASSIGNED], true), "server-admin", &metadata).is_err());
        assert!(update(&mut db, manual(Field::OperationName, &["FICTIONAL"], true), "server-admin", &metadata).is_err());
        assert!(update(&mut db, manual(Field::TurnoverUtc, &["2400Z"], false), "server-admin", &metadata).is_err());
        assert!(serde_json::from_str::<Request>(r#"{"field":"operationName","values":["FICTIONAL"],"actor":"spoof"}"#).is_err());
    }
    #[test]
    fn suggestion_ids_recompute_values_and_citations_and_dismiss_the_group() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let citation = Citation { message_key: "fictional@r1".into(), audit_id: "audit".into(), set_id: "EXER".into(), recorded_at: "2026-11-05T00:00:00Z".into(), start_byte: 0, end_byte: 8, line_start: 1, line_end: 1 };
        let metadata = Metadata { suggestions: vec![context_metadata::Suggestion { id: "context:fictional".into(), field: "operationName", values: vec!["FICTIONAL COPPER".into()], sources: vec![citation] }], limited: false };
        let mut request = Request { suggestion_id: Some("context:fictional".into()), ..Request::default() };
        let saved = update(&mut db, request, "server-admin", &metadata).unwrap();
        assert_eq!(saved.context.operation_name, "FICTIONAL COPPER");
        assert_eq!(saved.context.own_ship_id, "demo-meridian");
        assert!(saved.context.default_ships.iter().any(|v| v == UNASSIGNED));
        assert_eq!(saved.confirmations[&Field::OperationName].sources.len(), 1);
        request = Request { suggestion_id: Some("context:fictional".into()), field: Some(Field::OwnShipId), values: Some(vec!["demo-tern".into()]), ..Request::default() };
        assert!(update(&mut db, request, "server-admin", &metadata).is_err());
        request = Request { suggestion_id: Some("context:fictional".into()), dismiss: true, ..Request::default() };
        assert_eq!(update(&mut db, request, "another-admin", &metadata).unwrap().dismissed.len(), 1);
        assert_eq!(read(&db).unwrap().updated_by.as_deref(), Some("another-admin"));
    }
}
