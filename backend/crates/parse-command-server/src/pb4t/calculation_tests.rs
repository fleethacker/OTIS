use super::*;

fn time(value: &str) -> String {
    format!("2026-11-10T{value}:00Z")
}

fn interval(start: &str, end: &str) -> Interval {
    Interval {
        start: time(start),
        end: time(end),
    }
}

fn fixture() -> Inputs {
    Inputs {
        people: vec![Person {
            id: "P-01".into(),
            name: "Fictional Meridian operator".into(),
            qualifications: Some(vec!["training-qualified".into()]),
            availability: Some(vec![interval("09:00", "12:00")]),
        }],
        events: vec![
            Event {
                id: "communications".into(),
                title: "Fixed communications window".into(),
                interval: Some(interval("10:30", "11:15")),
                person_ids: vec!["P-01".into()],
                required_qualifications: Some(vec!["training-qualified".into()]),
                fixed: true,
                source_ref: "sha256:fictional-amendment@r1#activity-1".into(),
                version: "current-event-amendment-v2".into(),
                validated: false,
                buffer_before_minutes: None,
                buffer_after_minutes: None,
            },
            Event {
                id: "training".into(),
                title: "Local training".into(),
                interval: Some(interval("10:45", "11:15")),
                person_ids: vec!["P-01".into()],
                required_qualifications: Some(vec!["training-qualified".into()]),
                fixed: false,
                source_ref: "local:meridian-training-plan".into(),
                version: "local-plan-v1".into(),
                validated: true,
                buffer_before_minutes: None,
                buffer_after_minutes: None,
            },
        ],
        rules: MoveRules {
            event_id: "training".into(),
            window: interval("09:00", "12:00"),
            earliest_start: time("10:45"),
            duration_minutes: 30,
            grid_minutes: 15,
        },
        roster_observed_at: time("08:00"),
        roster_valid_until: time("12:00"),
        assessed_at: time("09:01"),
        schedule_complete: true,
        coverage: interval("08:00", "13:00"),
    }
}

#[test]
fn detects_collision_and_earliest_alternative_without_mutating_evidence() {
    let inputs = fixture();
    let before = inputs.clone();
    let result = assess(&inputs, 4096);
    assert_eq!(result.status, "feasible");
    assert_eq!(result.alternative, Some(interval("11:15", "11:45")));
    assert_eq!(result.checked_starts, 3);
    assert_eq!(
        result.collisions,
        vec![Collision {
            person_id: "P-01".into(),
            event_ids: ["communications".into(), "training".into()],
            overlap: interval("10:45", "11:15"),
            includes_buffer: false,
        }]
    );
    assert!(result.provisional);
    assert!(
        result
            .explanation
            .iter()
            .any(|text| text.contains("Provisional"))
    );
    assert_eq!(inputs, before);
}

#[test]
fn adjacent_intervals_are_clear_without_a_declared_buffer() {
    let mut inputs = fixture();
    inputs.events[1].interval = Some(interval("11:15", "11:45"));
    inputs.events[0].validated = true;
    let result = assess(&inputs, 0);
    assert_eq!(result.status, "clear");
    assert!(!result.provisional);
    assert!(result.collisions.is_empty());
    assert_eq!(result.checked_starts, 0);
    assert_eq!(result.alternative, None);
}

#[test]
fn explicit_rest_and_setup_buffers_affect_collision_and_availability() {
    let mut inputs = fixture();
    inputs.events[1].interval = Some(interval("11:15", "11:45"));
    inputs.events[0].buffer_after_minutes = Some(15);
    let result = assess(&inputs, 4096);
    assert_eq!(result.status, "feasible");
    assert_eq!(result.collisions[0].overlap, interval("11:15", "11:30"));
    assert!(result.collisions[0].includes_buffer);
    assert_eq!(result.alternative, Some(interval("11:30", "12:00")));

    inputs.events[0].buffer_after_minutes = None;
    inputs.events[1].buffer_before_minutes = Some(15);
    assert_eq!(
        assess(&inputs, 4096).alternative,
        Some(interval("11:30", "12:00"))
    );
    inputs.events[1].buffer_after_minutes = Some(1);
    assert_eq!(assess(&inputs, 4096).status, "no_feasible_slot");
}

#[test]
fn known_unqualified_person_is_infeasible_but_unknown_is_incomplete() {
    let mut inputs = fixture();
    inputs.people[0].qualifications = Some(vec![]);
    let result = assess(&inputs, 4096);
    assert_eq!(result.status, "no_feasible_slot");
    assert_eq!(result.checked_starts, 4);
    assert!(
        result
            .explanation
            .iter()
            .any(|value| value.contains("lacks a declared required qualification"))
    );
    inputs.people[0].qualifications = None;
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
    inputs = fixture();
    inputs.events[1].required_qualifications = None;
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
}

