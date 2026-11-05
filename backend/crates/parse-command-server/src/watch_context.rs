//! Shared watch context. Admin changes retain verified actors and use document CAS.
use crate::{
    Error, Result,
    api::App,
    context_metadata::{self, Citation, Metadata},
    private::now,
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use parse_command_state::Store;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};

pub const UNASSIGNED: &str = "unassigned:";
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Field {
    OwnShipId,
    ShipName,
    OperationName,
    GroupCommand,
    DefaultShips,
    TurnoverUtc,
}
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
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ManualChange {
    pub field: Field,
    pub values: Vec<String>,
    #[serde(default)]
    pub confirm_hide_unassigned: bool,
}
#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Request {
    pub changes: Option<Vec<ManualChange>>,
    pub include_suggestions: bool,
    pub field: Option<Field>,
    pub values: Option<Vec<String>>,
    pub suggestion_id: Option<String>,
    pub dismiss: bool,
    pub confirm_hide_unassigned: bool,
}
fn defaults(demo: bool) -> Result<Snapshot> {
    let roster = crate::commands::catalog(demo)?;
    Ok(Snapshot {
        context: Context {
            own_ship_id: roster
                .commands
                .iter()
                .find(|c| c.is_own_ship)
                .map(|c| c.id.clone())
                .unwrap_or_default(),
            ship_name: String::new(),
            operation_name: String::new(),
            group_command: String::new(),
            default_ships: roster
                .commands
                .iter()
                .map(|c| format!("unit:{}", c.id))
                .chain([UNASSIGNED.into()])
                .collect(),
            turnover_utc: ["0000Z", "0400Z", "0800Z", "1200Z", "1600Z", "2000Z"]
                .map(str::to_owned)
                .to_vec(),
        },
        confirmations: BTreeMap::new(),
        updated_by: None,
        updated_at: None,
        dismissed: Vec::new(),
    })
}
/// Native command settings are authoritative. Keep citation and confirmation
/// metadata beside them in the same document so both settings interfaces use CAS.
fn from_settings(mut snapshot: Snapshot, settings: &crate::settings::Settings) -> Snapshot {
    let current = &snapshot.context;
    for (field, changed) in [
        (
            Field::OwnShipId,
            current.own_ship_id != settings.own_ship().unwrap_or_default(),
        ),
        (Field::ShipName, current.ship_name != settings.ship_name),
        (
            Field::OperationName,
            current.operation_name != settings.operation_name,
        ),
        (
            Field::GroupCommand,
            current.group_command != settings.group_command,
        ),
        (
            Field::DefaultShips,
            current.default_ships != settings.default_ships,
        ),
        (
            Field::TurnoverUtc,
            current.turnover_utc != settings.turnover_utc,
        ),
    ] {
        if changed {
            snapshot.confirmations.remove(&field);
        }
    }
    snapshot.context = Context {
        own_ship_id: settings.own_ship().unwrap_or_default().into(),
        ship_name: settings.ship_name.clone(),
        operation_name: settings.operation_name.clone(),
        group_command: settings.group_command.clone(),
        default_ships: settings.default_ships.clone(),
        turnover_utc: settings.turnover_utc.clone(),
    };
    snapshot
}
pub async fn read(store: &Store, demo: bool) -> Result<Snapshot> {
    let legacy = store.get("watch_context", "shared").await?;
    let mut snapshot = if let Some(doc) = legacy {
        serde_json::from_value(doc.record.payload).map_err(|_| Error::unavailable())?
    } else {
        defaults(demo)?
    };
    if let Some(doc) = store.get("settings", "shared").await? {
        if let Some(metadata) = doc.record.payload.get("watch_context") {
            snapshot =
                serde_json::from_value(metadata.clone()).map_err(|_| Error::unavailable())?;
        }
        let settings = crate::settings::Settings::load(doc.record.payload["settings"].clone())?;
        snapshot = from_settings(snapshot, &settings);
        snapshot.dismissed = doc.record.payload["dismissed"]
            .as_array()
            .map(|values| {
                values
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
    }
    Ok(snapshot)
}
/// Commit watch edits and evidence atomically with native settings and their audit.
pub async fn save(
    store: &Store,
    mut snapshot: Snapshot,
    before: &parse_command_state::Document,
    actor: &str,
) -> Result<Snapshot> {
    let mut settings = crate::settings::Settings::load(before.record.payload["settings"].clone())?;
    let own = &snapshot.context.own_ship_id;
    if settings.own_ship().unwrap_or_default() != own {
        if own.is_empty() {
            settings.command_ids.clear();
        } else {
            settings.command_ids.retain(|id| id != own);
            settings.command_ids.insert(0, own.clone());
        }
    }
    settings.ship_name = snapshot.context.ship_name.clone();
    settings.operation_name = snapshot.context.operation_name.clone();
    settings.group_command = snapshot.context.group_command.clone();
    settings.default_ships = snapshot.context.default_ships.clone();
    settings.turnover_utc = snapshot.context.turnover_utc.clone();
    settings.default_ships.sort();
    settings.default_ships.dedup();
    settings.turnover_utc.sort();
    settings.turnover_utc.dedup();
    settings.validate()?;
    snapshot = from_settings(snapshot, &settings);
    let mut row = before.record.clone();
    crate::settings::apply(
        &mut row.payload,
        &settings,
        actor,
        &crate::settings::revision(before),
        None,
    )?;
    row.payload["dismissed"] = json!(snapshot.dismissed);
    row.payload["watch_context"] = json!(snapshot);
    store.put(&row, Some(before)).await?;
    Ok(snapshot)
}
fn values(
    field: Field,
    values: &[String],
    confirm: bool,
    demo: bool,
    indexed: &[String],
) -> Result<()> {
    let roster = crate::commands::catalog(demo)?;
    let known = |id: &str| {
        indexed.iter().any(|c| c == id)
            || (field == Field::DefaultShips && roster.commands.iter().any(|c| c.id == id))
    };
    let max_bytes = match field {
        Field::OwnShipId => 256,
        Field::DefaultShips => 261,
        Field::ShipName => 120,
        _ => 128,
    };
    let max_values = if field == Field::DefaultShips { 33 } else { 32 };
    if values.len() > max_values
        || values
            .iter()
            .any(|v| v.len() > max_bytes || v.trim() != v || v.chars().any(char::is_control))
    {
        return Err(Error::invalid(
            "Context values exceed bounds or contain control characters",
        ));
    }
    if confirm && (field != Field::DefaultShips || values.iter().any(|v| v == UNASSIGNED)) {
        return Err(Error::invalid(
            "Hide confirmation is valid only for manually hidden Unassigned defaults",
        ));
    }
    match field {
        Field::DefaultShips => {
            if values
                .iter()
                .any(|v| v != UNASSIGNED && !v.strip_prefix("unit:").is_some_and(known))
            {
                return Err(Error::invalid("Unknown default ship"));
            }
            if !values.iter().any(|v| v == UNASSIGNED) && !confirm {
                return Err(Error::config(
                    "Explicit confirmation is required to hide Unassigned",
                ));
            }
        }
        Field::TurnoverUtc => {
            if values.is_empty()
                || values.len() > 24
                || values.iter().any(|v| {
                    let b = v.as_bytes();
                    b.len() != 5
                        || b[4] != b'Z'
                        || !b[..4].iter().all(u8::is_ascii_digit)
                        || &v[..2] > "23"
                        || &v[2..4] > "59"
                })
            {
                return Err(Error::invalid("Use UTC turnover times such as 0400Z"));
            }
        }
        _ => {
            if values.len() != 1 {
                return Err(Error::invalid("Exactly one context value is required"));
            }
            if field == Field::OwnShipId && !values[0].is_empty() && !known(&values[0]) {
                return Err(Error::invalid(
                    "Own ship must be selected manually from the roster",
                ));
            }
        }
    }
    Ok(())
}
/// Called only after require_admin; actor is server identity, never request JSON.
pub fn update(
    snapshot: Snapshot,
    request: Request,
    actor: &str,
    metadata: &Metadata,
    demo: bool,
) -> Result<Snapshot> {
    let commands = crate::commands::catalog(demo)?
        .commands
        .into_iter()
        .map(|c| c.id)
        .collect::<Vec<_>>();
    update_with_commands(snapshot, request, actor, metadata, demo, &commands)
}
/// The server supplies the same indexed command options used by native Settings.
pub fn update_with_commands(
    mut snapshot: Snapshot,
    request: Request,
    actor: &str,
    metadata: &Metadata,
    demo: bool,
    indexed: &[String],
) -> Result<Snapshot> {
    if actor.is_empty() {
        return Err(Error::new("unauthenticated", "Missing actor"));
    }
    let mut edits = Vec::new();
    if let Some(changes) = request.changes {
        if request.field.is_some()
            || request.values.is_some()
            || request.suggestion_id.is_some()
            || request.dismiss
            || request.confirm_hide_unassigned
        {
            return Err(Error::invalid(
                "Batch changes cannot be combined with another update action",
            ));
        }
        if changes.is_empty() || changes.len() > 6 {
            return Err(Error::invalid("Supply one to six changed fields"));
        }
        let mut seen = std::collections::BTreeSet::new();
        for change in changes {
            if !seen.insert(change.field) {
                return Err(Error::invalid("Duplicate context field"));
            }
            edits.push((
                change.field,
                change.values,
                Vec::new(),
                change.confirm_hide_unassigned,
            ));
        }
    } else if let Some(id) = &request.suggestion_id {
        if request.field.is_some()
            || request.values.is_some()
            || request.confirm_hide_unassigned
            || id.len() > 128
        {
            return Err(Error::invalid(
                "Suggestions accept only suggestionId and optional dismiss",
            ));
        }
        let suggestion = metadata
            .suggestions
            .iter()
            .find(|s| &s.id == id)
            .ok_or_else(|| Error::config("Suggestion source is unavailable; refresh Settings"))?;
        if suggestion.field != "operationName" || suggestion.sources.is_empty() {
            return Err(Error::config("Suggestion lacks supported source evidence"));
        }
        if snapshot.dismissed.contains(id) {
            return Err(Error::config("Suggestion group was dismissed"));
        }
        if request.dismiss {
            if snapshot.dismissed.len() >= 200 {
                return Err(Error::config("Dismissed-group limit reached"));
            }
            snapshot.dismissed.push(id.clone());
        }
        if !request.dismiss {
            edits.push((
                Field::OperationName,
                suggestion.values.clone(),
                suggestion.sources.clone(),
                false,
            ));
        }
    } else {
        if request.dismiss {
            return Err(Error::invalid("Dismiss requires a suggestion ID"));
        }
        edits.push((
            request
                .field
                .ok_or_else(|| Error::invalid("Missing field"))?,
            request
                .values
                .ok_or_else(|| Error::invalid("Missing values"))?,
            Vec::new(),
            request.confirm_hide_unassigned,
        ));
    }
    // All validation and writes share this transaction. A rejected field saves nothing.
    let recorded_at = now();
    for (field, mut selected, sources, confirm) in edits {
        values(field, &selected, confirm, demo, indexed)?;
        if matches!(field, Field::DefaultShips | Field::TurnoverUtc) {
            selected.sort();
            selected.dedup();
        }
        match field {
            Field::OwnShipId => snapshot.context.own_ship_id = selected[0].clone(),
            Field::ShipName => snapshot.context.ship_name = selected[0].clone(),
            Field::OperationName => snapshot.context.operation_name = selected[0].clone(),
            Field::GroupCommand => snapshot.context.group_command = selected[0].clone(),
            Field::DefaultShips => snapshot.context.default_ships = selected,
            Field::TurnoverUtc => snapshot.context.turnover_utc = selected,
        }
        snapshot.confirmations.insert(
            field,
            Confirmation {
                actor: actor.into(),
                recorded_at: recorded_at.clone(),
                sources,
                confirmed_hide_unassigned: confirm,
            },
        );
    }
    snapshot.updated_by = Some(actor.into());
    snapshot.updated_at = Some(recorded_at);
    let document = serde_json::to_string(&snapshot).map_err(|_| Error::unavailable())?;
    if document.len() > 65536 {
        return Err(Error::config("Context storage bound reached"));
    }
    Ok(snapshot)
}
async fn scoped(
    mut snapshot: Snapshot,
    app: &App,
    scope: &crate::station::ResolvedScope,
) -> Result<Snapshot> {
    snapshot.context.default_ships.retain(|id| {
        if id == UNASSIGNED {
            scope.include_unassigned && !scope.match_none
        } else {
            id.strip_prefix("unit:")
                .is_some_and(|id| scope.command_visible(id))
        }
    });
    if !scope.command_visible(&snapshot.context.own_ship_id) {
        snapshot.context.own_ship_id.clear();
        snapshot.context.ship_name.clear();
        snapshot.confirmations.remove(&Field::OwnShipId);
        snapshot.confirmations.remove(&Field::ShipName);
    }
    let mut hidden = Vec::new();
    for (field, confirmation) in &mut snapshot.confirmations {
        if confirmation.sources.is_empty() {
            continue;
        }
        let mut allowed = Vec::new();
        for citation in &confirmation.sources {
            if let Ok(Some(doc)) = app.custody.get("projection", &citation.message_key).await
                && doc.record.state == "published"
                && scope.matches(&doc.record.payload["core"]).unwrap_or(false)
            {
                allowed.push(citation.clone());
            }
        }
        confirmation.sources = allowed;
        if confirmation.sources.is_empty() {
            hidden.push(*field);
        }
    }
    for field in hidden {
        snapshot.confirmations.remove(&field);
        match field {
            Field::OwnShipId => snapshot.context.own_ship_id.clear(),
            Field::ShipName => snapshot.context.ship_name.clear(),
            Field::OperationName => snapshot.context.operation_name.clear(),
            Field::GroupCommand => snapshot.context.group_command.clear(),
            Field::DefaultShips => snapshot.context.default_ships.clear(),
            Field::TurnoverUtc => snapshot.context.turnover_utc.clear(),
        }
    }
    Ok(snapshot)
}
pub async fn handle(
    State(app): State<Arc<App>>,
    Path(operation): Path<String>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    if operation != "get" && operation != "update" {
        return Err(Error::new("not_found", "Unknown context operation"));
    }
    if operation == "update" {
        crate::settings::admin(&identity)?;
    }
    if operation == "get"
        && (request.changes.is_some()
            || request.field.is_some()
            || request.values.is_some()
            || request.suggestion_id.is_some()
            || request.dismiss
            || request.confirm_hide_unassigned)
    {
        return Err(Error::invalid(
            "Context get accepts only includeSuggestions",
        ));
    }
    let effective = crate::station::effective_scope(&app.private, &identity.owner).await?;
    let needs_metadata = request.include_suggestions || request.suggestion_id.is_some();
    let metadata = if needs_metadata {
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            context_metadata::read_scoped(&app.custody, &effective),
        )
        .await
        .ok()
        .and_then(Result::ok)
    } else {
        None
    };
    let available = metadata.is_some();
    let metadata = metadata.unwrap_or_default();
    let demo = app.config.intake.demo_fixture_assignments;
    let snapshot = if operation == "update" {
        let (_, before) = crate::settings::shared(&app.private.state).await?;
        let old = read(&app.private.state, demo).await?;
        let touches_commands = request
            .field
            .is_some_and(|f| matches!(f, Field::OwnShipId | Field::DefaultShips))
            || request.changes.as_ref().is_some_and(|changes| {
                changes
                    .iter()
                    .any(|c| matches!(c.field, Field::OwnShipId | Field::DefaultShips))
            });
        let options = if touches_commands {
            crate::settings::command_options(&app).await?
        } else {
            Vec::new()
        };
        let snapshot =
            update_with_commands(old, request, &identity.owner, &metadata, demo, &options)?;
        save(&app.private.state, snapshot, &before, &identity.owner).await?
    } else {
        read(&app.private.state, demo).await?
    };
    let snapshot = scoped(snapshot, &app, &effective).await?;
    let suggestions: Vec<_> = metadata
        .suggestions
        .iter()
        .filter(|s| !snapshot.dismissed.contains(&s.id))
        .collect();
    Ok(Json(
        json!({"context":snapshot.context,"confirmations":snapshot.confirmations,"updatedBy":snapshot.updated_by,"updatedAt":snapshot.updated_at,"canEdit":identity.role=="admin","suggestions":suggestions,"suggestionState":if !needs_metadata{"not_requested"}else if available{"available"}else{"unavailable"},"suggestionsLimited":metadata.limited,"suggestionScope":"At most 200 published records, 400 metadata fields, 20 groups and 20 citations per group","demoRoster":demo,"defaultsSource":if demo{parse_command_intake::demo::CONFIG_SOURCE}else{"Built-in UTC turnovers; no command roster configured"}}),
    ))
}
