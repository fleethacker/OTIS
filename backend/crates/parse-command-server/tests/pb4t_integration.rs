//! Combined integration acceptance against actual parsed/published synthetic sources.
//! Run only with PARSE_COMMAND_TEST_OPENSEARCH_URL pointing to an isolated cluster,
//! after priority_scenario and the normal publisher load priority-1 and priority-2.
//! support::app creates a unique workflow-state index; no fake backend is used.
use parse_command_server::{
    anchor,
    api::{App, Identity, ReadRequest, role_identity},
    pb4t::{self, Request as PlanningRequest},
    work,
};
use serde_json::{Value, json};

mod support;

const TASK: &str = "meridian-2026-11-10:original:review";

fn planning_request(value: Value) -> PlanningRequest {
    serde_json::from_value(value).unwrap()
}

async fn workflow_version(app: &App) -> u64 {
    work::load(app).await.unwrap().unwrap().1.version
}

async fn plan_read(app: &App, actor: &Identity) -> Value {
    pb4t::execute(app, actor, "read", PlanningRequest::default())
        .await
        .unwrap()
}

fn local_interval(value: &Value) -> &Value {
    &value["inputs"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|event| event["id"] == value["inputs"]["rules"]["eventId"])
        .unwrap()["interval"]
}

fn latest_proposal(value: &Value) -> String {
    value["proposals"].as_array().unwrap().last().unwrap()["id"]
        .as_str()
        .unwrap()
        .into()
}

async fn propose(app: &App, actor: &Identity) -> Value {
    pb4t::execute(
        app,
        actor,
        "propose",
        planning_request(json!({"expectedVersion":workflow_version(app).await})),
    )
    .await
    .unwrap()
}

async fn advance(app: &App, admin: &Identity, at: &str) {
    work::execute(
        app,
        admin,
        "clock",
        serde_json::from_value(json!({
            "expectedVersion":workflow_version(app).await,
            "scenarioNow":at,
        }))
        .unwrap(),
    )
    .await
    .unwrap();
}

fn binding(name: &str) -> work::Binding {
    let bindings: Vec<work::Binding> =
        serde_json::from_str(include_str!("../../../config/priority-2/sources.json")).unwrap();
    bindings.into_iter().find(|item| item.name == name).unwrap()
}

async fn declare(app: &App, admin: &Identity, name: &str, at: &str) -> Value {
    let source = binding(name);
    let cancellation = name == "cancellation";
    anchor::execute(
        app,
        admin,
        "declare",
        serde_json::from_value(json!({
            "expectedVersion":workflow_version(app).await,
            "logicalEventId":anchor::EVENT,
            "versionId":name,
            "source":{"messageKey":source.source_key,"factId":source.fact_id},
            "relationship":{
                "kind":if cancellation {"cancels"} else {"amends"},
                "target":if cancellation {"amendment"} else {"original"},
            },
            "effectiveAt":at,
            "provenance":"Explicit relationship authored for the combined Meridian acceptance test",
        }))
        .unwrap(),
    )
    .await
    .unwrap()
}

