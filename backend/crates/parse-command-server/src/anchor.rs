//! Explicit message history, projected into the existing shared task workflow.
use crate::{
    Error, Result,
    anchor_lineage::{self, CurrentEvent, DeclaredVersion, Interval, Relationship, Status},
    api::{App, Identity},
    private::{now, text, timestamp},
    work::{self, Decision, SourceRef, Task, Workflow},
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

pub const EVENT: &str = "meridian-2026-11-10:original";
const COVERAGE: &str =
    "Explicitly declared Meridian ANCHOR event only; not a complete operational schedule";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub source_excerpt: String,
    pub source_status: String,
    pub fact_status: String,
    pub review_flags: Vec<String>,
    pub source_contacts: Value,
    pub source_type: String,
    pub command_ids: Vec<String>,
    pub declared_by: String,
    pub recorded_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventHistory {
    pub versions: Vec<DeclaredVersion>,
    pub evidence: BTreeMap<String, Evidence>,
    pub original_action: String,
    pub review_due_at: Option<String>,
    pub review_due_basis: String,
    pub applied_token: Option<String>,
    pub applied_status: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lineage {
    pub events: BTreeMap<String, EventHistory>,
}

pub fn lineage(workflow: &Workflow) -> Result<Lineage> {
    match workflow.extensions.get("lineage") {
        None | Some(Value::Null) => Ok(Lineage::default()),
        Some(value) => {
            let lineage: Lineage = serde_json::from_value(value.clone())
                .map_err(|_| Error::config("ANCHOR history schema is unavailable"))?;
            if lineage.events.len() > 1 || lineage.events.keys().any(|key| key != EVENT) {
                return Err(Error::config("Unsupported ANCHOR event history"));
            }
            Ok(lineage)
        }
    }
}

fn put_lineage(workflow: &mut Workflow, lineage: &Lineage) -> Result<()> {
    if !workflow.extensions.is_object() {
        return Err(Error::config("Workflow extensions must be an object"));
    }
    workflow.extensions["lineage"] =
        serde_json::to_value(lineage).map_err(|_| Error::unavailable())?;
    Ok(())
}

pub fn current_view(workflow: &Workflow, event_id: &str) -> Result<Option<CurrentEvent>> {
    Ok(lineage(workflow)?.events.get(event_id).map(|history| {
        anchor_lineage::resolve(event_id, &history.versions, &workflow.scenario_now)
    }))
}

pub fn current_views(workflow: &Workflow) -> Result<Vec<CurrentEvent>> {
    Ok(lineage(workflow)?
        .events
        .iter()
        .map(|(id, history)| anchor_lineage::resolve(id, &history.versions, &workflow.scenario_now))
        .collect())
}

pub async fn authorize_event(app: &App, actor: &Identity, view: &CurrentEvent) -> Result<()> {
    work::active(app, actor).await?;
    if view.history.is_empty() {
        return Err(Error::unavailable());
    }
    let keys = view
        .history
        .iter()
        .map(|v| v.source.message_key.as_str())
        .collect::<BTreeSet<_>>();
    for key in keys {
        app.scope_for_owner(key, &actor.owner).await?;
    }
    // Raw declarations survive early resolver failures and may include newer links.
    if let Some((_, workflow)) = work::load(app).await?
        && let Some(history) = lineage(&workflow)?.events.get(&view.logical_event_id)
    {
        authorize_history(app, actor, history).await?;
    }
    Ok(())
}

async fn authorize_history(app: &App, actor: &Identity, history: &EventHistory) -> Result<()> {
    work::active(app, actor).await?;
    let keys = history
        .versions
        .iter()
        .map(|v| v.source.message_key.as_str())
        .collect::<BTreeSet<_>>();
    for key in keys {
        app.scope_for_owner(key, &actor.owner).await?;
    }
    Ok(())
}

/// Covers raw declarations even when an early validation failure gives no resolved history.
pub async fn authorize_task(app: &App, actor: &Identity, task: &Task) -> Result<()> {
    work::active(app, actor).await?;
    app.scope_for_owner(&task.source.message_key, &actor.owner)
        .await?;
    if let Some((_, workflow)) = work::load(app).await?
        && let Some(history) = lineage(&workflow)?.events.get(&task.logical_event_id)
    {
        authorize_history(app, actor, history).await?;
    }
    Ok(())
}

fn reviewable(view: &CurrentEvent) -> bool {
    matches!(view.status, Status::Active | Status::Cancelled) && view.current.is_some()
}

fn projected_current(task: &Task, view: &CurrentEvent) -> bool {
    view.current.as_ref().is_some_and(|current| {
        task.source.message_key == current.source.message_key
            && task.source.fact_id == current.source.fact_id
    })
}

/// Re-resolve inside the shared workflow CAS before any current-version decision.
pub fn validate_decision(workflow: &Workflow, task_id: &str, token: Option<&str>) -> Result<()> {
    let task = workflow
        .tasks
        .get(task_id)
        .ok_or_else(|| Error::new("not_found", "Task not found"))?;
    if let Some(view) = current_view(workflow, &task.logical_event_id)? {
        if !reviewable(&view) || token.is_none() || token != view.version_token.as_deref() {
            return Err(Error::new(
                "aborted",
                "Current event version changed or is unresolved; reload before deciding",
            ));
        }
        let current = view.current.as_ref().ok_or_else(Error::unavailable)?;
        if task.source.message_key != current.source.message_key
            || task.source.fact_id != current.source.fact_id
        {
            return Err(Error::new(
                "aborted",
                "Task projection changed; reload before deciding",
            ));
        }
    }
    Ok(())
}

pub fn decorate_task(workflow: &Workflow, task: &Task, item: &mut Value) -> Result<()> {
    if let Some(view) = current_view(workflow, &task.logical_event_id)? {
        item["currentVersionToken"] = json!(view.version_token);
        item["instructionStatus"] = json!(view.status);
        item["remindersActive"] =
            json!(view.status == Status::Active && task.due_at.is_some() && !work::reviewed(task));
        item["currentEvent"] = view_data(workflow, &view)?;
        item["currentEvent"]["canReview"] =
            json!(item["canAct"] == true && reviewable(&view) && projected_current(task, &view));
        if !reviewable(&view) {
            item["canAct"] = json!(false);
            item["reviewed"] = json!(false);
            item["overdue"] = json!(false);
        }
    }
    Ok(())
}

fn view_data(workflow: &Workflow, view: &CurrentEvent) -> Result<Value> {
    let lineage = lineage(workflow)?;
    let history = lineage
        .events
        .get(&view.logical_event_id)
        .ok_or_else(Error::unavailable)?;
    let mut item = json!(view);
    item["evidence"] = json!(history.evidence);
    if let Some(task) = workflow
        .tasks
        .values()
        .find(|task| task.logical_event_id == view.logical_event_id)
    {
        item["taskId"] = json!(task.id);
        item["taskVersion"] = json!(task.version);
        item["eventVersion"] = json!(task.event_version);
        item["reviewed"] =
            json!(reviewable(view) && projected_current(task, view) && work::reviewed(task));
        item["reviews"] = json!(task.reviews);
        item["responsibilityName"] = json!(task.responsibility_name);
        item["ownerName"] = json!(task.owner_name);
    }
    Ok(item)
}

/// Same DTO for /current, reader, and calendar. Authorize all sources before calling.
pub fn event_view(workflow: &Workflow, actor: &Identity, view: &CurrentEvent) -> Result<Value> {
    let mut item = view_data(workflow, view)?;
    item["canReview"] = json!(
        reviewable(view)
            && workflow
                .tasks
                .values()
                .find(|task| task.logical_event_id == view.logical_event_id)
                .is_some_and(|task| projected_current(task, view) && work::can_act(task, actor))
    );
    Ok(item)
}

fn status_name(status: &Status) -> &'static str {
    match status {
        Status::Active => "active",
        Status::Cancelled => "cancelled",
        Status::Pending => "pending",
        Status::Unresolved => "unresolved",
    }
}

fn path_depth(view: &CurrentEvent) -> Result<u64> {
    let mut current = view.current.as_ref().ok_or_else(Error::unavailable)?;
    let mut depth = 1;
    loop {
        let target = match &current.relationship {
            Relationship::Original => return Ok(depth),
            Relationship::Amends { target } | Relationship::Cancels { target } => target,
        };
        current = view
            .history
            .iter()
            .find(|v| &v.id == target)
            .ok_or_else(Error::unavailable)?;
        depth += 1;
        if depth > anchor_lineage::MAX_VERSIONS as u64 {
            return Err(Error::unavailable());
        }
    }
}

/// Derived transitions share the workflow CAS. The original task ID/owner survive.
pub fn reconcile(workflow: &mut Workflow, actor: &str, recorded_at: &str) -> Result<bool> {
    let mut lineage = lineage(workflow)?;
    let mut changed = false;
    for (event_id, history) in &mut lineage.events {
        let view = anchor_lineage::resolve(event_id, &history.versions, &workflow.scenario_now);
        let status = status_name(&view.status);
        if history.applied_status.as_deref() == Some(status)
            && history.applied_token == view.version_token
        {
            continue;
        }
        let task = workflow
            .tasks
            .values_mut()
            .find(|task| &task.logical_event_id == event_id)
            .ok_or_else(|| Error::config("ANCHOR history has no source task"))?;
        if task.history.len() >= 256 {
            return Err(Error::new(
                "resource_exhausted",
                "Task decision history is full",
            ));
        }
        let first_install = history.applied_status.is_none();
        let before = json!({"source":task.source,"eventVersion":task.event_version,"start":task.start,"end":task.end,"progress":task.progress,"dueAt":task.due_at,"currentVersionToken":history.applied_token,"instructionStatus":history.applied_status});
        if let Some(current) = &view.current {
            let evidence = history
                .evidence
                .get(&current.id)
                .ok_or_else(|| Error::config("ANCHOR source evidence is missing"))?;
            task.source = SourceRef {
                message_key: current.source.message_key.clone(),
                fact_id: current.source.fact_id.clone(),
            };
            task.event_version = path_depth(&view)?;
            task.source_excerpt = evidence.source_excerpt.clone();
            task.source_contacts = evidence.source_contacts.clone();
            task.source_status = evidence.source_status.clone();
            task.fact_status = evidence.fact_status.clone();
            task.review_flags = evidence.review_flags.clone();
        }
        task.start = view
            .scheduling_interval()
            .map(|interval| interval.start.clone());
        task.end = view
            .scheduling_interval()
            .map(|interval| interval.end.clone());
        if view.status == Status::Active {
            task.action = history.original_action.clone();
            task.due_at = history.review_due_at.clone();
            task.due_basis = history.review_due_basis.clone();
        } else {
            task.due_at = None;
            task.due_basis =
                "Obsolete event reminders stopped; no new review deadline is declared".into();
            task.action = match view.status {
                Status::Cancelled => {
                    "Review cancellation of MERIDIAN COMMS; affected event withdrawn"
                }
                Status::Pending => "Await effective MERIDIAN COMMS instruction",
                _ => "Resolve MERIDIAN COMMS history; current version unresolved",
            }
            .into();
        }
        if !first_install {
            task.progress = "not_started".into();
        }
        history.applied_token = view.version_token;
        history.applied_status = Some(status.into());
        if !first_install {
            task.version += 1;
            task.history.push(Decision {
                actor: actor.into(), recorded_at: recorded_at.into(), action: "instruction_changed".into(),
                reason: "Explicit source relationship became current; previous reviews and progress remain in history. Internal review does not complete or validate the event.".into(),
                before,
                after: json!({"source":task.source,"eventVersion":task.event_version,"start":task.start,"end":task.end,"progress":task.progress,"dueAt":task.due_at,"currentVersionToken":history.applied_token,"instructionStatus":status}),
            });
        }
        changed = true;
    }
    if changed {
        put_lineage(workflow, &lineage)?;
    }
    Ok(changed)
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub expected_version: Option<u64>,
    pub message_key: Option<String>,
    pub logical_event_id: Option<String>,
    pub version_id: Option<String>,
    pub source: Option<SourceRef>,
    pub relationship: Option<Relationship>,
    pub effective_at: Option<String>,
    pub provenance: Option<String>,
}

fn identifier(value: Option<&str>, field: &str) -> Result<String> {
    let value = value.unwrap_or("");
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_:.".contains(&b))
    {
        return Err(Error::invalid(format!(
            "{field} requires 1–128 letters, digits, dash, underscore, colon or dot"
        )));
    }
    Ok(value.into())
}

fn expected(request: &Request, workflow: &Workflow) -> Result<()> {
    if request.expected_version != Some(workflow.version) {
        return Err(Error::new(
            "aborted",
            "Shared workflow changed; reload before declaring history",
        ));
    }
    Ok(())
}

struct Declaration {
    id: String,
    source: SourceRef,
    relationship: Relationship,
    effective_at: String,
    provenance: String,
}

async fn source_version(
    app: &App,
    actor: &Identity,
    declaration: Declaration,
    recorded_at: &str,
) -> Result<(DeclaredVersion, Evidence)> {
    let Declaration {
        id,
        source,
        relationship,
        effective_at,
        provenance,
    } = declaration;
    app.scope_for_owner(&source.message_key, &actor.owner)
        .await?;
    let (content_id, revision) = crate::search::split_key(&source.message_key)?;
    let core = app.search.canonical(content_id, revision).await?;
    if core["type"] != "OPTASK COMMS"
        || !core["command_ids"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|id| id == work::COMMAND))
    {
        return Err(Error::invalid(
            "This ANCHOR slice requires a parsed Meridian OPTASK COMMS source",
        ));
    }
    let cancellation = matches!(relationship, Relationship::Cancels { .. });
    if cancellation && source.fact_id.is_some() {
        return Err(Error::invalid(
            "Cancellation references the source message; factId must be null",
        ));
    }
    let fact = if cancellation {
        None
    } else {
        let fact_id = source
            .fact_id
            .as_deref()
            .filter(|v| !v.is_empty())
            .ok_or_else(|| Error::invalid("Select the exact source fact to replace"))?;
        Some(
            core["activities"]
                .as_array()
                .and_then(|facts| {
                    facts.iter().find(|fact| {
                        fact["id"] == fact_id
                            && fact["type"] == "communications_plan_window"
                            && fact["plan"] == "MERIDIAN COMMS"
                    })
                })
                .ok_or_else(|| {
                    Error::invalid("Selected source fact is not the supported MERIDIAN COMMS event")
                })?,
        )
    };
    let interval = match fact {
        Some(fact) => match (fact["start_at"].as_str(), fact["end_at"].as_str()) {
            (Some(start), Some(end)) => Some(Interval {
                start: timestamp(start)?,
                end: timestamp(end)?,
            }),
            _ => None,
        },
        None => None,
    };
    let detail = app.detail(&source.message_key).await?;
    if detail["meta"]["evidenceState"] != "available" {
        return Err(Error::config(
            "Parsed source evidence is still pending publication",
        ));
    }
    let review_flags = core["review_flags"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect::<Vec<_>>();
    let source_status = text(&core, "status").to_owned();
    let fact_status = fact
        .map(|fact| text(fact, "status"))
        .unwrap_or("not_applicable")
        .to_owned();
    Ok((
        DeclaredVersion {
            id,
            source: anchor_lineage::SourceRef {
                message_key: source.message_key.clone(),
                content_hash: content_id.into(),
                fact_id: source.fact_id.clone(),
            },
            relationship,
            effective_at,
            interval,
            provenance,
            parsed_review_required: source_status != "validated"
                || fact_status != "validated"
                || !review_flags.is_empty(),
        },
        Evidence {
            source_excerpt: text(&detail["messages"][0], "rawText")
                .chars()
                .take(2000)
                .collect(),
            source_status,
            fact_status,
            review_flags,
            source_contacts: core["contacts"].clone(),
            source_type: text(&core, "type").into(),
            command_ids: core["command_ids"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
            declared_by: actor.owner.clone(),
            recorded_at: recorded_at.into(),
        },
    ))
}

async fn setup(app: &App, actor: &Identity, request: &Request) -> Result<Value> {
    crate::settings::admin(actor)?;
    if app.config.auth.mode != "local_demo" {
        return Err(Error::config(
            "Synthetic ANCHOR setup requires local-demo authentication",
        ));
    }
    let (doc, mut workflow) = work::load(app)
        .await?
        .ok_or_else(|| Error::config("Set up and ingest Agent 1's task workflow first"))?;
    let mut lineage = lineage(&workflow)?;
    if let Some(history) = lineage.events.get(EVENT) {
        authorize_history(app, actor, history).await?;
        return Ok(json!({"configured":true,"version":workflow.version}));
    }
    expected(request, &workflow)?;
    let task = workflow
        .tasks
        .values()
        .find(|task| task.logical_event_id == EVENT)
        .ok_or_else(|| Error::config("Original Meridian task is not yet available"))?;
    work::authorize_source(app, actor, task).await?;
    let at = now();
    let (original, evidence) = source_version(
        app,
        actor,
        Declaration {
            source: task.source.clone(),
            id: "original".into(),
            relationship: Relationship::Original,
            effective_at: timestamp("2026-11-10T08:00:00Z")?,
            provenance: "Explicit original from the authored Meridian synthetic scenario".into(),
        },
        &at,
    )
    .await?;
    lineage.events.insert(
        EVENT.into(),
        EventHistory {
            versions: vec![original],
            evidence: BTreeMap::from([("original".into(), evidence)]),
            original_action: task.action.clone(),
            review_due_at: task.due_at.clone(),
            review_due_basis: task.due_basis.clone(),
            applied_token: None,
            applied_status: None,
        },
    );
    put_lineage(&mut workflow, &lineage)?;
    reconcile(&mut workflow, &actor.owner, &at)?;
    workflow.version += 1;
    work::save(app, &doc, &workflow).await?;
    let view = current_view(&workflow, EVENT)?.ok_or_else(Error::unavailable)?;
    Ok(
        json!({"configured":true,"version":workflow.version,"item":event_view(&workflow, actor, &view)?}),
    )
}

async fn declare(app: &App, actor: &Identity, request: &Request) -> Result<Value> {
    crate::settings::admin(actor)?;
    let (doc, mut workflow) = work::load(app)
        .await?
        .ok_or_else(|| Error::config("Set up the shared workflow first"))?;
    let event_id = identifier(request.logical_event_id.as_deref(), "logicalEventId")?;
    if event_id != EVENT {
        return Err(Error::invalid(
            "This ANCHOR slice manages only the original Meridian event",
        ));
    }
    let mut lineage = lineage(&workflow)?;
    let history = lineage
        .events
        .get_mut(&event_id)
        .ok_or_else(|| Error::config("Set up the ANCHOR original first"))?;
    authorize_history(app, actor, history).await?;
    let id = identifier(request.version_id.as_deref(), "versionId")?;
    let relationship = request
        .relationship
        .clone()
        .ok_or_else(|| Error::invalid("Explicit amends/cancels relationship is required"))?;
    match &relationship {
        Relationship::Original => {
            return Err(Error::invalid(
                "An original is already registered; use an explicit relationship",
            ));
        }
        Relationship::Amends { target } | Relationship::Cancels { target } => {
            identifier(Some(target), "relationship target")?;
        }
    }
    let effective = timestamp(request.effective_at.as_deref().unwrap_or(""))?;
    if !effective.starts_with("2026-11-10T") {
        return Err(Error::invalid(
            "Synthetic effective time must be on November 10, 2026 UTC",
        ));
    }
    let provenance = request.provenance.as_deref().unwrap_or("").trim();
    if provenance.is_empty() || provenance.len() > 1000 || provenance.chars().any(char::is_control)
    {
        return Err(Error::invalid(
            "Provide explicit relationship provenance of 1–1000 bytes without control characters",
        ));
    }
    let source = request
        .source
        .clone()
        .ok_or_else(|| Error::invalid("Exact source reference is required"))?;
    let at = now();
    let (version, evidence) = source_version(
        app,
        actor,
        Declaration {
            source,
            id,
            relationship,
            effective_at: effective,
            provenance: provenance.into(),
        },
        &at,
    )
    .await?;
    if let Some(existing) = history.versions.iter().find(|old| old.id == version.id) {
        if existing != &version {
            return Err(Error::new(
                "aborted",
                "Version ID already has a different immutable declaration",
            ));
        }
        let view = current_view(&workflow, &event_id)?.ok_or_else(Error::unavailable)?;
        return Ok(
            json!({"configured":true,"duplicate":true,"version":workflow.version,"item":event_view(&workflow, actor, &view)?}),
        );
    }
    expected(request, &workflow)?;
    if history.versions.len() >= anchor_lineage::MAX_VERSIONS {
        return Err(Error::new(
            "resource_exhausted",
            "ANCHOR history capacity reached",
        ));
    }
    history.evidence.insert(version.id.clone(), evidence);
    history.versions.push(version);
    put_lineage(&mut workflow, &lineage)?;
    reconcile(&mut workflow, &actor.owner, &at)?;
    workflow.version += 1;
    work::save(app, &doc, &workflow).await?;
    let view = current_view(&workflow, &event_id)?.ok_or_else(Error::unavailable)?;
    Ok(
        json!({"configured":true,"duplicate":false,"version":workflow.version,"item":event_view(&workflow, actor, &view)?}),
    )
}

async fn current(app: &App, actor: &Identity, request: &Request) -> Result<Value> {
    if let Some(key) = &request.message_key {
        app.scope_for_owner(key, &actor.owner).await?;
    }
    let Some((_, workflow)) = work::load(app).await? else {
        return Ok(
            json!({"configured":false,"complete":false,"coverage":COVERAGE,"items":[],"version":0,"scenarioNow":work::INITIAL_NOW,"scenarioId":work::SCENARIO,"canCoordinate":actor.role=="admin"}),
        );
    };
    let lineage = lineage(&workflow)?;
    let configured = !lineage.events.is_empty();
    let mut complete = configured;
    let mut items = Vec::new();
    for (event_id, history) in &lineage.events {
        if request.message_key.as_ref().is_some_and(|key| {
            !history
                .versions
                .iter()
                .any(|v| &v.source.message_key == key)
        }) {
            continue;
        }
        match authorize_history(app, actor, history).await {
            Ok(()) => {}
            Err(error) if matches!(error.code, "permission_denied" | "not_found") => {
                complete = false;
                continue;
            }
            Err(error) => return Err(error),
        }
        let view = anchor_lineage::resolve(event_id, &history.versions, &workflow.scenario_now);
        if !reviewable(&view)
            || (view.status == Status::Active && view.scheduling_interval().is_none())
        {
            complete = false;
        }
        items.push(event_view(&workflow, actor, &view)?);
    }
    Ok(
        json!({"configured":configured,"complete":complete,"coverage":COVERAGE,"items":items,"version":workflow.version,"scenarioNow":workflow.scenario_now,"scenarioId":work::SCENARIO,"canCoordinate":actor.role=="admin"}),
    )
}

pub async fn execute(
    app: &App,
    actor: &Identity,
    operation: &str,
    request: Request,
) -> Result<Value> {
    work::active(app, actor).await?;
    match operation {
        "current" => current(app, actor, &request).await,
        "setup" => setup(app, actor, &request).await,
        "declare" => declare(app, actor, &request).await,
        _ => Err(Error::new("not_found", "Unknown ANCHOR operation")),
    }
}

pub async fn handle(
    State(app): State<Arc<App>>,
    Path(operation): Path<String>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Result<Json<Value>> {
    let actor = app.headers_identity(&headers).await?;
    Ok(Json(execute(&app, &actor, &operation, request).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    const AT: &str = "2026-11-05T12:00:00Z";

    fn fixture() -> Workflow {
        let binding = work::Binding {
            name: "original".into(),
            file: "synthetic-unit-test".into(),
            source_key: "source-original@unit-v1".into(),
            logical_event_id: EVENT.into(),
            fact_id: Some("a1".into()),
        };
        let core = json!({"id":"source-original","revision":"unit-v1","type":"OPTASK COMMS","command_ids":[work::COMMAND],"status":"partial","review_flags":["needs_review"],"contacts":[{"name":"External source contact"}],"activities":[{"id":"a1","type":"communications_plan_window","plan":"MERIDIAN COMMS","start_at":"2026-11-10T09:00:00Z","end_at":"2026-11-10T09:45:00Z","status":"needs_review"}]});
        let task = work::candidate(&binding, &core, "Original synthetic source", AT)
            .unwrap()
            .unwrap();
        let mut workflow = Workflow::default();
        workflow.extensions["planning"] = json!({"mustSurvive":"local plan"});
        workflow.tasks.insert(task.id.clone(), task);
        workflow
    }

    fn selected(workflow: &Workflow) -> &Task {
        workflow.tasks.get(&format!("{EVENT}:review")).unwrap()
    }
    fn selected_mut(workflow: &mut Workflow) -> &mut Task {
        workflow.tasks.get_mut(&format!("{EVENT}:review")).unwrap()
    }

    fn evidence(version: &str) -> Evidence {
        Evidence {
            source_excerpt: format!("Synthetic {version} source"),
            source_status: "partial".into(),
            fact_status: "needs_review".into(),
            review_flags: vec!["needs_review".into()],
            source_contacts: json!([{"name":"External source contact"}]),
            source_type: "OPTASK COMMS".into(),
            command_ids: vec![work::COMMAND.into()],
            declared_by: "demo:dev-admin".into(),
            recorded_at: AT.into(),
        }
    }

    fn install(workflow: &mut Workflow) {
        let task = selected(workflow);
        let original = DeclaredVersion {
            id: "original".into(),
            source: anchor_lineage::SourceRef {
                message_key: task.source.message_key.clone(),
                content_hash: "source-original".into(),
                fact_id: task.source.fact_id.clone(),
            },
            relationship: Relationship::Original,
            effective_at: "2026-11-10T08:00:00Z".into(),
            interval: Some(Interval {
                start: task.start.clone().unwrap(),
                end: task.end.clone().unwrap(),
            }),
            provenance: "Synthetic explicit original".into(),
            parsed_review_required: true,
        };
        let history = EventHistory {
            versions: vec![original],
            evidence: BTreeMap::from([("original".into(), evidence("original"))]),
            original_action: task.action.clone(),
            review_due_at: task.due_at.clone(),
            review_due_basis: task.due_basis.clone(),
            applied_token: None,
            applied_status: None,
        };
        put_lineage(
            workflow,
            &Lineage {
                events: BTreeMap::from([(EVENT.into(), history)]),
            },
        )
        .unwrap();
        assert!(reconcile(workflow, "demo:dev-admin", AT).unwrap());
    }

    fn add_version(workflow: &mut Workflow, id: &str, relation: Relationship, effective_at: &str) {
        let cancel = matches!(relation, Relationship::Cancels { .. });
        let mut lineage = lineage(workflow).unwrap();
        let history = lineage.events.get_mut(EVENT).unwrap();
        history.versions.push(DeclaredVersion {
            id: id.into(),
            source: anchor_lineage::SourceRef {
                message_key: format!("source-{id}@unit-v1"),
                content_hash: format!("source-{id}"),
                fact_id: (!cancel).then(|| "a1".into()),
            },
            relationship: relation,
            effective_at: effective_at.into(),
            interval: (!cancel).then(|| Interval {
                start: "2026-11-10T10:30:00Z".into(),
                end: "2026-11-10T11:15:00Z".into(),
            }),
            provenance: "Explicit synthetic relationship".into(),
            parsed_review_required: true,
        });
        history.evidence.insert(id.into(), evidence(id));
        put_lineage(workflow, &lineage).unwrap();
    }

    fn review(workflow: &mut Workflow) {
        let task = selected_mut(workflow);
        let actor = crate::api::role_identity("viewer").unwrap();
        let request: work::Request = serde_json::from_value(
            json!({"expectedVersion":task.version,"eventVersion":task.event_version}),
        )
        .unwrap();
        work::mutate(task, &actor, "review", &request, AT).unwrap();
    }

    fn token(workflow: &Workflow) -> String {
        current_view(workflow, EVENT)
            .unwrap()
            .unwrap()
            .version_token
            .unwrap()
    }

    #[test]
    fn initial_registration_preserves_original_review_progress_owner_and_planning() {
        let mut workflow = fixture();
        review(&mut workflow);
        selected_mut(&mut workflow).progress = "completed".into();
        let version = selected(&workflow).version;
        let records = json!(selected(&workflow).reviews);
        let decisions = json!(selected(&workflow).history);
        install(&mut workflow);
        let task = selected(&workflow);
        assert_eq!(task.version, version);
        assert_eq!(task.progress, "completed");
        assert_eq!(task.event_version, 1);
        assert!(work::reviewed(task));
        assert_eq!(json!(task.reviews), records);
        assert_eq!(json!(task.history), decisions);
        assert_eq!(task.owner_id.as_deref(), Some("demo:dev-user"));
        assert_eq!(
            workflow.extensions["planning"],
            json!({"mustSurvive":"local plan"})
        );
        assert!(!reconcile(&mut workflow, "system", AT).unwrap());
    }

    #[test]
    fn amendment_reopens_review_and_progress_for_exact_item_only() {
        let mut workflow = fixture();
        install(&mut workflow);
        review(&mut workflow);
        selected_mut(&mut workflow).progress = "completed".into();
        let old_token = token(&workflow);
        let original_reviews = json!(selected(&workflow).reviews);
        let owner = selected(&workflow).owner_id.clone();
        let mut unrelated = selected(&workflow).clone();
        unrelated.id = "unrelated-task".into();
        unrelated.logical_event_id = "unrelated-event".into();
        workflow
            .tasks
            .insert(unrelated.id.clone(), unrelated.clone());
        add_version(
            &mut workflow,
            "amended",
            Relationship::Amends {
                target: "original".into(),
            },
            "2026-11-10T08:10:00Z",
        );
        assert!(reconcile(&mut workflow, "demo:dev-admin", AT).unwrap());
        let task = selected(&workflow);
        assert_eq!(task.event_version, 2);
        assert_eq!(task.start.as_deref(), Some("2026-11-10T10:30:00Z"));
        assert_eq!(task.end.as_deref(), Some("2026-11-10T11:15:00Z"));
        assert_eq!(task.progress, "not_started");
        assert!(!work::reviewed(task));
        assert_eq!(json!(task.reviews), original_reviews);
        assert_eq!(task.owner_id, owner);
        assert_eq!(task.review_flags, vec!["needs_review"]);
        assert_eq!(task.history.last().unwrap().before["progress"], "completed");
        assert_eq!(json!(workflow.tasks["unrelated-task"]), json!(unrelated));
        assert_ne!(old_token, token(&workflow));
        assert_eq!(
            validate_decision(&workflow, &task.id, Some(&old_token))
                .unwrap_err()
                .code,
            "aborted"
        );
        validate_decision(&workflow, &task.id, Some(&token(&workflow))).unwrap();
        assert_eq!(workflow.extensions["planning"]["mustSurvive"], "local plan");
    }

    #[test]
    fn cancellation_stops_obsolete_reminders_but_remains_reviewable() {
        let mut workflow = fixture();
        install(&mut workflow);
        add_version(
            &mut workflow,
            "amended",
            Relationship::Amends {
                target: "original".into(),
            },
            "2026-11-10T08:05:00Z",
        );
        reconcile(&mut workflow, "system", AT).unwrap();
        review(&mut workflow);
        add_version(
            &mut workflow,
            "cancelled",
            Relationship::Cancels {
                target: "amended".into(),
            },
            "2026-11-10T08:10:00Z",
        );
        reconcile(&mut workflow, "demo:dev-admin", AT).unwrap();
        let task = selected(&workflow);
        assert_eq!(task.event_version, 3);
        assert!(task.start.is_none() && task.end.is_none() && task.due_at.is_none());
        assert!(task.source.fact_id.is_none());
        assert!(task.action.starts_with("Review cancellation"));
        assert_eq!(task.progress, "not_started");
        assert!(!work::reviewed(task));
        validate_decision(&workflow, &task.id, Some(&token(&workflow))).unwrap();
        let view = current_view(&workflow, EVENT).unwrap().unwrap();
        let actor = crate::api::role_identity("viewer").unwrap();
        assert_eq!(
            event_view(&workflow, &actor, &view).unwrap()["canReview"],
            true
        );
        let mut item = json!({"canAct":true});
        decorate_task(&workflow, task, &mut item).unwrap();
        assert_eq!(item["remindersActive"], false);
        review(&mut workflow);
        assert!(work::reviewed(selected(&workflow)));
        assert_eq!(selected(&workflow).progress, "not_started");
    }

    #[test]
    fn future_link_does_not_change_task_or_token_until_effective() {
        let mut workflow = fixture();
        install(&mut workflow);
        review(&mut workflow);
        let before_task = json!(selected(&workflow));
        let before_token = token(&workflow);
        add_version(
            &mut workflow,
            "amended",
            Relationship::Amends {
                target: "original".into(),
            },
            "2026-11-10T08:30:00Z",
        );
        assert!(!reconcile(&mut workflow, "admin", AT).unwrap());
        assert_eq!(before_task, json!(selected(&workflow)));
        assert_eq!(before_token, token(&workflow));
        workflow.scenario_now = "2026-11-10T08:30:00Z".into();
        assert!(reconcile(&mut workflow, "clock-actor", AT).unwrap());
        assert!(!work::reviewed(selected(&workflow)));
        assert_ne!(before_token, token(&workflow));
    }

    #[test]
    fn ambiguous_lineage_blocks_review_and_all_active_schedule_state() {
        let mut workflow = fixture();
        install(&mut workflow);
        let before_token = token(&workflow);
        add_version(
            &mut workflow,
            "a",
            Relationship::Amends {
                target: "original".into(),
            },
            "2026-11-10T08:10:00Z",
        );
        add_version(
            &mut workflow,
            "b",
            Relationship::Amends {
                target: "original".into(),
            },
            "2026-11-10T08:10:00Z",
        );
        reconcile(&mut workflow, "demo:dev-admin", AT).unwrap();
        let task = selected(&workflow);
        assert!(task.start.is_none() && task.end.is_none() && task.due_at.is_none());
        assert_eq!(
            validate_decision(&workflow, &task.id, Some(&before_token))
                .unwrap_err()
                .code,
            "aborted"
        );
        assert_eq!(
            validate_decision(&workflow, &task.id, None)
                .unwrap_err()
                .code,
            "aborted"
        );
        let mut item = json!({"canAct":true,"reviewed":true,"overdue":true});
        decorate_task(&workflow, task, &mut item).unwrap();
        for key in ["canAct", "reviewed", "overdue", "remindersActive"] {
            assert_eq!(item[key], false);
        }
        assert_eq!(item["instructionStatus"], "unresolved");
    }
}
