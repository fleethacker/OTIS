//! Bounded Meridian task workflow. Source facts and private drafts are never mutated.
use crate::{
    Error, Result,
    api::{App, Identity},
    private::{now, text, timestamp},
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use parse_command_state::{Document, Record};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};

pub const KIND: &str = "priority_workflow";
pub const SCENARIO: &str = "meridian-2026-11-10";
pub const OPS: &str = "priority-1-ops";
pub const ENGINEERING: &str = "priority-1-engineering";
pub const COMMAND: &str = "demo-meridian";
pub const INITIAL_NOW: &str = "2026-11-10T08:15:00Z";
const OWNER: &str = "demo:dev-user";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRef {
    pub message_key: String,
    pub fact_id: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub name: String,
    pub file: String,
    pub source_key: String,
    pub logical_event_id: String,
    pub fact_id: Option<String>,
}
pub fn bindings() -> Result<Vec<Binding>> {
    serde_json::from_str(include_str!("../../../config/priority-1/sources.json"))
        .map_err(|_| Error::config("Invalid scenario source bindings"))
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Review {
    pub actor: String,
    pub responsibility_id: String,
    pub source: SourceRef,
    pub event_version: u64,
    pub recorded_at: String,
    #[serde(default)]
    pub current_version_token: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Decision {
    pub actor: String,
    pub recorded_at: String,
    pub action: String,
    pub reason: String,
    pub before: Value,
    pub after: Value,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub logical_event_id: String,
    pub version: u64,
    pub event_version: u64,
    pub source: SourceRef,
    pub action: String,
    pub command_id: String,
    pub responsibility_id: String,
    pub responsibility_name: String,
    pub owner_id: Option<String>,
    pub owner_name: Option<String>,
    pub person_id: Option<String>,
    pub rule_id: String,
    pub assignment_reason: String,
    pub due_at: Option<String>,
    pub due_basis: String,
    pub start: Option<String>,
    pub end: Option<String>,
    pub source_excerpt: String,
    pub source_contacts: Value,
    pub source_status: String,
    pub fact_status: String,
    pub review_flags: Vec<String>,
    pub progress: String,
    pub reviews: Vec<Review>,
    pub history: Vec<Decision>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Workflow {
    pub schema_version: u32,
    pub scenario_id: String,
    pub scenario_now: String,
    pub version: u64,
    pub tasks: BTreeMap<String, Task>,
    /// Lineage and planning must be preserved by every writer and share this CAS.
    pub extensions: Value,
}
impl Default for Workflow {
    fn default() -> Self {
        Self {
            schema_version: 1,
            scenario_id: SCENARIO.into(),
            scenario_now: INITIAL_NOW.into(),
            version: 1,
            tasks: BTreeMap::new(),
            extensions: json!({}),
        }
    }
}
pub fn decode(doc: &Document) -> Result<Workflow> {
    let workflow: Workflow = serde_json::from_value(doc.record.payload.clone())
        .map_err(|_| Error::config("Workflow schema is unavailable"))?;
    if workflow.schema_version != 1 || workflow.scenario_id != SCENARIO {
        return Err(Error::config("Unsupported workflow schema"));
    }
    Ok(workflow)
}
pub async fn load(app: &App) -> Result<Option<(Document, Workflow)>> {
    app.private
        .state
        .get(KIND, SCENARIO)
        .await?
        .map(|doc| {
            let workflow = decode(&doc)?;
            Ok((doc, workflow))
        })
        .transpose()
}
pub async fn save(app: &App, previous: &Document, workflow: &Workflow) -> Result<()> {
    let payload = serde_json::to_value(workflow).map_err(|_| Error::unavailable())?;
    if serde_json::to_vec(&payload)
        .map_err(|_| Error::unavailable())?
        .len()
        > 1_048_576
    {
        return Err(Error::new(
            "resource_exhausted",
            "Workflow history capacity reached",
        ));
    }
    app.private
        .state
        .put(&Record::new(KIND, SCENARIO, payload), Some(previous))
        .await?;
    Ok(())
}
pub fn can_act(task: &Task, actor: &Identity) -> bool {
    actor.role == "admin" || task.owner_id.as_deref() == Some(&actor.owner)
}
pub fn reviewed(task: &Task) -> bool {
    task.reviews
        .iter()
        .any(|r| r.event_version == task.event_version && r.source == task.source)
}
pub fn overdue(task: &Task, scenario_now: &str) -> Result<bool> {
    if reviewed(task) {
        return Ok(false);
    }
    match &task.due_at {
        Some(due) => Ok(chrono::DateTime::parse_from_rfc3339(due)
            .map_err(|_| Error::unavailable())?
            < chrono::DateTime::parse_from_rfc3339(scenario_now)
                .map_err(|_| Error::unavailable())?),
        None => Ok(false),
    }
}
fn view(task: &Task, actor: &Identity, scenario_now: &str) -> Result<Value> {
    let mut item = json!(task);
    item["canAct"] = json!(can_act(task, actor));
    item["reviewed"] = json!(reviewed(task));
    item["overdue"] = json!(overdue(task, scenario_now)?);
    Ok(item)
}

/// Only the explicitly supported, exact source/fact bindings produce tasks.
/// This function consumes parsed facts; it does not parse message text.
pub fn candidate(binding: &Binding, core: &Value, excerpt: &str, at: &str) -> Result<Option<Task>> {
    let Some(fact_id) = &binding.fact_id else {
        return Ok(None);
    };
    if format!("{}@{}", text(core, "id"), text(core, "revision")) != binding.source_key
        || core["type"] != "OPTASK COMMS"
        || !core["command_ids"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|id| id == COMMAND))
    {
        return Ok(None);
    }
    let Some(fact) = core["activities"].as_array().and_then(|facts| {
        facts
            .iter()
            .find(|f| f["id"] == *fact_id && f["type"] == "communications_plan_window")
    }) else {
        return Ok(None);
    };
    let (plan, responsibility, name, due, owner) = match binding.name.as_str() {
        "original" => (
            "MERIDIAN COMMS",
            OPS,
            "OPS",
            Some("2026-11-10T09:00:00Z"),
            true,
        ),
        "unknown-deadline" => ("MERIDIAN FOLLOWUP", OPS, "OPS", None, true),
        "unassigned" => (
            "MERIDIAN ENGINEERING",
            ENGINEERING,
            "Engineering",
            Some("2026-11-10T10:00:00Z"),
            false,
        ),
        _ => return Ok(None),
    };
    if fact["plan"] != plan {
        return Err(Error::config(
            "Scenario fact does not match the declared routing rule",
        ));
    }
    let reason = format!(
        "Local demo rule meridian-complan-review-v1: {plan} for Meridian requires {name} coordination. {}",
        if owner {
            "P-01 is the separately authored local owner."
        } else {
            "No local person is designated; coordinator assignment required."
        }
    );
    Ok(Some(Task {
        id: format!("{}:review", binding.logical_event_id),
        logical_event_id: binding.logical_event_id.clone(),
        version: 1,
        event_version: 1,
        source: SourceRef {
            message_key: binding.source_key.clone(),
            fact_id: Some(fact_id.clone()),
        },
        action: format!("Review and coordinate {plan}"),
        command_id: COMMAND.into(),
        responsibility_id: responsibility.into(),
        responsibility_name: name.into(),
        owner_id: owner.then(|| OWNER.into()),
        owner_name: owner.then(|| "P-01 · Meridian OPS demo owner".into()),
        person_id: owner.then(|| "P-01".into()),
        rule_id: "meridian-complan-review-v1".into(),
        assignment_reason: reason.clone(),
        due_at: due.map(str::to_owned),
        due_basis: if due.is_some() {
            "Local demo policy: review by the declared scenario deadline; not a source deadline"
        } else {
            "Due time unknown: neither source nor local policy specifies a review deadline"
        }
        .into(),
        start: fact["start_at"].as_str().map(str::to_owned),
        end: fact["end_at"].as_str().map(str::to_owned),
        source_excerpt: excerpt.chars().take(2000).collect(),
        source_contacts: core["contacts"].clone(),
        source_status: text(core, "status").into(),
        fact_status: text(fact, "status").into(),
        review_flags: core["review_flags"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect(),
        progress: "not_started".into(),
        reviews: vec![],
        history: vec![Decision {
            actor: "system:meridian-complan-review-v1".into(),
            recorded_at: at.into(),
            action: "routed".into(),
            reason,
            before: Value::Null,
            after: json!({"ownerId":owner.then_some(OWNER), "responsibilityId":responsibility}),
        }],
    }))
}
pub async fn active(app: &App, actor: &Identity) -> Result<()> {
    let account = crate::accounts::account(&app.private.state, &actor.owner).await?;
    account.require("schedule:read")?;
    if account.role != actor.role {
        return Err(Error::new(
            "permission_denied",
            "Account permissions changed; sign in again",
        ));
    }
    Ok(())
}
pub async fn authorize_source(app: &App, actor: &Identity, task: &Task) -> Result<()> {
    active(app, actor).await?;
    crate::anchor::authorize_task(app, actor, task).await
}
async fn owner(app: &App, id: &str, source: &str) -> Result<String> {
    let account = crate::accounts::account(&app.private.state, id).await?;
    account.require("schedule:read")?;
    app.scope_for_owner(source, id).await?;
    Ok(if account.display_name.trim().is_empty() {
        account.username
    } else {
        account.display_name
    })
}
async fn setup(app: &App, actor: &Identity) -> Result<Value> {
    crate::settings::admin(actor)?;
    if app.config.auth.mode != "local_demo" {
        return Err(Error::config(
            "Synthetic scenario setup requires explicit local-demo authentication",
        ));
    }
    if let Some((_, workflow)) = load(app).await? {
        return Ok(json!({"configured":true,"version":workflow.version}));
    }
    crate::settings::ensure_demo_user(&app.private.state, &crate::api::role_identity("viewer")?)
        .await?;
    for (id, name) in [(OPS, "OPS"), (ENGINEERING, "Engineering")] {
        let profile =
            json!({"id":id,"name":name,"kind":"department","messageTypes":["OPTASK COMMS"]});
        match app.private.state.get("responsibility", id).await? {
            Some(doc) if doc.record.payload != profile => {
                return Err(Error::config(
                    "Scenario responsibility ID already has different contents",
                ));
            }
            Some(_) => {}
            None => {
                match app
                    .private
                    .state
                    .put(&Record::new("responsibility", id, profile.clone()), None)
                    .await
                {
                    Err(parse_command_state::Error("state_conflict")) => {
                        if app
                            .private
                            .state
                            .get("responsibility", id)
                            .await?
                            .is_none_or(|d| d.record.payload != profile)
                        {
                            return Err(Error::config(
                                "Scenario responsibility changed during setup",
                            ));
                        }
                    }
                    result => {
                        result?;
                    }
                }
            }
        }
    }
    match app
        .private
        .state
        .put(
            &Record::new(KIND, SCENARIO, json!(Workflow::default())),
            None,
        )
        .await
    {
        Ok(_) | Err(parse_command_state::Error("state_conflict")) => {}
        Err(error) => return Err(error.into()),
    }
    app.private.state.refresh().await?;
    Ok(
        json!({"configured":true,"version":load(app).await?.ok_or_else(Error::unavailable)?.1.version}),
    )
}

/// Idempotent routing from real canonical/indexed source records; no fixture fallback.
pub async fn synchronize(app: &App, actor: &Identity) -> Result<Vec<String>> {
    let scope = crate::station::effective_scope(&app.private, &actor.owner).await?;
    let mut additions = Vec::new();
    let mut pending = Vec::new();
    for binding in bindings()? {
        let (id, revision) = crate::search::split_key(&binding.source_key)?;
        let core = match app.search.canonical(id, revision).await {
            Ok(core) => core,
            Err(error) if error.code == "not_found" => {
                if actor.role == "admin" {
                    pending.push(binding.name);
                }
                continue;
            }
            Err(error) => return Err(error),
        };
        if !scope.matches(&core)? {
            continue;
        }
        if binding.fact_id.is_none() {
            continue;
        }
        // Read through the existing detail adapter; it verifies preserved-body integrity.
        let detail = app.detail(&binding.source_key).await?;
        if detail["meta"]["evidenceState"] != "available" {
            return Err(Error::config(
                "Parsed source evidence is still pending publication",
            ));
        }
        let Some(mut task) = candidate(
            &binding,
            &core,
            text(&detail["messages"][0], "rawText"),
            &now(),
        )?
        else {
            continue;
        };
        let profiles =
            crate::responsibilities::resolve(&app.private.state, &[task.responsibility_id.clone()])
                .await?;
        if !profiles[0]
            .message_types
            .iter()
            .any(|t| t == "OPTASK COMMS")
        {
            return Err(Error::config(
                "Scenario responsibility no longer covers OPTASK COMMS",
            ));
        }
        task.responsibility_name = profiles[0].name.clone();
        if let Some(id) = &task.owner_id {
            match owner(app, id, &task.source.message_key).await {
                Ok(name) => task.owner_name = Some(name),
                Err(error) if matches!(error.code, "permission_denied" | "not_found") => {
                    task.owner_id = None;
                    task.owner_name = None;
                    task.person_id = None;
                    task.assignment_reason.push_str(
                        " Designated account lacks current source access; left unassigned.",
                    );
                    task.history[0].reason = task.assignment_reason.clone();
                    task.history[0].after["ownerId"] = Value::Null;
                }
                Err(error) => return Err(error),
            }
        }
        additions.push(task);
    }
    for _ in 0..5 {
        let (doc, mut workflow) = load(app)
            .await?
            .ok_or_else(|| Error::config("Set up the scenario first"))?;
        let mut changed = false;
        for task in &additions {
            if !workflow.tasks.contains_key(&task.id) {
                workflow.tasks.insert(task.id.clone(), task.clone());
                changed = true;
            }
        }
        changed |= crate::anchor::reconcile(&mut workflow, "system:anchor-effective-time", &now())?;
        if !changed {
            return Ok(pending);
        }
        workflow.version += 1;
        match save(app, &doc, &workflow).await {
            Err(error) if error.code == "aborted" => continue,
            result => {
                result?;
                return Ok(pending);
            }
        }
    }
    Err(Error::new(
        "aborted",
        "Workflow changed during routing; reload",
    ))
}
async fn list(app: &App, actor: &Identity) -> Result<Value> {
    if load(app).await?.is_none() {
        return Ok(
            json!({"configured":false,"canCoordinate":actor.role=="admin","items":[],"pendingSources":[],"scenarioId":SCENARIO,"scenarioNow":INITIAL_NOW,"version":0}),
        );
    }
    let pending = synchronize(app, actor).await?;
    let (_, workflow) = load(app).await?.ok_or_else(Error::unavailable)?;
    let mut items = Vec::new();
    for task in workflow.tasks.values() {
        match authorize_source(app, actor, task).await {
            Ok(()) => {
                let mut item = view(task, actor, &workflow.scenario_now)?;
                crate::anchor::decorate_task(&workflow, task, &mut item)?;
                items.push(item);
            }
            Err(error) if matches!(error.code, "not_found" | "permission_denied") => {}
            Err(error) => return Err(error),
        }
    }
    Ok(
        json!({"configured":true,"canCoordinate":actor.role=="admin","items":items,"pendingSources":pending,"scenarioId":SCENARIO,"scenarioNow":workflow.scenario_now,"version":workflow.version}),
    )
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub task_id: Option<String>,
    pub expected_version: Option<u64>,
    pub event_version: Option<u64>,
    pub current_version_token: Option<String>,
    #[serde(default, deserialize_with = "owner_patch")]
    pub owner_id: Option<Option<String>>,
    pub progress: Option<String>,
    pub reason: Option<String>,
    pub scenario_now: Option<String>,
}
fn owner_patch<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Option<String>>, D::Error> {
    Ok(Some(Option::<String>::deserialize(deserializer)?))
}
fn selected_owner(request: &Request) -> Result<&Option<String>> {
    request
        .owner_id
        .as_ref()
        .ok_or_else(|| Error::invalid("ownerId is required; use null to leave work unassigned"))
}
fn reason(request: &Request) -> Result<String> {
    let reason = request.reason.as_deref().unwrap_or("").trim();
    if reason.is_empty() || reason.len() > 500 || reason.chars().any(char::is_control) {
        return Err(Error::invalid(
            "Provide a reason of 1–500 bytes without control characters",
        ));
    }
    Ok(reason.into())
}
pub fn mutate(
    task: &mut Task,
    actor: &Identity,
    operation: &str,
    request: &Request,
    at: &str,
) -> Result<bool> {
    if request.expected_version != Some(task.version)
        || request.event_version != Some(task.event_version)
    {
        return Err(Error::new(
            "aborted",
            "Task or current event version changed; reload before deciding",
        ));
    }
    if !can_act(task, actor) {
        return Err(Error::new(
            "permission_denied",
            "Only the designated owner or an administrator may update this task",
        ));
    }
    if task.history.len() >= 256 {
        return Err(Error::new(
            "resource_exhausted",
            "Task decision history is full",
        ));
    }
    let before;
    let after;
    let explanation;
    match operation {
        "review" => {
            if task.reviews.iter().any(|r| {
                r.actor == actor.owner
                    && r.event_version == task.event_version
                    && r.source == task.source
            }) {
                return Ok(false);
            }
            if task.reviews.len() >= 64 {
                return Err(Error::new("resource_exhausted", "Review history is full"));
            }
            before = json!({"reviewed":reviewed(task)});
            task.reviews.push(Review {
                actor: actor.owner.clone(),
                responsibility_id: task.responsibility_id.clone(),
                source: task.source.clone(),
                event_version: task.event_version,
                recorded_at: at.into(),
                current_version_token: request.current_version_token.clone(),
            });
            after = json!({"reviewed":true,"source":task.source,"eventVersion":task.event_version});
            explanation =
                "Internal review of this exact version; no completion, validation or sending"
                    .into();
        }
        "progress" => {
            let progress = request.progress.as_deref().unwrap_or("");
            if !matches!(progress, "not_started" | "in_progress" | "completed") {
                return Err(Error::invalid("Unknown task progress"));
            }
            explanation = reason(request)?;
            if task.progress == progress {
                return Ok(false);
            }
            before = json!({"progress":task.progress});
            task.progress = progress.into();
            after = json!({"progress":progress});
        }
        "assign" => {
            crate::settings::admin(actor)?;
            explanation = reason(request)?;
            if &task.owner_id == selected_owner(request)? {
                return Ok(false);
            }
            before = json!({"ownerId":task.owner_id,"personId":task.person_id});
            task.owner_id = selected_owner(request)?.clone();
            task.owner_name = None;
            task.person_id = task
                .owner_id
                .as_deref()
                .filter(|id| *id == OWNER)
                .map(|_| "P-01".into());
            task.assignment_reason = format!("Coordinator reassignment: {explanation}");
            after = json!({"ownerId":task.owner_id,"personId":task.person_id});
        }
        _ => return Err(Error::new("not_found", "Unknown work operation")),
    }
    let before = json!({"state":before,"source":task.source,"eventVersion":task.event_version,"taskVersion":task.version,"currentVersionToken":request.current_version_token});
    task.version += 1;
    let after = json!({"state":after,"source":task.source,"eventVersion":task.event_version,"taskVersion":task.version,"currentVersionToken":request.current_version_token});
    task.history.push(Decision {
        actor: actor.owner.clone(),
        recorded_at: at.into(),
        action: operation.into(),
        reason: explanation,
        before,
        after,
    });
    Ok(true)
}
pub async fn execute(
    app: &App,
    actor: &Identity,
    operation: &str,
    request: Request,
) -> Result<Value> {
    active(app, actor).await?;
    match operation {
        "setup" => return setup(app, actor).await,
        "list" => return list(app, actor).await,
        _ => {}
    }
    let (doc, mut workflow) = load(app)
        .await?
        .ok_or_else(|| Error::config("Set up the scenario first"))?;
    if operation == "clock" {
        crate::settings::admin(actor)?;
        if app.config.auth.mode != "local_demo" {
            return Err(Error::config("Scenario clock requires local-demo mode"));
        }
        if request.expected_version != Some(workflow.version) {
            return Err(Error::new("aborted", "Scenario changed; reload"));
        }
        let time = timestamp(request.scenario_now.as_deref().unwrap_or(""))?;
        if !time.starts_with("2026-11-10T") {
            return Err(Error::invalid(
                "Scenario clock must stay on November 10, 2026 UTC",
            ));
        }
        for task in workflow.tasks.values() {
            authorize_source(app, actor, task).await?;
        }
        if time < timestamp(&workflow.scenario_now)? {
            return Err(Error::invalid(
                "Scenario time cannot move backward; use a fresh isolated state index to reset",
            ));
        }
        if timestamp(&workflow.scenario_now)? == time {
            return Ok(json!({"scenarioNow":workflow.scenario_now,"version":workflow.version}));
        }
        let mut history = match workflow.extensions.get("clockHistory") {
            Some(value) => value.as_array().cloned().ok_or_else(Error::unavailable)?,
            None => vec![],
        };
        if history.len() >= 256 {
            return Err(Error::new(
                "resource_exhausted",
                "Scenario clock history is full",
            ));
        }
        history.push(json!({"actor":actor.owner,"recordedAt":now(),"before":workflow.scenario_now,"after":time,"inputVersion":workflow.version}));
        workflow.extensions["clockHistory"] = json!(history);
        workflow.scenario_now = time;
        crate::anchor::reconcile(&mut workflow, &actor.owner, &now())?;
        workflow.version += 1;
        save(app, &doc, &workflow).await?;
        return Ok(json!({"scenarioNow":workflow.scenario_now,"version":workflow.version}));
    }
    let task = workflow
        .tasks
        .get(request.task_id.as_deref().unwrap_or(""))
        .ok_or_else(|| Error::new("not_found", "Task not found"))?;
    authorize_source(app, actor, task).await?;
    if matches!(operation, "review" | "progress") {
        crate::anchor::validate_decision(
            &workflow,
            request.task_id.as_deref().unwrap_or(""),
            request.current_version_token.as_deref(),
        )?;
    }
    let task = workflow
        .tasks
        .get_mut(request.task_id.as_deref().unwrap_or(""))
        .ok_or_else(|| Error::new("not_found", "Task not found"))?;
    let target_name = if operation == "assign" {
        crate::settings::admin(actor)?;
        match selected_owner(&request)? {
            Some(id) if id.len() <= 256 => {
                let name = owner(app, id, &task.source.message_key).await?;
                let account = crate::accounts::account(&app.private.state, id).await?;
                let recipient = Identity {
                    owner: id.clone(),
                    role: account.role,
                    username: account.username,
                    email: account.email,
                    groups: vec![],
                };
                crate::anchor::authorize_task(app, &recipient, task).await?;
                Some(name)
            }
            Some(_) => return Err(Error::invalid("Owner ID is too long")),
            None => None,
        }
    } else {
        None
    };
    let changed = mutate(task, actor, operation, &request, &now())?;
    if changed && operation == "assign" {
        task.owner_name = target_name;
    }
    let mut result = view(task, actor, &workflow.scenario_now)?;
    let task_id = task.id.clone();
    crate::anchor::decorate_task(&workflow, &workflow.tasks[&task_id], &mut result)?;
    if changed {
        workflow.version += 1;
        save(app, &doc, &workflow).await?;
    }
    Ok(json!({"item":result}))
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