#[test]
fn unavailable_person_exhausts_slots_and_unknown_availability_is_incomplete() {
    let mut inputs = fixture();
    inputs.people[0].availability = Some(vec![interval("09:00", "11:15")]);
    let result = assess(&inputs, 4096);
    assert_eq!(result.status, "no_feasible_slot");
    assert_eq!(result.checked_starts, 4);
    assert!(
        result
            .explanation
            .contains(&"No feasible slot under the declared move rules".to_string())
    );
    inputs.people[0].availability = None;
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
}

#[test]
fn distinct_actual_people_do_not_collide_despite_identical_names_or_roles() {
    let mut inputs = fixture();
    let mut second = inputs.people[0].clone();
    second.id = "P-02".into();
    inputs.people.push(second);
    inputs.events[1].person_ids = vec!["P-02".into()];
    let result = assess(&inputs, 4096);
    assert_eq!(result.status, "clear");
    assert!(result.collisions.is_empty());
}

#[test]
fn each_assigned_person_must_be_available_and_qualified() {
    let mut inputs = fixture();
    let mut second = inputs.people[0].clone();
    second.id = "P-02".into();
    second.availability = Some(vec![interval("09:00", "11:30")]);
    inputs.people.push(second);
    inputs.events[1].person_ids.push("P-02".into());
    assert_eq!(assess(&inputs, 4096).status, "no_feasible_slot");
    inputs.people[1].availability = inputs.people[0].availability.clone();
    inputs.people[1].qualifications = Some(vec![]);
    assert_eq!(assess(&inputs, 4096).status, "no_feasible_slot");
}

#[test]
fn exact_duplicates_are_idempotent_and_conflicting_duplicates_are_incomplete() {
    let mut inputs = fixture();
    let expected = assess(&inputs, 4096);
    inputs.events.push(inputs.events[0].clone());
    inputs.people.push(inputs.people[0].clone());
    assert_eq!(assess(&inputs, 4096), expected);
    inputs.events[2].interval = Some(interval("11:00", "11:45"));
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
    inputs = fixture();
    let mut conflicting = inputs.people[0].clone();
    conflicting.qualifications = Some(vec![]);
    inputs.people.push(conflicting);
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
}

#[test]
fn truncated_or_uncovered_schedules_never_report_clear_or_no_solution() {
    let mut inputs = fixture();
    inputs.schedule_complete = false;
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
    inputs.schedule_complete = true;
    inputs.coverage = interval("10:30", "11:30");
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
    inputs.coverage = interval("09:00", "12:00");
    inputs.events[1].buffer_before_minutes = Some(1);
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
}

#[test]
fn interrupted_search_is_incomplete_even_when_all_checked_starts_fail() {
    let inputs = fixture();
    let result = assess(&inputs, 2);
    assert_eq!(result.status, "incomplete");
    assert_eq!(result.checked_starts, 2);
    assert_eq!(result.alternative, None);
    assert_eq!(result.collisions.len(), 1);
    assert_eq!(assess(&inputs, 0).status, "incomplete");
    assert_eq!(assess(&inputs, 3).status, "feasible");
    let mut unavailable = inputs;
    unavailable.people[0].availability = Some(vec![]);
    assert_eq!(assess(&unavailable, 3).status, "incomplete");
    assert_eq!(assess(&unavailable, 4).status, "no_feasible_slot");
}

#[test]
fn stale_future_and_unresolved_personnel_timestamps_are_incomplete() {
    let inputs = fixture();
    for (observed, valid_until, assessed) in [
        (time("08:00"), time("09:01"), time("09:01")),
        (time("09:02"), time("12:00"), time("09:01")),
        (time("08:00"), time("07:00"), time("09:01")),
        ("2026-11-10T08:00:00".into(), time("12:00"), time("09:01")),
    ] {
        let mut variant = inputs.clone();
        variant.roster_observed_at = observed;
        variant.roster_valid_until = valid_until;
        variant.assessed_at = assessed;
        assert_eq!(assess(&variant, 4096).status, "incomplete");
    }
}

#[test]
fn missing_assignment_time_or_version_is_incomplete() {
    let mut inputs = fixture();
    inputs.events[0].interval = None;
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
    inputs = fixture();
    inputs.events[1].person_ids.clear();
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
    inputs = fixture();
    inputs.events[1].person_ids = vec!["P-missing".into()];
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
    inputs = fixture();
    inputs.events[0].version.clear();
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
}

