use parse_command_server::lifecycle;
use parse_command_state::Record;
use serde_json::json;
mod support;
#[tokio::test]
#[ignore = "requires isolated OpenSearch test indices"]
async fn lifecycle_preserves_failure_recovery_exact_revision_and_pending_ack() {
    let store = support::store().await;
    for (i, state, source) in [
        (1, "staged", "body@r1"),
        (2, "retrying", "body@r1"),
        (3, "parsed", "body@r1"),
        (4, "quarantined", "other@r1"),
        (5, "quarantined", "body@r0"),
    ] {
        let mut row = Record::new(
            "custody_event",
            &i.to_string(),
            json!({"at":format!("2026-11-04T12:00:0{i}Z"),"code":"source failure"}),
        );
        row.source = source.into();
        row.state = state.into();
        row.order = i;
        store.put(&row, None).await.unwrap();
    }
    let mut job = Record::new(
        "publication",
        "message:body:r1",
        json!({"published_at":"2026-11-04T12:00:06Z"}),
    );
    job.state = "published".into();
    store.put(&job, None).await.unwrap();
    store.refresh().await.unwrap();
    let result = lifecycle::read(&store, "body", "r1").await.unwrap();
    let entries = result["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 4);
    assert_eq!(entries[1]["milestone"], "ingest_failed");
    assert_eq!(entries[3]["milestone"], "indexed");
    assert!(!result.to_string().contains("acknowledgement_sent"));
    support::cleanup(&store).await;
}
