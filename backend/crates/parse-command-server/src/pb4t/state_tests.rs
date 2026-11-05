use super::calculation::{Event, Inputs, Interval};
use super::state::{DecisionRequest, Planning};
fn planning() -> Planning {
    serde_json::from_str(include_str!("../../../../config/priority-3/personnel.json")).unwrap()
}
fn inputs(p: &Planning) -> Inputs {
    Inputs {
        people: p.people.clone(),
        events: vec![
            Event {
                id: "communications".into(),
                title: "Fixed communications".into(),
                interval: Some(Interval {
                    start: "2026-11-10T10:30:00Z".into(),
                    end: "2026-11-10T11:15:00Z".into(),
                }),
                person_ids: vec!["P-01".into()],
                required_qualifications: Some(vec!["demo-comms-training".into()]),
                fixed: true,
                source_ref: "source-amendment@v1".into(),
                version: "anchor:2".into(),
                validated: false,
                buffer_before_minutes: None,
                buffer_after_minutes: None,
            },
            p.local_event.clone(),
        ],
        rules: p.rules.clone(),
        roster_observed_at: p.roster_observed_at.clone(),
        roster_valid_until: p.roster_valid_until.clone(),
        assessed_at: "2026-11-10T09:01:00Z".into(),
        schedule_complete: p.schedule_complete,
        coverage: p.coverage.clone(),
    }
}
#[test]
fn accept_only_local_event_and_preserve_auditable_inputs() {
    let mut p = planning();
    let original = inputs(&p);
    p.propose(
        original.clone(),
        "anchor:2",
        "demo:admin",
        "2026-11-05T15:00:00Z",
    )
    .unwrap();
    let id = p.proposals[0].id.clone();
    p.decide(
        DecisionRequest {
            proposal_id: &id,
            decision: "accept",
            reason: "fits the window",
            actor: "demo:admin",
            recorded_at: "2026-11-05T15:01:00Z",
        },
        &original,
        "anchor:2",
    )
    .unwrap();
    assert_eq!(
        p.local_event.interval.as_ref().unwrap().start,
        "2026-11-10T11:15:00Z"
    );
    assert_eq!(p.proposals[0].inputs, original);
    assert_eq!(p.decisions[0].actor, "demo:admin");
    assert_eq!(p.decisions[0].plan_version, 1);
    assert_eq!(p.plan_version, 2);
    assert_eq!(p.proposals[0].status, "accepted");
    assert_eq!(
        p.proposals[0].inputs.events[0].interval,
        original.events[0].interval
    );
}
#[test]
fn reject_preserves_local_plan_and_duplicate_proposals_are_idempotent() {
    let mut p = planning();
    let data = inputs(&p);
    let before = p.local_event.clone();
    p.propose(data.clone(), "anchor:2", "a", "2026-11-05T15:00:00Z")
        .unwrap();
    p.propose(data.clone(), "anchor:2", "b", "2026-11-05T15:01:00Z")
        .unwrap();
    assert_eq!(p.proposals.len(), 1);
    let id = p.proposals[0].id.clone();
    p.decide(
        DecisionRequest {
            proposal_id: &id,
            decision: "reject",
            reason: "keep for review",
            actor: "a",
            recorded_at: "2026-11-05T15:01:00Z",
        },
        &data,
        "anchor:2",
    )
    .unwrap();
    assert_eq!(p.local_event, before);
    assert_eq!(p.plan_version, 1);
    assert!(
        p.decide(
            DecisionRequest {
                proposal_id: &id,
                decision: "reject",
                reason: "duplicate",
                actor: "a",
                recorded_at: "2026-11-05T15:01:00Z"
            },
            &data,
            "anchor:2"
        )
        .is_err()
    );
    assert_eq!(p.decisions.len(), 1);
}
#[test]
fn amendment_roster_and_incomplete_input_invalidate_pending_proposals() {
    for variant in 0..3 {
        let mut p = planning();
        let mut data = inputs(&p);
        p.propose(data.clone(), "anchor:2", "a", "2026-11-05T15:00:00Z")
            .unwrap();
        let id = p.proposals[0].id.clone();
        let token = if variant == 0 { "anchor:3" } else { "anchor:2" };
        if variant == 1 {
            p.roster_version += 1;
        }
        if variant == 2 {
            data.schedule_complete = false;
        }
        assert!(
            p.decide(
                DecisionRequest {
                    proposal_id: &id,
                    decision: "accept",
                    reason: "",
                    actor: "a",
                    recorded_at: "2026-11-05T15:01:00Z"
                },
                &data,
                token
            )
            .is_err()
        );
        assert_eq!(p.plan_version, 1);
        assert!(p.decisions.is_empty());
    }
}
#[test]
fn cancellation_keeps_accepted_training_and_no_longer_conflicts() {
    let mut p = planning();
    let data = inputs(&p);
    p.propose(data.clone(), "anchor:2", "a", "2026-11-05T15:00:00Z")
        .unwrap();
    let id = p.proposals[0].id.clone();
    p.decide(
        DecisionRequest {
            proposal_id: &id,
            decision: "accept",
            reason: "",
            actor: "a",
            recorded_at: "2026-11-05T15:01:00Z",
        },
        &data,
        "anchor:2",
    )
    .unwrap();
    let mut cancelled = inputs(&p);
    cancelled.events.remove(0);
    let result = super::calculation::assess(&cancelled, 4096);
    assert_eq!(result.status, "clear");
    assert!(result.collisions.is_empty());
    assert_eq!(
        p.local_event.interval.as_ref().unwrap().start,
        "2026-11-10T11:15:00Z"
    );
}