#[test]
fn duration_is_preserved_and_fixed_events_cannot_be_targeted() {
    let mut inputs = fixture();
    inputs.rules.duration_minutes = 45;
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
    inputs = fixture();
    inputs.rules.event_id = "communications".into();
    inputs.rules.duration_minutes = 45;
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
    inputs.rules.event_id = "missing".into();
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
}

#[test]
fn alternative_never_moves_earlier_and_respects_declared_lower_bound() {
    let mut inputs = fixture();
    inputs.rules.earliest_start = time("11:16");
    let result = assess(&inputs, 4096);
    assert_eq!(result.alternative, Some(interval("11:30", "12:00")));
    assert_eq!(result.checked_starts, 1);
    inputs.rules.earliest_start = time("11:31");
    let result = assess(&inputs, 4096);
    assert_eq!(result.status, "no_feasible_slot");
    assert_eq!(result.checked_starts, 0);
    inputs = fixture();
    inputs.events[0].interval = Some(interval("10:30", "12:00"));
    inputs.rules.earliest_start = time("09:00");
    let result = assess(&inputs, 4096);
    assert_eq!(result.status, "no_feasible_slot");
    assert_eq!(result.checked_starts, 4);
}

#[test]
fn other_fixed_events_and_unrelated_collisions_are_also_checked() {
    let mut inputs = fixture();
    let mut blocked = inputs.events[0].clone();
    blocked.id = "another-fixed".into();
    blocked.interval = Some(interval("11:15", "11:30"));
    inputs.events.push(blocked);
    assert_eq!(
        assess(&inputs, 4096).alternative,
        Some(interval("11:30", "12:00"))
    );
    inputs.events[2].interval = Some(interval("10:40", "10:50"));
    assert_eq!(assess(&inputs, 4096).status, "no_feasible_slot");
}

#[test]
fn availability_union_is_continuous_only_when_windows_touch() {
    let mut inputs = fixture();
    inputs.people[0].availability =
        Some(vec![interval("09:00", "11:30"), interval("11:30", "12:00")]);
    assert_eq!(
        assess(&inputs, 4096).alternative,
        Some(interval("11:15", "11:45"))
    );
    inputs.people[0].availability =
        Some(vec![interval("09:00", "11:30"), interval("11:31", "12:00")]);
    assert_eq!(assess(&inputs, 4096).status, "no_feasible_slot");
}

#[test]
fn utc_grid_normalizes_offsets_and_rounds_fractional_times_forward() {
    assert_eq!(
        grid_start(timestamp("2026-11-10T06:15:00-05:00").unwrap(), 15).unwrap(),
        timestamp(&time("11:15")).unwrap()
    );
    assert_eq!(
        grid_start(timestamp("2026-11-10T11:15:00.001Z").unwrap(), 15).unwrap(),
        timestamp(&time("11:30")).unwrap()
    );
    assert_eq!(
        grid_start(timestamp("2026-11-10T23:59:00Z").unwrap(), 17).unwrap(),
        timestamp("2026-11-11T00:00:00Z").unwrap()
    );
    let mut inputs = fixture();
    inputs.events[0].interval = Some(Interval {
        start: "2026-11-10T05:30:00-05:00".into(),
        end: "2026-11-10T06:15:00-05:00".into(),
    });
    assert_eq!(
        assess(&inputs, 4096).alternative,
        Some(interval("11:15", "11:45"))
    );
}

#[test]
fn malformed_rules_and_oversized_inputs_are_incomplete() {
    let mut inputs = fixture();
    inputs.rules.grid_minutes = 0;
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
    inputs = fixture();
    inputs.events[1].interval = Some(interval("11:15", "10:45"));
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
    inputs = fixture();
    inputs.events = vec![inputs.events[0].clone(); 129];
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
    inputs = fixture();
    inputs.people = vec![inputs.people[0].clone(); 65];
    assert_eq!(assess(&inputs, 4096).status, "incomplete");
}

#[test]
fn global_search_cap_cannot_be_overridden_by_a_large_requested_budget() {
    let mut inputs = fixture();
    inputs.rules.grid_minutes = 1;
    inputs.rules.window.end = "2026-11-20T12:00:00Z".into();
    inputs.coverage.end = inputs.rules.window.end.clone();
    inputs.people[0].availability = Some(vec![]);
    let result = assess(&inputs, usize::MAX);
    assert_eq!(result.status, "incomplete");
    assert_eq!(result.checked_starts, 4096);
    assert!(result.alternative.is_none());
}

#[test]
fn unknown_wire_constraints_are_rejected_instead_of_silently_ignored() {
    let mut value = serde_json::to_value(fixture()).unwrap();
    value["events"][1]["minimumRestMinutes"] = serde_json::json!(120);
    assert!(serde_json::from_value::<Inputs>(value).is_err());
}
