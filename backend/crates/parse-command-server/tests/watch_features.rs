use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use parse_command_server::{
    accounts, briefing, changes, notifications, settings, station, watch_context,
};
use parse_command_state::Record;
use serde_json::{Value, json};
mod support;
fn scope(ids: Option<Vec<String>>) -> station::ResolvedScope {
    station::ResolvedScope {
        assigned_commands: ids,
        include_unassigned: false,
        message_types: Some(vec!["OPTASK COMMS".into()]),
        match_none: false,
        fingerprint: "station-a".into(),
        context: json!({}),
    }
}
fn core(id: &str, rev: &str, ship: &str) -> Value {
    json!({"id":parse_command_types::message_id(id),"revision":rev,"subject":id,"type":"OPTASK COMMS","originator":"FICTIONAL","command_ids":[ship],"issued_at":"2026-11-05T10:00:00Z"})
}
fn window() -> briefing::LoginWindow {
    briefing::LoginWindow {
        started_at: "2026-11-05T12:00:00Z".into(),
        previous_login_at: None,
        briefing_available: true,
        since: None,
        lower: None,
        upper: Some(2),
        window_id: "session-a".into(),
    }
}
#[test]
fn ledger_replay_is_immutable_and_frozen_windows_use_latest_revision_before_login() {
    let first =
        briefing::append(None, &core("one", "r1", "ship-a"), "2026-11-05T10:01:00Z").unwrap();
    let replay = briefing::append(
        Some(&first),
        &core("one", "r1", "ship-b"),
        "2026-11-05T11:00:00Z",
    )
    .unwrap();
    assert_eq!(first.payload, replay.payload);
    let second = briefing::append(
        Some(&first),
        &core("two", "r1", "ship-a"),
        "2026-11-05T10:02:00Z",
    )
    .unwrap();
    let revised = briefing::append(
        Some(&second),
        &core("one", "r2", "ship-b"),
        "2026-11-05T12:01:00Z",
    )
    .unwrap();
    let entries = revised.payload["entries"].as_array().unwrap();
    let result = briefing::read_page(
        entries,
        &window(),
        &scope(Some(vec!["ship-a".into()])),
        None,
    )
    .unwrap();
    assert_eq!(result["totalRecords"], 2);
    assert!(
        result["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["messageKey"] == format!("{}@r1", parse_command_types::message_id("one")))
    );
    let mut later = window();
    later.upper = Some(3);
    later.lower = Some(2);
    assert_eq!(
        briefing::read_page(entries, &later, &scope(None), None).unwrap()["totalRecords"],
        0,
        "reinterpretation is not a new body"
    );
    assert!(briefing::read_page(entries, &window(), &scope(None), Some("different:1")).is_err());
}
#[test]
fn station_filter_and_turnover_do_not_expose_other_stations_and_use_source_time() {
    let first =
        briefing::append(None, &core("one", "r1", "ship-a"), "2026-11-06T10:01:00Z").unwrap();
    let second = briefing::append(
        Some(&first),
        &core("two", "r1", "ship-b"),
        "2026-11-06T10:02:00Z",
    )
    .unwrap();
    let request: changes::Request = serde_json::from_value(
        json!({"since":"2026-11-05T09:00:00Z","until":"2026-11-05T11:00:00Z"}),
    )
    .unwrap();
    let result = changes::read_entries(
        second.payload["entries"].as_array().unwrap(),
        &request,
        &scope(Some(vec!["ship-a".into()])),
    )
    .unwrap();
    assert_eq!(result["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        result["items"][0]["messageKey"],
        format!("{}@r1", parse_command_types::message_id("one"))
    );
    assert_eq!(
        result["hiddenCount"], 0,
        "other stations never appear in hidden counts"
    );
    assert_eq!(result["items"][0]["basis"], "source_issue_time");
    assert!(
        !scope(Some(vec!["ship-a".into()]))
            .matches(&core("b", "r1", "ship-b"))
            .unwrap()
    );
}
#[test]
fn preferences_use_iana_and_profile_writes_cannot_change_roles_or_active_state() {
    let mut prefs = accounts::Settings {
        timezone: "America/Chicago".into(),
        ..Default::default()
    };
    assert!(prefs.validate().is_ok());
    prefs.timezone = "local".into();
    assert!(prefs.validate().is_err());
    assert!(serde_json::from_value::<accounts::UserUpdate>(json!({"role":"admin"})).is_err());
    assert!(serde_json::from_value::<accounts::UserUpdate>(json!({"active":false})).is_err());
    assert_eq!(
        parse_command_server::web::shift_return("https://attacker.invalid"),
        "/shift?returnTo=%2Fcalendar"
    );
    assert_eq!(
        parse_command_server::web::shift_return("/settings"),
        "/shift?returnTo=%2Fsettings"
    );
    assert_eq!(
        parse_command_server::web::shift_return("/shift?returnTo=/calendar"),
        "/shift"
    );
}

#[test]
fn watch_context_uses_indexed_commands_without_demo_roster() {
    let snapshot: watch_context::Snapshot = serde_json::from_value(json!({
        "context":{"ownShipId":"","shipName":"","operationName":"","groupCommand":"","defaultShips":[],"turnoverUtc":["0400Z"]},
        "confirmations":{},"updatedBy":null,"updatedAt":null,"dismissed":[]
    })).unwrap();
    let request = || {
        serde_json::from_value(json!({"changes":[
            {"field":"ownShipId","values":["SHIP-REAL"]},
            {"field":"defaultShips","values":["unit:SHIP-REAL","unassigned:"]}
        ]}))
        .unwrap()
    };
    assert!(
        watch_context::update_with_commands(
            snapshot.clone(),
            request(),
            "admin",
            &Default::default(),
            false,
            &[]
        )
        .is_err()
    );
    let result = watch_context::update_with_commands(
        snapshot,
        request(),
        "admin",
        &Default::default(),
        false,
        &["SHIP-REAL".into()],
    )
    .unwrap();
    assert_eq!(result.context.own_ship_id, "SHIP-REAL");
    assert!(
        result
            .context
            .default_ships
            .contains(&"unit:SHIP-REAL".into())
    );
}
fn headers(token: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        "cookie",
        format!("parse_command_session={token}").parse().unwrap(),
    );
    headers
}
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn native_profile_metadata_persists_and_station_profiles_only_narrow_preferences() {
    let app = support::app().await;
    let admin = app.private.create_session("admin").await.unwrap();
    let viewer = app.private.create_session("viewer").await.unwrap();
    app.private.state.put(&Record::new("responsibility","ops",json!({"id":"ops","name":"Operations","kind":"department","messageTypes":["OPTASK COMMS"]})),None).await.unwrap();
    let input:accounts::UserUpdate=serde_json::from_value(json!({"stationAssignment":{"shipName":"A","commandIds":["ship-a"],"department":"Ops","watchStation":"Watch","responsibilityIds":["ops"],"includeUnassigned":false}})).unwrap();
    let response = accounts::update_user(
        State(app.clone()),
        Path("demo:dev-user".into()),
        headers(&admin),
        Json(input),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(response["user"]["role"], "viewer");
    assert!(
        app.private.session(&viewer).await.unwrap().is_none(),
        "assignment change revokes prior native session epoch"
    );
    let viewer = app.private.create_session("viewer").await.unwrap();
    let input = accounts::Settings {
        timezone: "Pacific/Honolulu".into(),
        message_scope: briefing::MessageScope {
            all_commands: false,
            command_ids: vec!["ship-a".into(), "ship-b".into()],
            include_unassigned: true,
            responsibility_ids: vec!["ops".into()],
        },
        ..Default::default()
    };
    let response = accounts::save_settings(State(app.clone()), headers(&viewer), Json(input))
        .await
        .unwrap()
        .0;
    assert_eq!(response["timezone"], "Pacific/Honolulu");
    let effective = station::effective_scope(&app.private, "demo:dev-user")
        .await
        .unwrap();
    assert_eq!(effective.assigned_commands, Some(vec!["ship-a".into()]));
    assert!(!effective.include_unassigned);
    assert!(!effective.matches(&core("other", "r1", "ship-b")).unwrap());
    let identity = parse_command_server::api::role_identity("viewer").unwrap();
    assert_eq!(
        settings::execute(&app, &identity, "preferences", settings::Request::default())
            .await
            .unwrap()["timezone"],
        "Pacific/Honolulu"
    );
    settings::execute(
        &app,
        &identity,
        "save-preferences",
        settings::Request {
            timezone: Some("America/New_York".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        accounts::preferences(&app.private.state, "demo:dev-user")
            .await
            .unwrap()
            .timezone,
        "America/New_York"
    );
    assert!(
        accounts::account(&app.private.state, "demo:dev-user")
            .await
            .unwrap()
            .permissions()
            .contains(&"draft:write")
    );
    let before = effective.fingerprint;
    app.private
        .state
        .update("responsibility", "ops", |old| {
            let mut row = old.unwrap().clone();
            row.payload["messageTypes"] = json!(["OTHER"]);
            Ok(row)
        })
        .await
        .unwrap();
    assert_ne!(
        before,
        station::effective_scope(&app.private, "demo:dev-user")
            .await
            .unwrap()
            .fingerprint
    );
    support::cleanup(&app.private.state).await;
}
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn native_login_snapshot_does_not_advance_on_profile_reads() {
    let app = support::app().await;
    app.custody
        .update("availability_log", "committed", |old| {
            briefing::append(old, &core("one", "r1", "ship-a"), "2026-11-05T10:00:00Z")
        })
        .await
        .unwrap();
    let token = app.private.create_session("viewer").await.unwrap();
    briefing::capture(&app, &token).await.unwrap();
    let first = briefing::session_window(&app, &headers(&token))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first.upper, Some(1));
    assert_eq!(first.lower, None);
    app.custody
        .update("availability_log", "committed", |old| {
            briefing::append(old, &core("two", "r1", "ship-a"), "2026-11-05T11:00:00Z")
        })
        .await
        .unwrap();
    briefing::capture(&app, &token).await.unwrap();
    let again = briefing::session_window(&app, &headers(&token))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(again.upper, Some(1));
    let result = accounts::profile(State(app.clone()), headers(&token))
        .await
        .unwrap()
        .0;
    assert_eq!(result["openBriefing"], false);
    let next = app.private.create_session("viewer").await.unwrap();
    briefing::capture(&app, &next).await.unwrap();
    let second = briefing::session_window(&app, &headers(&next))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(second.lower, Some(1));
    assert_eq!(second.upper, Some(2));
    assert_eq!(
        briefing::session_window(&app, &headers(&token))
            .await
            .unwrap()
            .unwrap()
            .upper,
        Some(1)
    );
    support::cleanup(&app.private.state).await;
}
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn notification_counts_members_and_reads_are_scope_bound() {
    let app = support::app().await;
    for (id, ship) in [("one", "ship-a"), ("two", "ship-b")] {
        app.custody
            .update("availability_log", "committed", |old| {
                briefing::append(old, &core(id, "r1", ship), "2026-11-05T10:00:00Z")
            })
            .await
            .unwrap();
    }
    let mut notification = Record::new(
        "notification",
        "traffic:1",
        json!({"id":1,"kind":"traffic","count":2,"members":{"one":{"messageKey":format!("{}@r1", parse_command_types::message_id("one")),"subject":"Allowed","context":"A","at":"2026-11-05T10:00:00Z","version":1},"two":{"messageKey":format!("{}@r1", parse_command_types::message_id("two")),"subject":"Hidden","context":"B","at":"2026-11-05T10:01:00Z","version":2}}}),
    );
    notification.order = 2;
    app.private.state.put(&notification, None).await.unwrap();
    app.private
        .state
        .put(
            &Record::new("notification_id", "1", json!({"key":"traffic:1"})),
            None,
        )
        .await
        .unwrap();
    let mut counter = Record::new("counter", "notifications", json!({}));
    counter.order = 2;
    app.private.state.put(&counter, None).await.unwrap();
    app.private.state.refresh().await.unwrap();
    let a = scope(Some(vec!["ship-a".into()]));
    let list = notifications::execute_scoped(&app, "owner", "list", Default::default(), &a)
        .await
        .unwrap();
    assert_eq!(list["items"][0]["count"], 1);
    assert_eq!(list["items"][0]["version"], 1);
    assert_eq!(list["unread"], 1);
    assert!(!list.to_string().contains("Hidden"));
    let members = notifications::execute_scoped(
        &app,
        "owner",
        "members",
        notifications::Request {
            id: Some(1),
            ..Default::default()
        },
        &a,
    )
    .await
    .unwrap();
    assert_eq!(members["items"].as_array().unwrap().len(), 1);
    notifications::execute_scoped(
        &app,
        "owner",
        "read",
        notifications::Request {
            through: Some(1),
            ..Default::default()
        },
        &a,
    )
    .await
    .unwrap();
    assert_eq!(
        notifications::execute_scoped(&app, "owner", "list", Default::default(), &a)
            .await
            .unwrap()["unread"],
        0
    );
    let mut b = scope(Some(vec!["ship-b".into()]));
    b.fingerprint = "station-b".into();
    assert_eq!(
        notifications::execute_scoped(&app, "owner", "list", Default::default(), &b)
            .await
            .unwrap()["unread"],
        1
    );
    support::cleanup(&app.private.state).await;
}
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn watch_context_batches_validate_before_cas_and_preserve_server_actor() {
    let store = support::store().await;
    let snapshot = watch_context::read(&store, false).await.unwrap();
    let invalid=serde_json::from_value(json!({"changes":[{"field":"operationName","values":["SHOULD NOT SAVE"]},{"field":"turnoverUtc","values":["2400Z"]}]})).unwrap();
    assert!(
        watch_context::update(
            snapshot.clone(),
            invalid,
            "admin",
            &Default::default(),
            false
        )
        .is_err()
    );
    let request=serde_json::from_value(json!({"changes":[{"field":"operationName","values":["FICTIONAL"]},{"field":"turnoverUtc","values":["0400Z","0800Z"]}]})).unwrap();
    let updated = watch_context::update(
        snapshot,
        request,
        "verified-owner",
        &Default::default(),
        false,
    )
    .unwrap();
    store
        .put(
            &Record::new("watch_context", "shared", json!(updated)),
            None,
        )
        .await
        .unwrap();
    let saved = watch_context::read(&store, false).await.unwrap();
    assert_eq!(saved.updated_by.as_deref(), Some("verified-owner"));
    assert_eq!(saved.context.operation_name, "FICTIONAL");
    support::cleanup(&store).await;
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn watch_context_and_native_settings_share_one_authoritative_cas_document() {
    let store = support::store().await;
    settings::bootstrap(&store).await.unwrap();
    let (mut native, before) = settings::shared(&store).await.unwrap();
    native.operation_name = "NATIVE SETTINGS".into();
    let mut row = before.record.clone();
    settings::apply(
        &mut row.payload,
        &native,
        "native-admin",
        &settings::revision(&before),
        None,
    )
    .unwrap();
    store.put(&row, Some(&before)).await.unwrap();
    let snapshot = watch_context::read(&store, false).await.unwrap();
    assert_eq!(snapshot.context.operation_name, "NATIVE SETTINGS");

    let request = serde_json::from_value(json!({"changes":[
        {"field":"operationName","values":["WATCH SETTINGS"]},
        {"field":"turnoverUtc","values":["0400Z","0800Z"]}
    ]}))
    .unwrap();
    let updated =
        watch_context::update(snapshot, request, "watch-admin", &Default::default(), false)
            .unwrap();
    let (_, before) = settings::shared(&store).await.unwrap();
    watch_context::save(&store, updated.clone(), &before, "watch-admin")
        .await
        .unwrap();
    assert!(
        watch_context::save(&store, updated, &before, "stale-admin")
            .await
            .is_err()
    );
    let (mut native, doc) = settings::shared(&store).await.unwrap();
    assert_eq!(native.operation_name, "WATCH SETTINGS");
    assert_eq!(native.turnover_utc, ["0400Z", "0800Z"]);
    assert_eq!(
        doc.record.payload["watch_context"]["confirmations"]["operationName"]["actor"],
        "watch-admin"
    );
    assert!(
        store
            .get("watch_context", "shared")
            .await
            .unwrap()
            .is_none()
    );

    native.operation_name = "NATIVE UPDATE".into();
    let mut row = doc.record.clone();
    settings::apply(
        &mut row.payload,
        &native,
        "native-admin",
        &settings::revision(&doc),
        None,
    )
    .unwrap();
    store.put(&row, Some(&doc)).await.unwrap();
    let snapshot = watch_context::read(&store, false).await.unwrap();
    assert_eq!(snapshot.context.operation_name, "NATIVE UPDATE");
    assert!(
        !snapshot
            .confirmations
            .contains_key(&watch_context::Field::OperationName)
    );
    assert!(
        snapshot
            .confirmations
            .contains_key(&watch_context::Field::TurnoverUtc)
    );

    let (_, doc) = settings::shared(&store).await.unwrap();
    let mut row = doc.record.clone();
    settings::dismiss(&mut row.payload, "context:native-dismissal").unwrap();
    store.put(&row, Some(&doc)).await.unwrap();
    let mut snapshot = watch_context::read(&store, false).await.unwrap();
    assert!(
        snapshot
            .dismissed
            .contains(&"context:native-dismissal".into())
    );
    snapshot.dismissed.push("context:watch-dismissal".into());
    let (_, doc) = settings::shared(&store).await.unwrap();
    watch_context::save(&store, snapshot, &doc, "watch-admin")
        .await
        .unwrap();
    let (_, doc) = settings::shared(&store).await.unwrap();
    assert_eq!(
        doc.record.payload["dismissed"],
        json!(["context:native-dismissal", "context:watch-dismissal"])
    );
    support::cleanup(&store).await;
}