#[test]
fn unbound_inputs_cannot_create_or_accept_a_proposal_for_another_local_plan() {
    let mut p = planning();
    let mut data = inputs(&p);
    let before = serde_json::to_value(&p).unwrap();
    data.events[1].id = "another-training-event".into();
    data.rules.event_id = data.events[1].id.clone();
    assert!(
        p.propose(data, "anchor:2", "a", "2026-11-05T15:00:00Z")
            .is_err()
    );
    assert_eq!(serde_json::to_value(&p).unwrap(), before);
    let data = inputs(&p);
    p.propose(data.clone(), "anchor:2", "a", "2026-11-05T15:00:00Z")
        .unwrap();
    p.people[0].qualifications = Some(vec![]);
    let before = serde_json::to_value(&p).unwrap();
    let id = p.proposals[0].id.clone();
    assert!(
        p.decide(
            DecisionRequest {
                proposal_id: &id,
                decision: "accept",
                reason: "",
                actor: "a",
                recorded_at: "2026-11-05T15:01:00Z",
            },
            &data,
            "anchor:2"
        )
        .is_err()
    );
    assert_eq!(serde_json::to_value(&p).unwrap(), before);
}

#[test]
fn decision_metadata_and_reason_are_required_before_any_state_change() {
    let mut p = planning();
    let data = inputs(&p);
    assert!(
        p.propose(data.clone(), "anchor:2", "", "2026-11-05T15:00:00Z")
            .is_err()
    );
    assert!(
        p.propose(data.clone(), "", "a", "2026-11-05T15:00:00Z")
            .is_err()
    );
    assert!(p.propose(data.clone(), "anchor:2", "a", "now").is_err());
    p.propose(data.clone(), "anchor:2", "a", "2026-11-05T15:00:00Z")
        .unwrap();
    let id = p.proposals[0].id.clone();
    let before = serde_json::to_value(&p).unwrap();
    for (decision, reason, actor, recorded_at) in [
        ("accept", "", "", "2026-11-05T15:01:00Z"),
        ("accept", "", "a", "later"),
        ("maybe", "", "a", "2026-11-05T15:01:00Z"),
        ("accept", "unsafe\nreason", "a", "2026-11-05T15:01:00Z"),
    ] {
        assert!(
            p.decide(
                DecisionRequest {
                    proposal_id: &id,
                    decision,
                    reason,
                    actor,
                    recorded_at,
                },
                &data,
                "anchor:2"
            )
            .is_err()
        );
        assert_eq!(serde_json::to_value(&p).unwrap(), before);
    }
}

#[test]
fn accepted_state_roundtrips_with_exact_input_evidence_and_decision_history() {
    let mut p = planning();
    let data = inputs(&p);
    p.propose(data.clone(), "anchor:2", "a", "2026-11-05T15:00:00Z")
        .unwrap();
    let id = p.proposals[0].id.clone();
    p.decide(
        DecisionRequest {
            proposal_id: &id,
            decision: "accept",
            reason: "available",
            actor: "a",
            recorded_at: "2026-11-05T15:01:00Z",
        },
        &data,
        "anchor:2",
    )
    .unwrap();
    let stored = serde_json::to_string(&p).unwrap();
    let restored: Planning = serde_json::from_str(&stored).unwrap();
    assert_eq!(restored.proposals[0].inputs, data);
    assert_eq!(restored.proposals[0].status, "accepted");
    assert_eq!(
        restored.decisions[0].input_version,
        restored.proposals[0].input_version
    );
    assert_eq!(restored.decisions[0].actor, "a");
    assert_eq!(restored.local_event.interval, p.local_event.interval);
    assert_eq!(restored.plan_version, 2);
}

#[test]
fn version_overflow_is_rejected_without_partial_mutation() {
    let mut p = planning();
    let data = inputs(&p);
    p.version = u64::MAX;
    let before = serde_json::to_value(&p).unwrap();
    assert!(
        p.propose(data, "anchor:2", "a", "2026-11-05T15:00:00Z")
            .is_err()
    );
    assert_eq!(serde_json::to_value(&p).unwrap(), before);
    p = planning();
    p.plan_version = u64::MAX;
    let data = inputs(&p);
    p.propose(data.clone(), "anchor:2", "a", "2026-11-05T15:00:00Z")
        .unwrap();
    let id = p.proposals[0].id.clone();
    let before = serde_json::to_value(&p).unwrap();
    assert!(
        p.decide(
            DecisionRequest {
                proposal_id: &id,
                decision: "accept",
                reason: "",
                actor: "a",
                recorded_at: "2026-11-05T15:01:00Z",
            },
            &data,
            "anchor:2"
        )
        .is_err()
    );
    assert_eq!(serde_json::to_value(&p).unwrap(), before);
}