async fn detail(app: &App, actor: &Identity, key: &str) -> Value {
    app.execute(
        "detail",
        serde_json::from_value::<ReadRequest>(json!({"key":key})).unwrap(),
        &actor.owner,
    )
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch with real priority-1/priority-2 parser and publisher replay"]
async fn combined_work_anchor_personnel_decisions_persist_and_preserve_sources() {
    let app = support::app().await;
    app.private.create_session("admin").await.unwrap();
    app.private.create_session("viewer").await.unwrap();
    let admin = role_identity("admin").unwrap();
    let viewer = role_identity("viewer").unwrap();
    work::execute(&app, &admin, "setup", work::Request::default())
        .await
        .unwrap();
    let initial = work::execute(&app, &admin, "list", work::Request::default())
        .await
        .unwrap();
    assert_eq!(
        initial["items"].as_array().unwrap().len(),
        3,
        "Run the actual parser/publication replay before this ignored integration test"
    );
    let original = work::bindings()
        .unwrap()
        .into_iter()
        .find(|b| b.name == "original")
        .unwrap();
    let source_before = detail(&app, &admin, &original.source_key).await;
    assert_eq!(source_before["meta"]["evidenceState"], "available");
    let body_before = source_before["messages"][0]["rawText"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(body_before.contains("COMPLAN/MERIDIAN COMMS"));

    anchor::execute(
        &app,
        &admin,
        "setup",
        serde_json::from_value(json!({
            "expectedVersion":workflow_version(&app).await,
        }))
        .unwrap(),
    )
    .await
    .unwrap();
    let (_, workflow) = work::load(&app).await.unwrap().unwrap();
    let task = &workflow.tasks[TASK];
    let original_view = anchor::current_view(&workflow, anchor::EVENT)
        .unwrap()
        .unwrap();
    let original_token = original_view.version_token.unwrap();
    let review = work::execute(
        &app,
        &viewer,
        "review",
        serde_json::from_value(json!({
            "taskId":TASK,"expectedVersion":task.version,"eventVersion":task.event_version,
            "currentVersionToken":original_token,
        }))
        .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(review["item"]["progress"], "not_started");
    assert_eq!(review["item"]["reviews"][0]["actor"], viewer.owner);
    assert_eq!(review["item"]["reviewed"], true);

    declare(&app, &admin, "amendment", "2026-11-10T08:30:00Z").await;
    advance(&app, &admin, "2026-11-10T09:01:00Z").await;
    let amended_work = work::execute(&app, &admin, "list", work::Request::default())
        .await
        .unwrap();
    let amended_task = amended_work["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == TASK)
        .unwrap();
    assert_eq!(amended_task["start"], "2026-11-10T10:30:00.000000000Z");
    assert_eq!(amended_task["end"], "2026-11-10T11:15:00.000000000Z");
    assert_eq!(amended_task["reviewed"], false);
    assert_eq!(amended_task["overdue"], true);
    assert!(
        amended_task["dueBasis"]
            .as_str()
            .unwrap()
            .starts_with("Local demo policy")
    );
    assert_eq!(amended_task["reviews"].as_array().unwrap().len(), 1);
    assert_ne!(amended_task["currentVersionToken"], original_token);

    let configured = pb4t::execute(
        &app,
        &admin,
        "setup",
        planning_request(json!({
            "expectedVersion":workflow_version(&app).await,
        })),
    )
    .await
    .unwrap();
    assert_eq!(configured["assessment"]["status"], "feasible");
    assert_eq!(configured["assessment"]["provisional"], true);
    assert_eq!(configured["assessment"]["checkedStarts"], 3);
    assert_eq!(
        configured["assessment"]["collisions"][0]["personId"],
        "P-01"
    );
    assert_eq!(
        configured["assessment"]["collisions"][0]["overlap"],
        json!({
            "start":"2026-11-10T10:45:00Z","end":"2026-11-10T11:15:00Z",
        })
    );
    assert_eq!(
        configured["assessment"]["alternative"],
        json!({
            "start":"2026-11-10T11:15:00Z","end":"2026-11-10T11:45:00Z",
        })
    );
    let local_before = local_interval(&configured).clone();
    let fixed_before = configured["inputs"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|event| event["fixed"] == true)
        .unwrap()
        .clone();
    assert_eq!(
        pb4t::execute(
            &app,
            &viewer,
            "propose",
            planning_request(json!({
                "expectedVersion":configured["version"],
            }))
        )
        .await
        .unwrap_err()
        .code,
        "permission_denied"
    );

    let first = propose(&app, &admin).await;
    let duplicated = propose(&app, &admin).await;
    assert_eq!(duplicated["proposals"].as_array().unwrap().len(), 1);
    assert_eq!(latest_proposal(&first), latest_proposal(&duplicated));
    let rejected = pb4t::execute(
        &app,
        &admin,
        "decide",
        planning_request(json!({
            "expectedVersion":duplicated["version"],"proposalId":latest_proposal(&duplicated),
            "decision":"reject","reason":"Coordinator requests another review",
        })),
    )
    .await
    .unwrap();
    assert_eq!(local_interval(&rejected), &local_before);
    assert_eq!(rejected["decisions"][0]["actor"], admin.owner);
    assert_eq!(rejected["proposals"][0]["status"], "rejected");

    let second = propose(&app, &admin).await;
    let stale_id = latest_proposal(&second);
    let personnel = pb4t::execute(
        &app,
        &admin,
        "personnel",
        planning_request(json!({
            "expectedVersion":second["version"],"people":second["inputs"]["people"],
            "rosterObservedAt":"2026-11-10T08:01:00Z","rosterValidUntil":"2026-11-10T12:00:00Z",
        })),
    )
    .await
    .unwrap();
    for version in [&second["version"], &personnel["version"]] {
        assert_eq!(
            pb4t::execute(
                &app,
                &admin,
                "decide",
                planning_request(json!({
                    "expectedVersion":version,"proposalId":stale_id,"decision":"accept",
                    "reason":"Old roster screen",
                }))
            )
            .await
            .unwrap_err()
            .code,
            "aborted"
        );
    }
    assert_eq!(
        local_interval(&plan_read(&app, &admin).await),
        &local_before
    );

    let recalculated = propose(&app, &admin).await;
    let final_id = latest_proposal(&recalculated);
    let (previous, mut intervening) = work::load(&app).await.unwrap().unwrap();
    // Simulate a decision that passed its complete input recheck before another
    // writer won the shared aggregate CAS. The stale decision must not persist.
    let mut raced_decision = intervening.clone();
    let mut raced_plan = pb4t::planning(&raced_decision).unwrap().unwrap();
    let raced_current = anchor::current_view(&raced_decision, anchor::EVENT)
        .unwrap()
        .unwrap();
    let raced_inputs = pb4t::inputs(&raced_decision, &raced_plan, &raced_current);
    raced_plan
        .decide(
            pb4t::state::DecisionRequest {
                proposal_id: &final_id,
                decision: "accept",
                reason: "Concurrent acceptance probe",
                actor: &admin.owner,
                recorded_at: &parse_command_server::private::now(),
            },
            &raced_inputs,
            raced_current.version_token.as_deref().unwrap(),
        )
        .unwrap();
    raced_decision.extensions["planning"] = serde_json::to_value(raced_plan).unwrap();
    raced_decision.version += 1;
    intervening.extensions["combinedTestSentinel"] = json!("preserved");
    intervening.version += 1;
    work::save(&app, &previous, &intervening).await.unwrap();
    assert_eq!(
        work::save(&app, &previous, &raced_decision)
            .await
            .unwrap_err()
            .code,
        "aborted"
    );
    assert_eq!(
        local_interval(&plan_read(&app, &admin).await),
        &local_before
    );
    assert_eq!(
        pb4t::execute(
            &app,
            &admin,
            "decide",
            planning_request(json!({
                "expectedVersion":recalculated["version"],"proposalId":final_id,"decision":"accept",
                "reason":"A concurrent writer changed the aggregate",
            }))
        )
        .await
        .unwrap_err()
        .code,
        "aborted"
    );
    let accepted = pb4t::execute(&app, &admin, "decide", planning_request(json!({
        "expectedVersion":workflow_version(&app).await,"proposalId":final_id,"decision":"accept",
        "reason":"All declared constraints rechecked; move local training",
    }))).await.unwrap();
    assert_eq!(accepted["assessment"]["status"], "clear");
    assert_eq!(
        local_interval(&accepted),
        &json!({
            "start":"2026-11-10T11:15:00Z","end":"2026-11-10T11:45:00Z",
        })
    );
    let fixed_after = accepted["inputs"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|event| event["fixed"] == true)
        .unwrap();
    assert_eq!(fixed_after, &fixed_before);
    assert_eq!(accepted["decisions"].as_array().unwrap().len(), 2);
    assert_eq!(accepted["decisions"][1]["decision"], "accept");
    assert_eq!(accepted["decisions"][1]["actor"], admin.owner);

    let reopened =
        parse_command_state::Store::new(&app.config.search, app.private.state.index()).unwrap();
    let persisted = work::decode(
        &reopened
            .get(work::KIND, work::SCENARIO)
            .await
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    let persisted_plan = pb4t::planning(&persisted).unwrap().unwrap();
    assert_eq!(persisted_plan.plan_version, 2);
    assert_eq!(persisted_plan.roster_version, 2);
    assert_eq!(persisted_plan.decisions.len(), 2);
    assert_eq!(persisted_plan.decisions[1].actor, admin.owner);
    assert_eq!(
        persisted_plan.local_event.interval.as_ref().unwrap().start,
        "2026-11-10T11:15:00Z"
    );
    assert_eq!(persisted.extensions["combinedTestSentinel"], "preserved");
    assert_eq!(
        detail(&app, &admin, &original.source_key).await["messages"][0]["rawText"],
        body_before
    );

    declare(&app, &admin, "cancellation", "2026-11-10T09:30:00Z").await;
    advance(&app, &admin, "2026-11-10T09:30:00Z").await;
    let cancelled = plan_read(&app, &admin).await;
    assert_eq!(cancelled["currentEvent"]["status"], "cancelled");
    assert_eq!(cancelled["inputs"]["events"].as_array().unwrap().len(), 1);
    assert_eq!(cancelled["assessment"]["status"], "clear");
    assert_eq!(local_interval(&cancelled), local_interval(&accepted));
    let replay = work::execute(&app, &admin, "list", work::Request::default())
        .await
        .unwrap();
    assert_eq!(replay["items"].as_array().unwrap().len(), 3);
    let cancellation_task = replay["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == TASK)
        .unwrap();
    assert_eq!(cancellation_task["remindersActive"], false);
    assert_eq!(cancellation_task["overdue"], false);
    assert!(cancellation_task["dueAt"].is_null());
    assert_eq!(cancellation_task["reviewed"], false);
    let timeline = app
        .execute(
            "timeline",
            serde_json::from_value(json!({
                "from":"2026-11-10T09:00:00Z","to":"2026-11-10T12:00:00Z",
            }))
            .unwrap(),
            &admin.owner,
        )
        .await
        .unwrap();
    let amendment = binding("amendment");
    assert!(
        !timeline["meta"]["timelineItems"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| {
                (item["messageKey"] == original.source_key
                    || item["messageKey"] == amendment.source_key)
                    && item["factId"] == "a1"
            }),
        "Cancellation must remove both obsolete selected source facts from the calendar"
    );
    assert_eq!(
        detail(&app, &admin, &original.source_key).await["messages"][0]["rawText"],
        body_before
    );

    app.private.state.update("user", &viewer.owner, |old| {
        let mut row = old.unwrap().clone();
        row.payload["accountSettings"] = json!({
            "timezone":"UTC","calendarRefreshSeconds":30,"defaultCalendarView":"day",
            "messageScope":{"allCommands":false,"commandIds":["other-command"],"includeUnassigned":false,"responsibilityIds":[]},
        });
        Ok(row)
    }).await.unwrap();
    let denied = pb4t::execute(&app, &viewer, "read", PlanningRequest::default())
        .await
        .unwrap_err();
    assert!(matches!(denied.code, "permission_denied" | "not_found"));
    support::cleanup(&app.private.state).await;
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch with real priority-1/priority-2 parser and publisher replay"]
async fn intervening_conflicting_amendment_invalidates_persisted_personnel_proposal() {
    let app = support::app().await;
    app.private.create_session("admin").await.unwrap();
    let admin = role_identity("admin").unwrap();
    work::execute(&app, &admin, "setup", work::Request::default())
        .await
        .unwrap();
    let initial = work::execute(&app, &admin, "list", work::Request::default())
        .await
        .unwrap();
    assert_eq!(initial["items"].as_array().unwrap().len(), 3);
    anchor::execute(
        &app,
        &admin,
        "setup",
        serde_json::from_value(json!({
            "expectedVersion":workflow_version(&app).await,
        }))
        .unwrap(),
    )
    .await
    .unwrap();
    declare(&app, &admin, "amendment", "2026-11-10T08:30:00Z").await;
    advance(&app, &admin, "2026-11-10T09:01:00Z").await;
    pb4t::execute(
        &app,
        &admin,
        "setup",
        planning_request(json!({
            "expectedVersion":workflow_version(&app).await,
        })),
    )
    .await
    .unwrap();
    let pending = propose(&app, &admin).await;
    let proposal_id = latest_proposal(&pending);
    let before_local = local_interval(&pending).clone();
    assert_eq!(pending["assessment"]["status"], "feasible");
    assert_eq!(
        pending["assessment"]["alternative"]["start"],
        "2026-11-10T11:15:00Z"
    );

    // The real fixture explicitly targets original as a competing branch. Its
    // 12:00–12:45 source interval is not rewritten to manufacture a valid chain.
    let conflict = binding("conflicting-amendment");
    let before_evidence = detail(&app, &admin, &conflict.source_key).await;
    let source_body = before_evidence["messages"][0]["rawText"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(source_body.contains("101200ZNOV2026/101245ZNOV2026"));
    declare(
        &app,
        &admin,
        "conflicting-amendment",
        "2026-11-10T09:05:00Z",
    )
    .await;
    advance(&app, &admin, "2026-11-10T09:06:00Z").await;
    let current = plan_read(&app, &admin).await;
    assert_eq!(current["currentEvent"]["status"], "unresolved");
    assert!(current["currentEvent"]["versionToken"].is_null());
    assert_eq!(current["assessment"]["status"], "incomplete");
    assert!(current["assessment"]["alternative"].is_null());
    assert_ne!(pending["inputVersion"], current["inputVersion"]);
    for expected in [&pending["version"], &current["version"]] {
        assert_eq!(
            pb4t::execute(
                &app,
                &admin,
                "decide",
                planning_request(json!({
                    "expectedVersion":expected,"proposalId":proposal_id,"decision":"accept",
                    "reason":"Old proposal after an intervening amendment",
                }))
            )
            .await
            .unwrap_err()
            .code,
            "aborted"
        );
    }
    let preserved = plan_read(&app, &admin).await;
    assert_eq!(local_interval(&preserved), &before_local);
    assert_eq!(preserved["proposals"][0]["status"], "pending");
    assert!(preserved["decisions"].as_array().unwrap().is_empty());
    assert_eq!(
        detail(&app, &admin, &conflict.source_key).await["messages"][0]["rawText"],
        source_body
    );
    support::cleanup(&app.private.state).await;
}
