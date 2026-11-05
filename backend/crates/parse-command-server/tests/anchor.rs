//! Real parsed/published scenario sources; each test uses an isolated state index.
use parse_command_server::{
    anchor,
    anchor_lineage::Status,
    api::{App, Identity, ReadRequest, role_identity},
    settings, work,
};
use serde_json::{Value, json};
use std::sync::Arc;
mod support;
const TASK: &str = "meridian-2026-11-10:original:review";

fn binding(name: &str) -> work::Binding {
    let sources: Vec<work::Binding> =
        serde_json::from_str(include_str!("../../../config/priority-2/sources.json")).unwrap();
    sources.into_iter().find(|s| s.name == name).unwrap()
}
async fn workflow(app: &App) -> work::Workflow {
    work::load(app).await.unwrap().unwrap().1
}
async fn configured() -> Arc<App> {
    let app = support::app().await;
    let admin = role_identity("admin").unwrap();
    let viewer = role_identity("viewer").unwrap();
    settings::ensure_demo_user(&app.private.state, &admin)
        .await
        .unwrap();
    settings::ensure_demo_user(&app.private.state, &viewer)
        .await
        .unwrap();
    work::execute(&app, &admin, "setup", work::Request::default())
        .await
        .unwrap();
    let list = work::execute(&app, &admin, "list", work::Request::default())
        .await
        .unwrap();
    assert_eq!(
        list["items"].as_array().unwrap().len(),
        3,
        "Publish the actual priority-1/2 scenario before this test"
    );
    anchor::execute(
        &app,
        &admin,
        "setup",
        serde_json::from_value(json!({"expectedVersion":list["version"]})).unwrap(),
    )
    .await
    .unwrap();
    app
}
async fn current(app: &App, actor: &Identity) -> Value {
    anchor::execute(app, actor, "current", anchor::Request::default())
        .await
        .unwrap()
}
async fn declaration(app: &App, name: &str, id: &str, kind: &str, target: &str, at: &str) -> Value {
    let source = binding(name);
    json!({"expectedVersion":workflow(app).await.version,"logicalEventId":anchor::EVENT,
        "versionId":id,"source":{"messageKey":source.source_key,"factId":source.fact_id},
        "relationship":{"kind":kind,"target":target},"effectiveAt":at,
        "provenance":"Explicit synthetic integration-test relationship, not inferred from text"})
}
async fn declare(app: &App, request: &Value) -> Value {
    anchor::execute(
        app,
        &role_identity("admin").unwrap(),
        "declare",
        serde_json::from_value(request.clone()).unwrap(),
    )
    .await
    .unwrap()
}
fn decision(state: &work::Workflow, token: Option<&str>, extra: Value) -> work::Request {
    let task = &state.tasks[TASK];
    let mut request = json!({"taskId":TASK,"expectedVersion":task.version,"eventVersion":task.event_version,"currentVersionToken":token});
    request
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    serde_json::from_value(request).unwrap()
}
fn token(state: &work::Workflow) -> String {
    anchor::current_view(state, anchor::EVENT)
        .unwrap()
        .unwrap()
        .version_token
        .unwrap()
}
async fn review(app: &App, actor: &Identity) -> Value {
    let state = workflow(app).await;
    work::execute(
        app,
        actor,
        "review",
        decision(&state, Some(&token(&state)), json!({})),
    )
    .await
    .unwrap()
}
async fn clock(app: &App, at: &str) -> Value {
    work::execute(
        app,
        &role_identity("admin").unwrap(),
        "clock",
        serde_json::from_value(
            json!({"expectedVersion":workflow(app).await.version,"scenarioNow":at}),
        )
        .unwrap(),
    )
    .await
    .unwrap()
}
async fn timeline(app: &App, from: &str, to: &str) -> Value {
    let request: ReadRequest = serde_json::from_value(json!({"from":from,"to":to})).unwrap();
    app.execute("timeline", request, &role_identity("viewer").unwrap().owner)
        .await
        .unwrap()
}
fn managed_rows(timeline: &Value) -> Vec<&Value> {
    timeline["meta"]["timelineItems"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|row| row["logicalEventId"] == anchor::EVENT)
        .collect()
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch with priority-1/2 parsed and published"]
async fn original_amendment_cancellation_update_exact_item_and_persist_reviews() {
    let app = configured().await;
    let admin = role_identity("admin").unwrap();
    let viewer = role_identity("viewer").unwrap();
    let initial = workflow(&app).await;
    let source = initial.tasks[TASK].source.message_key.clone();
    let other_tasks = initial
        .tasks
        .iter()
        .filter(|(id, _)| id.as_str() != TASK)
        .map(|(id, task)| (id.clone(), json!(task)))
        .collect::<Vec<_>>();
    let first_review = review(&app, &viewer).await;
    assert_eq!(first_review["item"]["progress"], "not_started");
    let original_token = token(&workflow(&app).await);
    let old_reviews = first_review["item"]["reviews"].clone();
    let body = app.detail(&source).await.unwrap()["messages"][0]["rawText"].clone();
    assert!(body.as_str().unwrap().contains("100900ZNOV2026"));
    clock(&app, "2026-11-10T08:30:00Z").await;
    let amendment = declaration(
        &app,
        "amendment",
        "amendment",
        "amends",
        "original",
        "2026-11-10T08:30:00Z",
    )
    .await;
    let amended = declare(&app, &amendment).await;
    assert_eq!(amended["item"]["status"], "active");
    assert_eq!(amended["item"]["eventVersion"], 2);
    assert_eq!(amended["item"]["reviewed"], false);
    let state = workflow(&app).await;
    assert_eq!(state.tasks[TASK].progress, "not_started");
    assert_eq!(json!(state.tasks[TASK].reviews), old_reviews);
    let amended_binding = binding("amendment");
    let (id, revision) = amended_binding.source_key.split_once('@').unwrap();
    let amended_core = app.search.canonical(id, revision).await.unwrap();
    assert_eq!(
        json!(state.tasks[TASK].review_flags),
        amended_core["review_flags"]
    );
    assert_ne!(token(&state), original_token);
    for supplied in [Some(original_token.as_str()), None] {
        assert_eq!(
            work::execute(
                &app,
                &viewer,
                "review",
                decision(&state, supplied, json!({}))
            )
            .await
            .unwrap_err()
            .code,
            "aborted"
        );
    }
    assert_eq!(declare(&app, &amendment).await["duplicate"], true);
    assert_eq!(workflow(&app).await.version, state.version);
    let schedule = timeline(&app, "2026-11-10T10:00:00Z", "2026-11-10T12:00:00Z").await;
    let rows = managed_rows(&schedule);
    assert_eq!(
        rows.len(),
        1,
        "inject replacement even when original is outside requested window"
    );
    assert!(
        rows[0]["start"]
            .as_str()
            .unwrap()
            .starts_with("2026-11-10T10:30:00")
    );
    assert!(
        rows[0]["end"]
            .as_str()
            .unwrap()
            .starts_with("2026-11-10T11:15:00")
    );
    assert_eq!(rows[0]["messageKey"], binding("amendment").source_key);
    let old_window = timeline(&app, "2026-11-10T09:00:00Z", "2026-11-10T10:00:00Z").await;
    assert!(managed_rows(&old_window).is_empty());
    assert!(
        !old_window["meta"]["timelineItems"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["messageKey"] == source && row["factId"] == "a1")
    );
    clock(&app, "2026-11-10T09:01:00Z").await;
    assert!(work::overdue(&workflow(&app).await.tasks[TASK], "2026-11-10T09:01:00Z").unwrap());
    review(&app, &viewer).await;
    clock(&app, "2026-11-10T09:30:00Z").await;
    let cancellation = declaration(
        &app,
        "cancellation",
        "cancellation",
        "cancels",
        "amendment",
        "2026-11-10T09:30:00Z",
    )
    .await;
    declare(&app, &cancellation).await;
    let cancelled = current(&app, &viewer).await;
    assert_eq!(cancelled["items"][0]["status"], "cancelled");
    assert_eq!(cancelled["items"][0]["reviewed"], false);
    assert_eq!(cancelled["items"][0]["canReview"], true);
    let state = workflow(&app).await;
    let task = &state.tasks[TASK];
    assert!(task.start.is_none() && task.end.is_none() && task.due_at.is_none());
    assert!(task.action.starts_with("Review cancellation"));
    let list = work::execute(&app, &viewer, "list", work::Request::default())
        .await
        .unwrap();
    let row = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == TASK)
        .unwrap();
    assert_eq!(row["remindersActive"], false);
    assert_eq!(row["overdue"], false);
    let all_day = timeline(&app, "2026-11-10T00:00:00Z", "2026-11-11T00:00:00Z").await;
    assert!(managed_rows(&all_day).is_empty());
    assert!(
        all_day["meta"]["timelineItems"]
            .as_array()
            .unwrap()
            .iter()
            .any(
                |row| row["messageKey"] == binding("amendment").source_key && row["factId"] == "a2"
            ),
        "unrelated a2 survives selected a1 cancellation"
    );
    for (id, before) in other_tasks {
        assert_eq!(json!(state.tasks[&id]), before);
    }
    let reviewed = review(&app, &viewer).await;
    assert_eq!(reviewed["item"]["reviews"].as_array().unwrap().len(), 3);
    assert_eq!(reviewed["item"]["progress"], "not_started");
    assert_eq!(
        review(&app, &viewer).await["item"]["reviews"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        declare(&app, &amendment).await["item"]["status"],
        "cancelled"
    );
    assert_eq!(declare(&app, &cancellation).await["duplicate"], true);
    assert_eq!(
        app.detail(&source).await.unwrap()["messages"][0]["rawText"],
        body
    );
    let reader = anchor::execute(
        &app,
        &viewer,
        "current",
        serde_json::from_value(json!({"messageKey":source})).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(reader["items"][0]["history"].as_array().unwrap().len(), 3);
    assert_eq!(reader["items"][0]["status"], "cancelled");
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
    assert_eq!(persisted.tasks[TASK].reviews.len(), 3);
    assert_eq!(
        anchor::current_view(&persisted, anchor::EVENT)
            .unwrap()
            .unwrap()
            .status,
        Status::Cancelled
    );
    assert_eq!(persisted.tasks[TASK].reviews[2].actor, viewer.owner);
    assert_eq!(
        anchor::execute(
            &app,
            &admin,
            "setup",
            serde_json::from_value(json!({"expectedVersion":1})).unwrap()
        )
        .await
        .unwrap()["configured"],
        true
    );
    support::cleanup(&app.private.state).await;
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch with priority-1/2 parsed and published"]
async fn out_of_order_missing_target_resolves_without_resurrection() {
    let app = configured().await;
    let viewer = role_identity("viewer").unwrap();
    clock(&app, "2026-11-10T09:30:00Z").await;
    let cancellation = declaration(
        &app,
        "cancellation",
        "cancellation",
        "cancels",
        "amendment",
        "2026-11-10T09:30:00Z",
    )
    .await;
    let missing = declare(&app, &cancellation).await;
    assert_eq!(missing["item"]["status"], "unresolved");
    assert_eq!(missing["item"]["canReview"], false);
    assert!(workflow(&app).await.tasks[TASK].due_at.is_none());
    assert_eq!(current(&app, &viewer).await["complete"], false);
    let amendment = declaration(
        &app,
        "amendment",
        "amendment",
        "amends",
        "original",
        "2026-11-10T08:30:00Z",
    )
    .await;
    assert_eq!(
        declare(&app, &amendment).await["item"]["status"],
        "cancelled"
    );
    let before = workflow(&app).await;
    assert_eq!(declare(&app, &cancellation).await["duplicate"], true);
    assert_eq!(declare(&app, &amendment).await["duplicate"], true);
    let list = work::execute(&app, &viewer, "list", work::Request::default())
        .await
        .unwrap();
    assert_eq!(list["items"].as_array().unwrap().len(), 3);
    assert_eq!(workflow(&app).await.version, before.version);
    assert_eq!(
        anchor::current_view(&workflow(&app).await, anchor::EVENT)
            .unwrap()
            .unwrap()
            .status,
        Status::Cancelled
    );
    let backward: work::Request = serde_json::from_value(
        json!({"expectedVersion":before.version,"scenarioNow":"2026-11-10T08:15:00Z"}),
    )
    .unwrap();
    assert!(
        work::execute(&app, &role_identity("admin").unwrap(), "clock", backward)
            .await
            .is_err()
    );
    support::cleanup(&app.private.state).await;
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch with priority-1/2 parsed and published"]
async fn future_effective_versions_and_concurrent_cas_reject_stale_decisions() {
    let app = configured().await;
    let admin = role_identity("admin").unwrap();
    let viewer = role_identity("viewer").unwrap();
    review(&app, &viewer).await;
    let initial = workflow(&app).await;
    let old_token = token(&initial);
    let a = declaration(
        &app,
        "amendment",
        "future-a",
        "amends",
        "original",
        "2026-11-10T08:30:00Z",
    )
    .await;
    let mut b = a.clone();
    b["versionId"] = json!("future-b");
    let (left, right) = tokio::join!(
        anchor::execute(&app, &admin, "declare", serde_json::from_value(a).unwrap()),
        anchor::execute(&app, &admin, "declare", serde_json::from_value(b).unwrap())
    );
    assert_ne!(
        left.is_ok(),
        right.is_ok(),
        "only one same-version concurrent write may commit"
    );
    assert_eq!(
        left.as_ref().err().or(right.as_ref().err()).unwrap().code,
        "aborted"
    );
    let future = workflow(&app).await;
    assert_eq!(json!(future.tasks[TASK]), json!(initial.tasks[TASK]));
    assert_eq!(token(&future), old_token);
    let wrong_clock = serde_json::from_value(
        json!({"expectedVersion":initial.version,"scenarioNow":"2026-11-10T08:30:00Z"}),
    )
    .unwrap();
    assert_eq!(
        work::execute(&app, &admin, "clock", wrong_clock)
            .await
            .unwrap_err()
            .code,
        "aborted"
    );
    clock(&app, "2026-11-10T08:30:00Z").await;
    let effective = workflow(&app).await;
    assert_ne!(token(&effective), old_token);
    assert!(!work::reviewed(&effective.tasks[TASK]));
    assert_eq!(
        work::execute(
            &app,
            &viewer,
            "review",
            decision(&effective, Some(&old_token), json!({}))
        )
        .await
        .unwrap_err()
        .code,
        "aborted"
    );
    review(&app, &viewer).await;
    let (old_doc, mut planned) = work::load(&app).await.unwrap().unwrap();
    let mut stale = planned.clone();
    planned.extensions["planning"] = json!({"sentinel":"preserved"});
    planned.version += 1;
    work::save(&app, &old_doc, &planned).await.unwrap();
    stale.version += 1;
    assert_eq!(
        work::save(&app, &old_doc, &stale).await.unwrap_err().code,
        "aborted"
    );
    work::execute(&app, &admin, "list", work::Request::default())
        .await
        .unwrap();
    assert_eq!(
        workflow(&app).await.extensions["planning"]["sentinel"],
        "preserved"
    );
    support::cleanup(&app.private.state).await;
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch with priority-1/2 parsed and published"]
async fn ambiguous_branches_and_cycles_remain_unresolved_in_queue_and_calendar() {
    for cycle in [false, true] {
        let app = configured().await;
        let viewer = role_identity("viewer").unwrap();
        let old_token = token(&workflow(&app).await);
        clock(&app, "2026-11-10T08:45:00Z").await;
        let first = declaration(
            &app,
            "amendment",
            "a",
            "amends",
            if cycle { "b" } else { "original" },
            "2026-11-10T08:40:00Z",
        )
        .await;
        declare(&app, &first).await;
        let second = declaration(
            &app,
            "conflicting-amendment",
            "b",
            "amends",
            if cycle { "a" } else { "original" },
            "2026-11-10T08:40:00Z",
        )
        .await;
        let unresolved = declare(&app, &second).await;
        assert_eq!(unresolved["item"]["status"], "unresolved");
        assert!(unresolved["item"]["versionToken"].is_null());
        assert_eq!(unresolved["item"]["canReview"], false);
        assert_eq!(current(&app, &viewer).await["complete"], false);
        let state = workflow(&app).await;
        assert!(state.tasks[TASK].due_at.is_none());
        assert_eq!(
            work::execute(
                &app,
                &viewer,
                "review",
                decision(&state, Some(&old_token), json!({}))
            )
            .await
            .unwrap_err()
            .code,
            "aborted"
        );
        let schedule = timeline(&app, "2026-11-10T00:00:00Z", "2026-11-11T00:00:00Z").await;
        assert!(managed_rows(&schedule).is_empty());
        assert!(
            schedule["meta"]["reviewItems"]
                .as_array()
                .unwrap()
                .iter()
                .any(|row| row["title"] == "Current version unresolved")
        );
        support::cleanup(&app.private.state).await;
    }
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch with priority-1/2 parsed and published"]
async fn anchor_http_actor_and_scope_enforce_shared_state_boundaries() {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;
    let app = configured().await;
    let admin = role_identity("admin").unwrap();
    let viewer = role_identity("viewer").unwrap();
    let declaration = declaration(
        &app,
        "amendment",
        "amendment",
        "amends",
        "original",
        "2026-11-10T08:30:00Z",
    )
    .await;
    assert_eq!(
        anchor::execute(
            &app,
            &viewer,
            "declare",
            serde_json::from_value(declaration.clone()).unwrap()
        )
        .await
        .unwrap_err()
        .code,
        "permission_denied"
    );
    let mut outsider = viewer.clone();
    outsider.owner = "demo:other-ops-user".into();
    outsider.username = "OPS".into();
    settings::ensure_demo_user(&app.private.state, &outsider)
        .await
        .unwrap();
    assert_eq!(
        current(&app, &outsider).await["items"][0]["canReview"],
        false
    );
    let state = workflow(&app).await;
    assert_eq!(
        work::execute(
            &app,
            &outsider,
            "review",
            decision(&state, Some(&token(&state)), json!({}))
        )
        .await
        .unwrap_err()
        .code,
        "permission_denied"
    );
    let router = parse_command_server::http::router(app.clone());
    let request = Request::post("/api/v1/anchor/current")
        .header("origin", "http://attacker.invalid")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    assert_eq!(
        router.clone().oneshot(request).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let request = Request::post("/api/v1/anchor/current")
        .header("origin", "http://127.0.0.1:8080")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"actor":"forged"}"#))
        .unwrap();
    assert_eq!(
        router.oneshot(request).await.unwrap().status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    app.private.state.update("user", &viewer.owner, |old| {
        let mut row = old.unwrap().clone();
        row.payload["accountSettings"] = json!({"timezone":"UTC","calendarRefreshSeconds":30,"defaultCalendarView":"day","messageScope":{"allCommands":false,"commandIds":["other-command"],"includeUnassigned":false,"responsibilityIds":[]}});
        Ok(row)
    }).await.unwrap();
    let scoped = current(&app, &viewer).await;
    assert!(scoped["items"].as_array().unwrap().is_empty());
    assert_eq!(scoped["complete"], false);
    for supplied in [
        Some(token(&state)),
        Some("stale-or-guessed-token".into()),
        None,
    ] {
        assert_eq!(
            work::execute(
                &app,
                &viewer,
                "review",
                decision(&state, supplied.as_deref(), json!({}))
            )
            .await
            .unwrap_err()
            .code,
            "not_found",
            "source access must be checked before version feedback"
        );
    }
    assert_eq!(
        anchor::execute(
            &app,
            &viewer,
            "current",
            serde_json::from_value(json!({"messageKey":state.tasks[TASK].source.message_key}))
                .unwrap()
        )
        .await
        .unwrap_err()
        .code,
        "not_found"
    );
    app.private
        .state
        .update("user", &admin.owner, |old| {
            let mut row = old.unwrap().clone();
            row.payload["enabled"] = json!(false);
            Ok(row)
        })
        .await
        .unwrap();
    assert_eq!(
        anchor::execute(
            &app,
            &admin,
            "declare",
            serde_json::from_value(declaration).unwrap()
        )
        .await
        .unwrap_err()
        .code,
        "permission_denied"
    );
    support::cleanup(&app.private.state).await;
}
