use parse_command_server::{
    presentation,
    recurrence::{Expansion, expand},
};
use parse_command_types::{Recurrence, UtcTimestamp};
use serde_json::json;
fn rule(text: &str, anchor: Option<&str>) -> Recurrence {
    let mut value = json!({"id":"r1","type":"crypto_changeover","rule":text,"status":"inferred"});
    if let Some(anchor) = anchor {
        value["dtstart"] = json!(anchor);
    }
    serde_json::from_value(value).unwrap()
}
fn times(rule: &Recurrence, from: &str, to: &str) -> Vec<String> {
    match expand(rule, from, to, 2048).unwrap() {
        Expansion::Ready { instants, .. } => instants,
        Expansion::Review { reason, .. } => panic!("unexpected review: {reason}"),
    }
}
#[test]
fn daily_period_anchor_does_not_invent_midnight_and_until_is_inclusive() {
    let mut r = rule(
        "FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0",
        Some("2026-11-05T00:00:00Z"),
    );
    r.until = Some(UtcTimestamp::new("2026-11-08T20:00:00Z").unwrap());
    let all = times(&r, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
    assert_eq!(all.len(), 8);
    assert_eq!(all[0], "2026-11-05T08:00:00Z");
    assert_eq!(all[7], "2026-11-08T20:00:00Z");
    assert_eq!(
        times(&r, "2026-11-05T08:00:00Z", "2026-11-05T20:00:00Z"),
        ["2026-11-05T08:00:00Z"]
    );
    assert_eq!(
        times(&r, "2026-11-05T20:00:00Z", "2026-11-05T20:00:00.001Z"),
        ["2026-11-05T20:00:00Z"]
    );
    assert_eq!(
        times(&r, "2026-11-09T00:00:00Z", "2026-11-10T00:00:00Z"),
        Vec::<String>::new()
    );
}
#[test]
fn exclusions_do_not_replenish_count_and_old_hourly_anchors_seek_to_the_window() {
    let mut r = rule(
        "FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0;COUNT=3",
        Some("2026-11-05T00:00:00Z"),
    );
    r.exdates
        .push(UtcTimestamp::new("2026-11-05T20:00:00Z").unwrap());
    assert_eq!(
        times(&r, "2026-11-05T00:00:00Z", "2026-11-09T00:00:00Z"),
        ["2026-11-05T08:00:00Z", "2026-11-06T08:00:00Z"]
    );
    let r = rule(
        "FREQ=HOURLY;INTERVAL=2;BYHOUR=8,20;BYMINUTE=15,45",
        Some("1900-01-01T00:00:00Z"),
    );
    assert_eq!(
        times(&r, "2026-11-05T08:15:00Z", "2026-11-05T20:45:00Z"),
        [
            "2026-11-05T08:15:00Z",
            "2026-11-05T08:45:00Z",
            "2026-11-05T20:15:00Z"
        ]
    );
    assert!(matches!(
        expand(&r, "2026-11-05T00:00:00Z", "2026-11-06T00:00:00Z", 10).unwrap(),
        Expansion::Ready { ongoing: true, .. }
    ));
    let expired = rule("FREQ=HOURLY;COUNT=2", Some("1900-01-01T00:00:00Z"));
    assert!(times(&expired, "2026-11-05T00:00:00Z", "2026-11-06T00:00:00Z").is_empty());
}
#[test]
fn weekly_phase_is_monday_based_and_count_covers_the_partial_first_week() {
    let r = rule(
        "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;BYHOUR=8;BYMINUTE=0",
        Some("2026-11-04T06:00:00Z"),
    );
    assert_eq!(
        times(&r, "2026-11-02T00:00:00Z", "2026-11-30T00:00:00Z"),
        [
            "2026-11-05T08:00:00Z",
            "2026-11-16T08:00:00Z",
            "2026-11-19T08:00:00Z"
        ]
    );
    let mut r = r;
    r.count = Some(2);
    assert_eq!(
        times(&r, "2026-11-16T00:00:00Z", "2026-11-30T00:00:00Z"),
        ["2026-11-16T08:00:00Z"]
    );
}
#[test]
fn property_partitioning_windows_preserves_occurrences_and_ids_across_rules() {
    let start = chrono::DateTime::parse_from_rfc3339("2026-11-05T00:00:00Z").unwrap();
    for frequency in ["HOURLY", "DAILY", "WEEKLY"] {
        for interval in 1..=5 {
            for count in [None, Some(1), Some(17), Some(100)] {
                let suffix = if frequency == "WEEKLY" {
                    ";BYDAY=MO,TH,SU"
                } else {
                    ""
                };
                let mut r = rule(
                    &format!(
                        "FREQ={frequency};INTERVAL={interval};BYHOUR=8,20;BYMINUTE=0,30{suffix}"
                    ),
                    Some("2026-11-04T07:15:00Z"),
                );
                r.count = count;
                r.exdates
                    .push(UtcTimestamp::new("2026-11-05T08:00:00Z").unwrap());
                // Some hourly phase/hour combinations deliberately select nothing: visible review.
                if matches!(
                    expand(&r, "2026-11-05T00:00:00Z", "2026-11-19T00:00:00Z", 2048).unwrap(),
                    Expansion::Review { .. }
                ) {
                    continue;
                }
                let all = times(&r, "2026-11-05T00:00:00Z", "2026-11-19T00:00:00Z");
                for cut in [1, 8, 20, 31, 72, 168, 335] {
                    let middle = (start + chrono::Duration::hours(cut))
                        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
                    let mut split = times(&r, "2026-11-05T00:00:00Z", &middle);
                    split.extend(times(&r, &middle, "2026-11-19T00:00:00Z"));
                    assert_eq!(split, all, "{frequency}/{interval}/{count:?}/{cut}");
                }
            }
        }
    }
}
#[test]
fn unsupported_and_unanchored_rules_remain_review_and_never_borrow_issue_time() {
    for text in [
        "FREQ=MONTHLY",
        "FREQ=DAILY;BYSECOND=0",
        "FREQ=DAILY;BYDAY=MO",
        "FREQ=DAILY;INTERVAL=0",
        "FREQ=DAILY;COUNT=2;UNTIL=20261108T200000Z",
        "FREQ=DAILY;FREQ=WEEKLY",
        "FREQ=WEEKLY;BYDAY=2MO",
        "FREQ=DAILY;UNTIL=20261108",
    ] {
        let r = rule(text, Some("2026-11-05T00:00:00Z"));
        assert!(matches!(
            expand(&r, "2026-11-05T00:00:00Z", "2026-11-06T00:00:00Z", 100).unwrap(),
            Expansion::Review { .. }
        ));
    }
    let core = json!({"id":parse_command_types::message_id("Fictional recurrence"),"revision":"fictional-r1","type":"OPTASK LINK","command_ids":[],"issued_at":"2026-11-05T00:00:00Z","activities":[],"recurrences":[rule("FREQ=DAILY",None)]});
    for (from, to) in [
        ("2026-11-05T00:00:00Z", "2026-11-06T00:00:00Z"),
        ("2026-11-01T00:00:00Z", "2026-11-08T00:00:00Z"),
        ("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
    ] {
        let (items, review) = presentation::timeline(&core, from, to).unwrap();
        assert!(items.is_empty());
        assert_eq!(review.len(), 1);
        assert_eq!(review[0]["reasonCode"], "recurrence_missing_anchor");
    }
}
#[test]
fn presentation_uses_occurrence_identity_and_the_shared_fact_bound() {
    let mut r = rule(
        "FREQ=DAILY;BYHOUR=13;BYMINUTE=30",
        Some("2026-11-05T00:00:00Z"),
    );
    r.activity_id = Some("a1".into());
    let core = json!({"id":parse_command_types::message_id("Fictional crypto"),"revision":"r1","type":"OPTASK LINK","command_ids":["demo-meridian"],"activities":[{"id":"a1","type":"crypto_changeover","time":"13:30Z","time_status":"missing_date","status":"inferred"}],"recurrences":[r]});
    let (items, review) =
        presentation::timeline(&core, "2026-11-05T00:00:00Z", "2026-11-07T00:00:00Z").unwrap();
    assert_eq!(items.len(), 2);
    assert!(review.is_empty());
    assert_eq!(items[0]["factId"], "r1@2026-11-05T13:30:00Z");
    assert_eq!(items[0]["sourceFactId"], "r1");
    assert_eq!(items[0]["kind"], "point");
    assert!(items[0].get("end").is_none());
    assert!(
        presentation::timeline_with_limit(&core, "2026-11-05T00:00:00Z", "2026-11-07T00:00:00Z", 1)
            .is_err()
    );
}
