//! Personnel planning shares the task/lineage CAS transaction; sources stay immutable.
pub mod calculation;
pub mod state;
use crate::{
    Error, Result,
    anchor_lineage::{CurrentEvent, Status},
    api::{App, Identity},
    work::{self, Workflow},
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use calculation::{Event, Inputs, Interval, Person};
use serde::Deserialize;
use serde_json::{Value, json};
use state::Planning;
use std::{collections::BTreeSet, sync::Arc};
pub const EVENT_ID: &str = crate::anchor::EVENT;
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub expected_version: Option<u64>,
    pub proposal_id: Option<String>,
    pub decision: Option<String>,
    pub reason: Option<String>,
    pub people: Option<Vec<Person>>,
    pub roster_observed_at: Option<String>,
    pub roster_valid_until: Option<String>,
}
pub fn planning(workflow: &Workflow) -> Result<Option<Planning>> {
    workflow
        .extensions
        .get("planning")
        .filter(|v| !v.is_null())
        .map(|v| {
            serde_json::from_value(v.clone())
                .map_err(|_| Error::config("Planning state is unreadable"))
        })
        .transpose()
}
pub fn seed() -> Result<Planning> {
    serde_json::from_str(include_str!("../../../../config/priority-3/personnel.json"))
        .map_err(|_| Error::config("Planning fixture is invalid"))
}
/// Consume ANCHOR's current view. Never infer lineage from tasks or parser revisions.
pub fn inputs(workflow: &Workflow, planning: &Planning, current: &CurrentEvent) -> Inputs {
    let mut events = vec![planning.local_event.clone()];
    if current.status != Status::Cancelled {
        let version = current.current.as_ref();
        events.push(Event {
            id: EVENT_ID.into(),
            title: "Communications window (source-directed)".into(),
            interval: current.scheduling_interval().map(|i| Interval {
                start: i.start.clone(),
                end: i.end.clone(),
            }),
            // Explicit fictional assignments, independent of task ownership/role labels.
            person_ids: vec!["P-01".into()],
            required_qualifications: Some(vec!["demo-comms-training".into()]),
            fixed: true,
            source_ref: version
                .map(|v| v.source.message_key.clone())
                .unwrap_or_default(),
            version: current.version_token.clone().unwrap_or_default(),
            validated: false, // No operational validation record exists in this slice.
            buffer_before_minutes: None,
            buffer_after_minutes: None,
        });
    }
    Inputs {
        people: planning.people.clone(),
        events,
        rules: planning.rules.clone(),
        roster_observed_at: planning.roster_observed_at.clone(),
        roster_valid_until: planning.roster_valid_until.clone(),
        assessed_at: workflow.scenario_now.clone(),
        schedule_complete: planning.schedule_complete
            && current.next_effective_at.as_ref().is_none_or(|time| {
                chrono::DateTime::parse_from_rfc3339(time)
                    .ok()
                    .zip(chrono::DateTime::parse_from_rfc3339(&planning.coverage.end).ok())
                    .is_some_and(|(next, end)| next > end)
            }),
        coverage: planning.coverage.clone(),
    }
}
async fn authorize(
    app: &App,
    actor: &Identity,
    current: &CurrentEvent,
    plan: Option<&Planning>,
) -> Result<()> {
    work::active(app, actor).await?;
    crate::anchor::authorize_event(app, actor, current).await?;
    let mut sources = BTreeSet::new();
    if let Some(plan) = plan {
        for proposal in &plan.proposals {
            for event in &proposal.inputs.events {
                if !event.source_ref.starts_with("local:") && !event.source_ref.is_empty() {
                    sources.insert(event.source_ref.clone());
                }
            }
        }
    }
    for source in sources {
        app.scope_for_owner(&source, &actor.owner).await?;
    }
    Ok(())
}
fn view(
    workflow: &Workflow,
    plan: Option<&Planning>,
    current: &CurrentEvent,
    actor: &Identity,
) -> Value {
    let input = plan.map(|p| inputs(workflow, p, current));
    let assessment=input.as_ref().map(|i| {
        let mut assessment=calculation::assess(i,4096);
        if !i.schedule_complete && current.next_effective_at.is_some() {assessment.explanation.push("A declared source change becomes effective within the planning horizon; advance to the effective version and recalculate.".into());}
        assessment
    });
    json!({"configured":plan.is_some(),"canCoordinate":actor.role=="admin","version":workflow.version,
        "scenarioNow":workflow.scenario_now,"scenarioId":work::SCENARIO,"inputs":input,"assessment":assessment,
        "proposals":plan.map(|p|p.proposals.clone()).unwrap_or_default(),"decisions":plan.map(|p|p.decisions.clone()).unwrap_or_default(),"currentEvent":current,
        "inputVersion":plan.zip(input.as_ref()).map(|(p,i)|state::input_version(p,i,current.version_token.as_deref().unwrap_or(""))),
        "datasetBasis":"Separately authored fictional personnel and complete scenario assignments for P-01, November 10 2026 09:00–12:00 UTC. Not the command roster or an operational completeness claim."})
}
pub async fn execute(
    app: &App,
    actor: &Identity,
    operation: &str,
    request: Request,
) -> Result<Value> {
    work::active(app, actor).await?;
    let (doc, mut workflow) = work::load(app)
        .await?
        .ok_or_else(|| Error::config("Set up Assigned work and message history first"))?;
    let current = crate::anchor::current_view(&workflow, EVENT_ID)?.ok_or_else(|| {
        Error::config("Current-event history is not ready; complete ANCHOR setup first")
    })?;
    let mut plan = planning(&workflow)?;
    authorize(app, actor, &current, plan.as_ref()).await?;
    if operation == "read" {
        return Ok(view(&workflow, plan.as_ref(), &current, actor));
    }
    crate::settings::admin(actor)?;
    if request.expected_version != Some(workflow.version) {
        return Err(Error::new(
            "aborted",
            "Workflow changed; reload and recalculate before deciding",
        ));
    }
    if operation == "setup" {
        if app.config.auth.mode != "local_demo" {
            return Err(Error::config(
                "Synthetic personnel setup requires local-demo mode",
            ));
        }
        if plan.is_some() {
            return Ok(view(&workflow, plan.as_ref(), &current, actor));
        }
        plan = Some(seed()?);
    } else {
        let plan = plan
            .as_mut()
            .ok_or_else(|| Error::config("Set up fictional personnel first"))?;
        let input = inputs(&workflow, plan, &current);
        let token = current.version_token.as_deref().unwrap_or("");
        match operation {
            "propose" => plan
                .propose(input, token, &actor.owner, &crate::private::now())
                .map_err(Error::invalid)?,
            "decide" => plan
                .decide(
                    state::DecisionRequest {
                        proposal_id: request.proposal_id.as_deref().unwrap_or(""),
                        decision: request.decision.as_deref().unwrap_or(""),
                        reason: request.reason.as_deref().unwrap_or(""),
                        actor: &actor.owner,
                        recorded_at: &crate::private::now(),
                    },
                    &input,
                    token,
                )
                .map_err(|m| Error::new("aborted", m))?,
            "personnel" => {
                let people = request
                    .people
                    .ok_or_else(|| Error::invalid("Personnel are required"))?;
                if people.is_empty()
                    || people.len() > 64
                    || people.iter().any(|p| {
                        p.id.is_empty()
                            || p.id.len() > 128
                            || p.name.len() > 256
                            || p.qualifications
                                .as_ref()
                                .is_some_and(|q| q.len() > 64 || q.iter().any(|s| s.len() > 128))
                            || p.availability.as_ref().is_some_and(|a| a.len() > 128)
                    })
                {
                    return Err(Error::invalid(
                        "Personnel input exceeds the bounded scenario limits",
                    ));
                }
                let observed =
                    crate::private::timestamp(request.roster_observed_at.as_deref().unwrap_or(""))?;
                let until =
                    crate::private::timestamp(request.roster_valid_until.as_deref().unwrap_or(""))?;
                if observed >= until {
                    return Err(Error::invalid(
                        "Roster validity must follow its observation time",
                    ));
                }
                plan.people = people;
                plan.roster_observed_at = observed;
                plan.roster_valid_until = until;
                plan.roster_version = plan.roster_version.checked_add(1).ok_or_else(|| {
                    Error::new("resource_exhausted", "Roster version capacity reached")
                })?;
                plan.version = plan.version.checked_add(1).ok_or_else(|| {
                    Error::new("resource_exhausted", "Planning version capacity reached")
                })?;
            }
            _ => return Err(Error::new("not_found", "Unknown planning operation")),
        }
    }
    workflow.extensions["planning"] =
        serde_json::to_value(&plan).map_err(|_| Error::unavailable())?;
    workflow.version = workflow
        .version
        .checked_add(1)
        .ok_or_else(|| Error::new("resource_exhausted", "Workflow version capacity reached"))?;
    // Constraint recheck and versions commit with the local decision in one CAS.
    // An intervening writer returns conflict; never retry a human decision.
    work::save(app, &doc, &workflow).await?;
    Ok(view(&workflow, plan.as_ref(), &current, actor))
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
mod adapter_tests;
#[cfg(test)]
mod state_tests;
