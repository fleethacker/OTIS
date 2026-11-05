use parse_command_server::casualties::{key, project};
use serde_json::{Value, json};
fn report(id: &str, action: &str, at: &str, sequence: Option<&str>) -> Value {
    let mut v = json!({"id":id,"revision":"v1","type":"CASREP","issued_at":at,"security":{"policy":"TEST","classification":"unclassified","release_to":[],"status":"unvalidated"},"command_ids":[],"casualty":{"report_type":action,"serial":"2026001","reporting_uic":"N54321","equipment":"TEST RADAR","eic":"AB12","category":"2","cause":"1"}});
    if action != "INITIAL" {
        v["casualty"]["initial_report_label"] = json!("051200ZNOV2026");
    }
    if let Some(s) = sequence {
        v["casualty"]["update_sequence"] = json!(s);
    }
    v
}
#[test]
fn late_arrivals_rebuild_the_same_report_history_without_regressing_state() {
    let initial = report("initial", "INITIAL", "2026-11-05T12:00:00Z", None);
    let update = report("update", "UPDATE", "2026-11-06T12:00:00Z", Some("01"));
    let correct = report("correct", "CORRECT", "2026-11-07T12:00:00Z", None);
    assert_eq!(key(&initial), key(&update));
    let missing = project(std::slice::from_ref(&update), false);
    assert_eq!(missing[0]["state"], "unresolved");
    let a = project(&[correct.clone(), initial.clone(), update.clone()], false);
    let b = project(&[initial, update, correct], false);
    assert_eq!(a, b);
    assert_eq!(a.len(), 1);
    assert_eq!(a[0]["state"], "reported_corrected");
    assert_eq!(a[0]["latest_message_key"], "correct@v1");
    assert_eq!(a[0]["review_required"], true);
}
#[test]
fn cancellation_and_ambiguous_histories_never_imply_repaired_equipment() {
    let initial = report("initial", "INITIAL", "2026-11-05T12:00:00Z", None);
    let cancel = report("cancel", "CANCEL", "2026-11-06T12:00:00Z", None);
    let view = project(&[initial.clone(), cancel.clone()], false);
    assert_eq!(view[0]["state"], "report_cancelled");
    let later = report("later", "UPDATE", "2026-11-07T12:00:00Z", Some("01"));
    assert_eq!(
        project(&[initial.clone(), cancel, later], false)[0]["state"],
        "unresolved"
    );
    let conflicting = report("other-initial", "INITIAL", "2026-11-05T12:00:30Z", None);
    assert_eq!(
        project(&[initial.clone(), conflicting], false)[0]["state"],
        "unresolved"
    );
    assert_eq!(project(&[initial], true)[0]["state"], "unresolved");
}
#[test]
fn references_security_scope_and_revision_cannot_accidentally_join() {
    let initial = report("initial", "INITIAL", "2026-11-05T12:00:00Z", None);
    for variant in ["reference", "security", "revision", "command"] {
        let mut update = report("update", "UPDATE", "2026-11-06T12:00:00Z", Some("01"));
        match variant {
            "reference" => update["casualty"]["initial_report_label"] = json!("041200ZNOV2026"),
            "security" => update["security"]["classification"] = json!("secret"),
            "revision" => update["revision"] = json!("v2"),
            _ => update["command_ids"] = json!(["different-command"]),
        }
        assert_ne!(key(&initial), key(&update));
        assert_eq!(project(&[initial.clone(), update], false).len(), 2);
    }
    let mut genadmin = initial.clone();
    genadmin["type"] = json!("GENADMIN");
    assert!(project(&[genadmin], false).is_empty());
}
#[test]
fn conflicting_or_missing_update_sequence_requires_review() {
    let initial = report("initial", "INITIAL", "2026-11-05T12:00:00Z", None);
    let a = report("a", "UPDATE", "2026-11-06T12:00:00Z", Some("02"));
    let b = report("b", "UPDATE", "2026-11-07T12:00:00Z", Some("01"));
    let view = project(&[initial, a, b], false);
    assert_eq!(view[0]["state"], "unresolved");
    assert!(
        view[0]["review_flags"]
            .as_array()
            .unwrap()
            .contains(&json!("conflicting_update_sequence"))
    );
}
