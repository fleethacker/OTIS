use parse_command_server::{
    api::Filters,
    preparation::prepare,
    presentation,
    private::{Private, timestamp},
};
use serde_json::json;
mod support;
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn private_state_is_owner_and_revision_scoped_and_survives_reopen() {
    let store = support::store().await;
    let db = Private::new(store.clone());
    db.save_draft("one", "id@r1", "unsent draft").await.unwrap();
    assert!(
        db.draft("two", "id@r1")
            .await
            .unwrap()
            .get("draft")
            .is_none()
    );
    assert!(
        db.draft("one", "id@r2")
            .await
            .unwrap()
            .get("draft")
            .is_none()
    );
    assert!(
        db.acknowledge("one", "id@r1", true, true, "", "2026-11-04T10:00:00Z")
            .await
            .is_err()
    );
    drop(db);
    let db = Private::new(store.clone());
    assert_eq!(
        db.draft("one", "id@r1").await.unwrap()["draft"]["text"],
        "unsent draft"
    );
    assert_eq!(
        db.preparation("one", "id@r1").await.unwrap()["acknowledged"],
        false
    );
    support::cleanup(&store).await;
}
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn sessions_are_random_revocable_hashed_and_disabled_accounts_fail_closed() {
    let store = support::store().await;
    let db = Private::new(store.clone());
    let a = db.create_session("viewer").await.unwrap();
    let b = db.create_session("viewer").await.unwrap();
    assert_ne!(a, b);
    assert_eq!(db.session(&a).await.unwrap(), Some("viewer".into()));
    assert!(store.get("demo_session", &a).await.unwrap().is_none());
    db.logout(&a).await.unwrap();
    assert_eq!(db.session(&a).await.unwrap(), None);
    store
        .update("user", "demo:dev-user", |old| {
            let mut row = old.unwrap().clone();
            row.payload["epoch"] = json!(1);
            Ok(row)
        })
        .await
        .unwrap();
    assert_eq!(db.session(&b).await.unwrap(), None);
    let c = db.create_session("viewer").await.unwrap();
    store
        .update("user", "demo:dev-user", |old| {
            let mut row = old.unwrap().clone();
            row.payload["enabled"] = json!(false);
            Ok(row)
        })
        .await
        .unwrap();
    assert_eq!(db.session(&c).await.unwrap(), None);
    assert!(db.create_session("viewer").await.is_err());
    support::cleanup(&store).await;
}
#[test]
fn preparation_rejects_injection_and_requires_authority() {
    assert!(prepare(r#"{"outgoing":"SHIP//INJECT"}"#, false).is_err());
    assert!(prepare(r#"{"outgoing":"A","outgoing":"B"}"#, false).is_err());
    assert!(prepare("{}", true).is_err());
    assert!(prepare(r#"{"outgoing":null}"#, false).is_err());
    let value = json!({"outgoing":"SHIP","letter":"A","type":"MSG","originator":"COMMAND","dtg":"041000ZNOV2026","authority":"OPS","family":"ACTAGCY","response":"ACK","confirmed":true});
    let (_, text) = prepare(&value.to_string(), true).unwrap();
    assert!(text.contains("MSGID/AKNLDG/SHIP//"));
    assert!(text.ends_with("ACTAGCY/OPS/ACK/A//"));
}
#[test]
fn timestamp_comparisons_and_timeline_preserve_points_and_intervals() {
    assert!(
        timestamp("2026-11-04T10:00:00.1Z").unwrap() > timestamp("2026-11-04T10:00:00Z").unwrap()
    );
    assert!(timestamp("2026-11-04").is_err());
    let source = json!({"id":"source","revision":"r1","activities":[{"id":"point","type":"crypto","at":"2026-11-04T10:00:00Z"},{"id":"range","type":"event","start_at":"2026-11-04T09:00:00Z","end_at":"2026-11-04T11:00:00Z"},{"id":"missing","type":"event","start_at":"2026-11-04T09:00:00Z"}]});
    let (items, review) = presentation::timeline(
        &source,
        &timestamp("2026-11-04T00:00:00Z").unwrap(),
        &timestamp("2026-11-05T00:00:00Z").unwrap(),
    )
    .unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["kind"], "point");
    assert!(items[0].get("end").is_none());
    assert_eq!(review.len(), 1);
    assert!(items.iter().all(|i| i["reviewRequired"] == true));
}
#[test]
fn review_time_details_preserve_status_labels_and_normalized_clocks_across_views() {
    let source = json!({"id":"fictional","revision":"r1","activities":[
        {"id":"a1","type":"communications_plan_window","start_time":"12:00Z","end_time":"18:00Z","start_status":"missing_date","end_status":"missing_date"},
        {"id":"a2","type":"check","time_label":"051200Z","time_status":"missing_month_and_year"},
        {"id":"a3","type":"window","start_at":"2026-11-05T08:00:00Z","end_at":"2026-11-05T08:00:00Z"}
    ]});
    for (from, to) in [
        ("2026-11-05T00:00:00Z", "2026-11-06T00:00:00Z"),
        ("2026-11-01T00:00:00Z", "2026-11-08T00:00:00Z"),
        ("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
    ] {
        let (items, review) =
            presentation::timeline(&source, &timestamp(from).unwrap(), &timestamp(to).unwrap())
                .unwrap();
        assert!(items.is_empty());
        assert_eq!(review.len(), 3);
        assert_eq!(review[0]["timeDetails"][0]["status"], "missing_date");
        assert_eq!(review[0]["timeDetails"][0]["clock"], "12:00Z");
        assert!(review[0]["timeDetails"][0].get("label").is_none());
        assert_eq!(review[1]["timeDetails"][0]["label"], "051200Z");
        assert_eq!(review[2]["reasonCode"], "non_positive_interval");
        assert!(review[0].get("start").is_none());
    }
}
#[test]
fn filter_contract_rejects_unknown_fields_and_bad_intervals() {
    assert!(serde_json::from_value::<Filters>(json!({"script":"arbitrary"})).is_err());
    let f: Filters = serde_json::from_value(
        json!({"issuedFrom":"2026-11-05T00:00:00Z","issuedTo":"2026-11-04T00:00:00Z"}),
    )
    .unwrap();
    assert!(f.validate().is_err());
}
#[test]
fn search_headers_expose_only_source_type_originator_and_issue_time() {
    let core = json!({"id":"internal","revision":"parser-v1","type":"OPTASK COMMS","originator":"TRAINING COMMAND","issued_at":"2008-03-31T18:00:30Z","subject":"Example","review_flags":["internal_flag"],"activities":[{"type":"example"}]});
    assert_eq!(
        presentation::message_header(&core),
        json!({"type":"OPTASK COMMS","originator":"TRAINING COMMAND","issuedAt":"2008-03-31T18:00:30Z"})
    );
    assert_eq!(
        presentation::message_header(&json!({"type":null,"issued_at":null})),
        json!({})
    );
}

#[test]
fn casualty_filters_target_the_same_passage_and_canonical_metadata() {
    let filters:Filters=serde_json::from_value(json!({"messageTypes":["CASREP"],"casualtySerials":["2026001"],"casualtyUics":["N54321"],"casualtyCategories":["2"],"casualtyReportTypes":["INITIAL"],"casualtyIdentifiers":["1234-01-123-4567"]})).unwrap();
    let query = filters.validate().unwrap();
    for field in [
        "casualty.serial",
        "casualty.reporting_uic",
        "casualty.category",
        "casualty.report_type",
        "casualty.identifiers",
    ] {
        assert!(query.to_string().contains(field));
    }
    let oversized: Filters =
        serde_json::from_value(json!({"casualtySerials":["x".repeat(257)]})).unwrap();
    assert!(oversized.validate().is_err());
}
