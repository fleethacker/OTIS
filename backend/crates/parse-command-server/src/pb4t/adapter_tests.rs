use super::*;
fn view_at(now: &str, future: bool) -> CurrentEvent {
    let mut versions=vec![serde_json::from_value::<crate::anchor_lineage::DeclaredVersion>(json!({
        "id":"original","source":{"messageKey":"original@r1","contentHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","factId":"a1"},
        "relationship":{"kind":"original"},"effectiveAt":"2026-11-10T08:00:00Z",
        "interval":{"start":"2026-11-10T10:30:00Z","end":"2026-11-10T11:15:00Z"},
        "provenance":"authored test relationship","parsedReviewRequired":false
    })).unwrap()];
    if future {
        versions.push(serde_json::from_value(json!({
            "id":"future","source":{"messageKey":"amendment@r1","contentHash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","factId":"a1"},
            "relationship":{"kind":"amends","target":"original"},"effectiveAt":"2026-11-10T09:30:00Z",
            "interval":{"start":"2026-11-10T11:00:00Z","end":"2026-11-10T11:45:00Z"},
            "provenance":"authored future relationship","parsedReviewRequired":true
        })).unwrap());
    }
    crate::anchor_lineage::resolve(EVENT_ID, &versions, now)
}
#[test]
fn absence_of_review_flags_never_certifies_source_events() {
    let workflow = Workflow {
        scenario_now: "2026-11-10T09:01:00Z".into(),
        ..Workflow::default()
    };
    let current = view_at(&workflow.scenario_now, false);
    assert_eq!(current.status, Status::Active);
    let result = calculation::assess(&inputs(&workflow, &seed().unwrap(), &current), 4096);
    assert_eq!(result.status, "feasible");
    assert!(result.provisional);
}
#[test]
fn known_future_effective_change_within_planning_window_is_incomplete() {
    let workflow = Workflow {
        scenario_now: "2026-11-10T09:01:00Z".into(),
        ..Workflow::default()
    };
    let current = view_at(&workflow.scenario_now, true);
    assert!(current.next_effective_at.is_some());
    let result = calculation::assess(&inputs(&workflow, &seed().unwrap(), &current), 4096);
    assert_eq!(result.status, "incomplete");
    assert!(result.alternative.is_none());
}
#[test]
fn unresolved_lineage_does_not_fall_back_to_a_task_time() {
    let workflow = Workflow::default();
    let current = crate::anchor_lineage::resolve(EVENT_ID, &[], &workflow.scenario_now);
    let result = calculation::assess(&inputs(&workflow, &seed().unwrap(), &current), 4096);
    assert_eq!(result.status, "incomplete");
}
