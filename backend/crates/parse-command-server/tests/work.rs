use parse_command_server::{
    api::role_identity,
    work::{self, Request},
};
use serde_json::{Value, json};
mod support;
fn parsed(name: &str) -> (work::Binding, Value) {
    let binding = work::bindings()
        .unwrap()
        .into_iter()
        .find(|b| b.name == name)
        .unwrap();
    let (id, rev) = binding.source_key.split_once('@').unwrap();
    let plan = match name {
        "original" => "MERIDIAN COMMS",
        "unassigned" => "MERIDIAN ENGINEERING",
        _ => "MERIDIAN FOLLOWUP",
    };
    let core = json!({"id":id,"revision":rev,"type":"OPTASK COMMS","command_ids":[work::COMMAND],"status":"partial","review_flags":["unprojected_sets"],"contacts":[{"name":"EXTERNAL"}],"activities":[{"id":"a1","type":"communications_plan_window","plan":plan,"status":"unvalidated","start_at":"2026-11-10T09:00:00Z","end_at":"2026-11-10T09:45:00Z"}]});
    (binding, core)
}
fn task(name: &str) -> work::Task {
    let (binding, core) = parsed(name);
    work::candidate(
        &binding,
        &core,
        "synthetic unit-test evidence",
        work::INITIAL_NOW,
    )
    .unwrap()
    .unwrap()
}
fn request(task: &work::Task, extra: Value) -> Request {
    let mut value =
        json!({"taskId":task.id,"expectedVersion":task.version,"eventVersion":task.event_version});
    value
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    serde_json::from_value(value).unwrap()
}
#[test]
fn explicit_routing_keeps_unknowns_and_source_contacts_separate() {
    let original = task("original");
    assert_eq!(original.owner_id.as_deref(), Some("demo:dev-user"));
    assert_eq!(original.person_id.as_deref(), Some("P-01"));
    assert_eq!(original.start.as_deref(), Some("2026-11-10T09:00:00Z"));
    assert_eq!(original.end.as_deref(), Some("2026-11-10T09:45:00Z"));
    assert!(original.due_basis.starts_with("Local demo policy"));
    assert_eq!(original.fact_status, "unvalidated");
    assert_eq!(original.source_contacts[0]["name"], "EXTERNAL");
    assert!(task("unknown-deadline").due_at.is_none());
    assert!(task("unassigned").owner_id.is_none());
    let (binding, mut core) = parsed("original");
    core["command_ids"] = json!(["other-command"]);
    assert!(
        work::candidate(&binding, &core, "", work::INITIAL_NOW)
            .unwrap()
            .is_none()
    );
    let (binding, core) = parsed("unrelated");
    assert!(
        work::candidate(&binding, &core, "", work::INITIAL_NOW)
            .unwrap()
            .is_none()
    );
}
#[test]
fn review_completion_and_overdue_are_independent_and_version_bound() {
    let mut task = task("original");
    let actor = role_identity("viewer").unwrap();
    assert!(!work::overdue(&task, work::INITIAL_NOW).unwrap());
    assert!(work::overdue(&task, "2026-11-10T09:01:00Z").unwrap());
    let complete = request(
        &task,
        json!({"progress":"completed","reason":"Coordination finished"}),
    );
    work::mutate(&mut task, &actor, "progress", &complete, work::INITIAL_NOW).unwrap();
    assert!(
        work::overdue(&task, "2026-11-10T09:01:00Z").unwrap(),
        "completion cannot satisfy review deadline"
    );
    let review = request(&task, json!({}));
    work::mutate(&mut task, &actor, "review", &review, work::INITIAL_NOW).unwrap();
    assert_eq!(task.progress, "completed");
    assert_eq!(task.review_flags, vec!["unprojected_sets"]);
    assert!(!work::overdue(&task, "2026-11-10T09:01:00Z").unwrap());
    assert_eq!(
        work::mutate(&mut task, &actor, "review", &review, work::INITIAL_NOW)
            .unwrap_err()
            .code,
        "aborted"
    );
    let replay = request(&task, json!({}));
    assert!(!work::mutate(&mut task, &actor, "review", &replay, work::INITIAL_NOW).unwrap());
    assert_eq!(task.reviews.len(), 1);
    task.event_version += 1;
    assert!(!work::reviewed(&task));
}
#[test]
fn review_does_not_start_work_and_ops_label_does_not_grant_permission() {
    let mut task = task("original");
    let actor = role_identity("viewer").unwrap();
    let input = request(&task, json!({}));
    work::mutate(&mut task, &actor, "review", &input, work::INITIAL_NOW).unwrap();
    assert_eq!(task.progress, "not_started");
    let mut outsider = actor.clone();
    outsider.owner = "another-ops-account".into();
    let input = request(&task, json!({"progress":"completed","reason":"OPS label"}));
    assert_eq!(
        work::mutate(&mut task, &outsider, "progress", &input, work::INITIAL_NOW)
            .unwrap_err()
            .code,
        "permission_denied"
    );
    assert!(serde_json::from_value::<Request>(json!({"actor":"forged"})).is_err());
}
#[test]
fn reassignment_requires_explicit_nullable_owner_and_preserves_reviews() {
    let mut task = task("original");
    let actor = role_identity("admin").unwrap();
    let input = request(&task, json!({"reason":"Move coordination"}));
    assert!(work::mutate(&mut task, &actor, "assign", &input, work::INITIAL_NOW).is_err());
    let input = request(&task, json!({"ownerId":null,"reason":"Await relief"}));
    work::mutate(&mut task, &actor, "assign", &input, work::INITIAL_NOW).unwrap();
    assert!(task.owner_id.is_none());
    let input = request(
        &task,
        json!({"ownerId":"demo:dev-user","reason":"Relief ready"}),
    );
    work::mutate(&mut task, &actor, "assign", &input, work::INITIAL_NOW).unwrap();
    assert_eq!(task.history.len(), 3);
    assert_eq!(task.history[1].actor, "demo:dev-admin");
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch with priority_scenario parsed and published"]
async fn persisted_workflow_collaboration_scope_replay_and_cas() {
    let app = support::app().await;
    app.private.create_session("admin").await.unwrap();
    app.private.create_session("viewer").await.unwrap();
    let admin = role_identity("admin").unwrap();
    let viewer = role_identity("viewer").unwrap();
    assert_eq!(
        work::execute(&app, &viewer, "setup", Request::default())
            .await
            .unwrap_err()
            .code,
        "permission_denied"
    );
    work::execute(&app, &admin, "setup", Request::default())
        .await
        .unwrap();
    let first = work::execute(&app, &admin, "list", Request::default())
        .await
        .unwrap();
    assert_eq!(
        first["items"].as_array().unwrap().len(),
        3,
        "publish actual scenario sources before this test"
    );
    let mut task: work::Task =
        work::load(&app).await.unwrap().unwrap().1.tasks["meridian-2026-11-10:original:review"]
            .clone();
    assert!(task.source_excerpt.contains("COMPLAN/MERIDIAN COMMS"));
    let review = request(&task, json!({}));
    let response = work::execute(&app, &viewer, "review", review)
        .await
        .unwrap();
    assert_eq!(response["item"]["progress"], "not_started");
    assert_eq!(response["item"]["reviews"][0]["actor"], viewer.owner);
    let (_, current) = work::load(&app).await.unwrap().unwrap();
    task = current.tasks[&task.id].clone();
    let updated = work::execute(
        &app,
        &admin,
        "assign",
        request(
            &task,
            json!({"ownerId":"demo:dev-admin","reason":"Turnover to coordinator"}),
        ),
    )
    .await
    .unwrap();
    assert_eq!(updated["item"]["reviews"].as_array().unwrap().len(), 1);
    let stale = work::execute(
        &app,
        &admin,
        "progress",
        request(&task, json!({"progress":"completed","reason":"Old screen"})),
    )
    .await
    .unwrap_err();
    assert_eq!(stale.code, "aborted");
    let (_, current) = work::load(&app).await.unwrap().unwrap();
    task = current.tasks[&task.id].clone();
    assert_eq!(
        work::execute(&app, &viewer, "review", request(&task, json!({})))
            .await
            .unwrap_err()
            .code,
        "permission_denied"
    );
    let replay = work::execute(&app, &admin, "list", Request::default())
        .await
        .unwrap();
    assert_eq!(replay["version"], current.version);
    assert_eq!(replay["items"].as_array().unwrap().len(), 3);
    let (old, mut a) = work::load(&app).await.unwrap().unwrap();
    let mut b = a.clone();
    a.extensions["sentinel"] = json!("preserved");
    a.version += 1;
    work::save(&app, &old, &a).await.unwrap();
    b.version += 1;
    assert_eq!(
        work::save(&app, &old, &b).await.unwrap_err().code,
        "aborted"
    );
    work::execute(&app, &admin, "list", Request::default())
        .await
        .unwrap();
    assert_eq!(
        work::load(&app).await.unwrap().unwrap().1.extensions["sentinel"],
        "preserved"
    );
    let session_before = parse_command_server::web::session(
        axum::extract::State(app.clone()),
        axum::http::HeaderMap::new(),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(session_before["userId"], viewer.owner);
    app.private.state.update("user", &viewer.owner, |old| {
        let mut row=old.unwrap().clone();
        row.payload["accountSettings"]=json!({"timezone":"UTC","calendarRefreshSeconds":30,"defaultCalendarView":"day","messageScope":{"allCommands":false,"commandIds":["other-command"],"includeUnassigned":false,"responsibilityIds":[]}});
        Ok(row)
    }).await.unwrap();
    let scoped = work::execute(&app, &viewer, "list", Request::default())
        .await
        .unwrap();
    assert!(scoped["items"].as_array().unwrap().is_empty());
    let session_after = parse_command_server::web::session(
        axum::extract::State(app.clone()),
        axum::http::HeaderMap::new(),
    )
    .await
    .unwrap()
    .0;
    assert_ne!(
        session_before["scope"], session_after["scope"],
        "scope changes must invalidate UI workflow caches"
    );
    for operation in ["detail", "evidence"] {
        let read = serde_json::from_value(json!({"key":task.source.message_key})).unwrap();
        assert_eq!(
            app.execute(operation, read, &viewer.owner)
                .await
                .unwrap_err()
                .code,
            "not_found",
            "direct source reads must respect the workflow's source boundary"
        );
    }
    let read =
        serde_json::from_value(json!({"from":"2026-11-10T00:00:00Z","to":"2026-11-11T00:00:00Z"}))
            .unwrap();
    let timeline = app.execute("timeline", read, &viewer.owner).await.unwrap();
    assert!(
        timeline["meta"]["timelineItems"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    assert_eq!(
        work::execute(&app, &viewer, "review", request(&task, json!({})))
            .await
            .unwrap_err()
            .code,
        "not_found"
    );
    assert_eq!(
        work::execute(
            &app,
            &admin,
            "assign",
            request(
                &task,
                json!({"ownerId":"demo:dev-user","reason":"Invalid scope"})
            )
        )
        .await
        .unwrap_err()
        .code,
        "not_found"
    );
    let reopened =
        parse_command_state::Store::new(&app.config.search, app.private.state.index()).unwrap();
    assert_eq!(
        work::decode(
            &reopened
                .get(work::KIND, work::SCENARIO)
                .await
                .unwrap()
                .unwrap()
        )
        .unwrap()
        .tasks
        .len(),
        3
    );
    support::cleanup(&app.private.state).await;
}
