use parse_command_server::{
    api::role_identity,
    context_metadata::{Citation, Suggestion},
    settings::{self, Request, Settings},
};
use serde_json::json;
mod support;
#[test]
fn settings_validate_authority_version_and_model_egress() {
    let mut settings = Settings::default();
    assert!(settings.validate().is_ok());
    settings.outgoing_command = "SHIP//INJECT".into();
    assert!(settings.validate().is_err());
    settings.outgoing_command = "SHIP".into();
    // The watch-context fields made version 2 current; the next unknown version fails.
    settings.version = 3;
    assert!(settings.validate().is_err());
    assert!(serde_json::from_value::<Settings>(json!({"version":1,"unknown":true})).is_err());
}
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn state_is_realtime_cas_and_settings_are_admin_only() {
    let app = support::app().await;
    let store = &app.private.state;
    let admin = role_identity("admin").unwrap();
    let viewer = role_identity("viewer").unwrap();
    settings::ensure_demo_user(store, &admin).await.unwrap();
    settings::ensure_demo_user(store, &viewer).await.unwrap();
    let doc = store.get("settings", "shared").await.unwrap().unwrap();
    let mut row = doc.record.clone();
    row.payload["settings"]["shipName"] = json!("EXAMPLE");
    store.put(&row, Some(&doc)).await.unwrap();
    assert!(store.put(&doc.record, Some(&doc)).await.is_err());
    assert_eq!(
        store
            .get("settings", "shared")
            .await
            .unwrap()
            .unwrap()
            .record
            .payload["settings"]["shipName"],
        "EXAMPLE"
    );
    for operation in ["update", "users", "update-user", "options", "test-ai"] {
        let error = settings::execute(&app, &viewer, operation, Request::default())
            .await
            .unwrap_err();
        assert_eq!(error.code, "permission_denied");
    }
    settings::execute(
        &app,
        &viewer,
        "save-preferences",
        Request {
            timezone: Some("America/Chicago".into()),
            ..Request::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        settings::execute(&app, &viewer, "preferences", Request::default())
            .await
            .unwrap()["timezone"],
        "America/Chicago"
    );
    assert_eq!(
        settings::execute(&app, &admin, "preferences", Request::default())
            .await
            .unwrap()["timezone"],
        "UTC"
    );
    assert!(
        settings::execute(
            &app,
            &viewer,
            "save-preferences",
            Request {
                timezone: Some("Mars/Not-a-zone".into()),
                ..Request::default()
            }
        )
        .await
        .is_err()
    );
    support::cleanup(store).await;
}

#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn http_origin_role_cookie_and_logout_boundaries() {
    use axum::{
        body::{Body, to_bytes},
        http::{Request as HttpRequest, StatusCode},
    };
    use tower::ServiceExt;
    let app = support::app().await;
    let store = app.private.state.clone();
    let routes = parse_command_server::http::router(app.clone());
    let request = |path: &str, origin: &str, cookie: &str, body: &str| {
        HttpRequest::post(path)
            .header("origin", origin)
            .header("cookie", cookie)
            .header("content-type", "application/json")
            .body(Body::from(body.to_owned()))
            .unwrap()
    };
    for origin in ["", "http://attacker.invalid"] {
        let response = routes
            .clone()
            .oneshot(request(
                "/api/v1/settings/save-preferences",
                origin,
                "",
                r#"{"timezone":"UTC"}"#,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    let response = routes
        .clone()
        .oneshot(request(
            "/api/v1/settings/users",
            "http://127.0.0.1:8080",
            "",
            "{}",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let token = app.private.create_session("admin").await.unwrap();
    let cookie = format!("parse_command_session={token}");
    let response = routes
        .clone()
        .oneshot(request(
            "/api/v1/settings/get",
            "http://127.0.0.1:8080",
            &cookie,
            "{}",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let settings: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    let mut changed = settings.clone();
    changed["settings"]["outgoingCommand"] = json!("EXAMPLE");
    changed["settings"]["actionAuthority"] = json!("OPS");
    let response = routes
        .clone()
        .oneshot(request(
            "/api/v1/settings/update",
            "http://127.0.0.1:8080",
            &cookie,
            &changed.to_string(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = routes
        .clone()
        .oneshot(request(
            "/api/v1/settings/update",
            "http://127.0.0.1:8080",
            &cookie,
            &changed.to_string(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let response = routes
        .clone()
        .oneshot(request(
            "/auth/logout",
            "http://127.0.0.1:8080",
            &cookie,
            "{}",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let set_cookie = response.headers()["set-cookie"].to_str().unwrap();
    assert!(set_cookie.contains("HttpOnly"));
    assert!(set_cookie.contains("Max-Age=0"));
    let response = routes
        .clone()
        .oneshot(request(
            "/api/v1/settings/get",
            "http://127.0.0.1:8080",
            &cookie,
            "{}",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    support::cleanup(&store).await;
}

#[test]
fn stored_version_one_settings_load_with_watch_defaults() {
    let v1 = json!({"version":1,"shipName":"EXAMPLE","unitName":"","commandIds":["cmd-a"],"outgoingCommand":"","actionAuthority":"","defaultTimezone":"UTC","ai":null});
    let settings = Settings::load(v1).unwrap();
    assert_eq!(settings.version, settings::VERSION);
    assert_eq!(settings.ship_name, "EXAMPLE");
    assert_eq!(settings.own_ship(), Some("cmd-a"));
    assert_eq!(settings.turnover_utc, settings::default_turnovers());
    assert!(settings.default_ships.is_empty());
    assert_eq!(settings.operation_name, "");
    assert!(settings.validate().is_ok());
    assert!(Settings::load(json!({"version":3,"shipName":"","unitName":"","commandIds":[],"outgoingCommand":"","actionAuthority":"","defaultTimezone":"UTC","ai":null})).is_err());
    let value = serde_json::to_value(&settings).unwrap();
    assert_eq!(
        value["turnoverUtc"],
        json!(["0000Z", "0400Z", "0800Z", "1200Z", "1600Z", "2000Z"])
    );
    assert_eq!(value["defaultShips"], json!([]));
}
#[test]
fn watch_fields_validate_turnovers_ships_and_bounded_text() {
    let valid = Settings::default();
    let check = |change: &dyn Fn(&mut Settings)| {
        let mut s = valid.clone();
        change(&mut s);
        s.validate()
    };
    assert!(check(&|s| s.turnover_utc = vec!["0400Z".into(), "1600Z".into()]).is_ok());
    for bad in [
        vec![],
        vec!["2400Z".into()],
        vec!["0460Z".into()],
        vec!["400Z".into()],
        vec!["0400".into()],
        vec!["1600Z".into(), "0400Z".into()],
        vec!["0400Z".into(), "0400Z".into()],
    ] {
        assert!(check(&|s| s.turnover_utc = bad.clone()).is_err(), "{bad:?}");
    }
    assert!(
        check(&|s| s.turnover_utc = (0..25).map(|h| format!("{:02}00Z", h % 24)).collect())
            .is_err()
    );
    assert!(
        check(&|s| s.default_ships = vec!["unassigned:".into(), "unit:demo-tern".into()]).is_ok()
    );
    for bad in [
        vec!["demo-tern".into()],
        vec!["unit:".into()],
        vec!["unit:b".into(), "unit:a".into()],
        vec!["unit:a\n".into()],
    ] {
        assert!(
            check(&|s| s.default_ships = bad.clone()).is_err(),
            "{bad:?}"
        );
    }
    assert!(check(&|s| s.operation_name = "FICTIONAL COPPER".into()).is_ok());
    assert!(check(&|s| s.operation_name = " PADDED".into()).is_err());
    assert!(check(&|s| s.group_command = "X".repeat(129)).is_err());
    assert!(check(&|s| s.group_command = "CTRL\u{7}".into()).is_err());
    assert!(serde_json::from_value::<Settings>(json!({"version":2,"shipName":"","unitName":"","commandIds":[],"outgoingCommand":"","actionAuthority":"","defaultTimezone":"UTC","ai":null,"ownShipId":"forged"})).is_err());
}
#[test]
fn demo_seed_uses_the_fictional_roster_as_shared_settings() {
    let demo = Settings::demo(&parse_command_server::commands::catalog(true).unwrap());
    assert!(demo.validate().is_ok());
    assert_eq!(demo.ship_name, "USS Meridian");
    assert_eq!(demo.command_ids, ["demo-meridian"]);
    assert_eq!(demo.turnover_utc, settings::default_turnovers());
    assert_eq!(
        demo.default_ships,
        [
            "unassigned:",
            "unit:demo-corvina",
            "unit:demo-halyard",
            "unit:demo-meridian",
            "unit:demo-tern"
        ]
    );
    let off = Settings::demo(&parse_command_server::commands::catalog(false).unwrap());
    assert!(off.command_ids.is_empty() && off.ship_name.is_empty());
}
fn suggestion(field: &'static str, sources: usize) -> Suggestion {
    let citation = Citation {
        message_key: "sha256:fictional@r1".into(),
        audit_id: "audit".into(),
        set_id: "EXER".into(),
        recorded_at: "2026-11-05T00:00:00Z".into(),
        start_byte: 0,
        end_byte: 8,
        line_start: 2,
        line_end: 2,
    };
    Suggestion {
        id: "context:fictional".into(),
        field,
        values: vec!["FICTIONAL COPPER".into()],
        sources: vec![citation; sources],
    }
}
#[test]
fn using_a_suggestion_goes_through_the_audited_settings_write() {
    let mut payload = json!({"settings":Settings::default(),"audit":[]});
    let used = settings::suggested(Settings::default(), &suggestion("operationName", 1)).unwrap();
    assert_eq!(used.operation_name, "FICTIONAL COPPER");
    assert!(settings::suggested(Settings::default(), &suggestion("operationName", 0)).is_err());
    assert!(settings::suggested(Settings::default(), &suggestion("shipName", 1)).is_err());
    let evidence =
        json!({"suggestion":"context:fictional","sources":suggestion("operationName", 1).sources});
    settings::apply(&mut payload, &used, "demo:dev-admin", "3:1", Some(evidence)).unwrap();
    assert_eq!(payload["settings"]["operationName"], "FICTIONAL COPPER");
    let entry = &payload["audit"][0];
    assert_eq!(entry["actor"], "demo:dev-admin");
    assert_eq!(entry["prior_revision"], "3:1");
    assert_eq!(entry["fields"], json!(["operationName"]));
    assert_eq!(entry["evidence"]["sources"][0]["lineStart"], 2);
    assert_eq!(
        entry["evidence"]["sources"][0]["messageKey"],
        "sha256:fictional@r1"
    );
    let mut manual = used.clone();
    manual.turnover_utc = vec!["0400Z".into()];
    settings::apply(&mut payload, &manual, "demo:dev-admin", "4:1", None).unwrap();
    assert_eq!(payload["audit"][1]["fields"], json!(["turnoverUtc"]));
    assert!(payload["audit"][1].get("evidence").is_none());
    for _ in 0..2 {
        settings::dismiss(&mut payload, "context:fictional").unwrap();
    }
    assert_eq!(payload["dismissed"], json!(["context:fictional"]));
}
