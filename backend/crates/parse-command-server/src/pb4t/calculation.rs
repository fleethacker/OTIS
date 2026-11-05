//! Bounded, deterministic PB4T-inspired personnel scheduling calculation.
//! This module performs no I/O and never edits source-directed events.
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const MAX_PEOPLE: usize = 64;
const MAX_EVENTS: usize = 128;
const MAX_SEARCH: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Interval {
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Person {
    pub id: String,
    pub name: String,
    pub qualifications: Option<Vec<String>>,
    pub availability: Option<Vec<Interval>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub id: String,
    pub title: String,
    pub interval: Option<Interval>,
    pub person_ids: Vec<String>,
    pub required_qualifications: Option<Vec<String>>,
    pub fixed: bool,
    pub source_ref: String,
    pub version: String,
    pub validated: bool,
    #[serde(default)]
    pub buffer_before_minutes: Option<u32>,
    #[serde(default)]
    pub buffer_after_minutes: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveRules {
    pub event_id: String,
    pub window: Interval,
    pub earliest_start: String,
    pub duration_minutes: u32,
    pub grid_minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Inputs {
    pub people: Vec<Person>,
    pub events: Vec<Event>,
    pub rules: MoveRules,
    pub roster_observed_at: String,
    pub roster_valid_until: String,
    pub assessed_at: String,
    pub schedule_complete: bool,
    /// Complete schedule coverage, including every event's occupied interval
    /// and the move window expanded by the movable event's explicit buffers.
    pub coverage: Interval,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Collision {
    pub person_id: String,
    pub event_ids: [String; 2],
    pub overlap: Interval,
    pub includes_buffer: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Assessment {
    pub status: String,
    pub provisional: bool,
    pub collisions: Vec<Collision>,
    pub alternative: Option<Interval>,
    pub explanation: Vec<String>,
    pub checked_starts: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Span {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
}

impl Span {
    fn parse(value: &Interval) -> Result<Self, String> {
        let span = Self {
            start: timestamp(&value.start)?,
            end: timestamp(&value.end)?,
        };
        if span.start >= span.end {
            return Err("An interval is unresolved or has a non-positive duration.".into());
        }
        Ok(span)
    }

    fn contains(self, other: Self) -> bool {
        self.start <= other.start && other.end <= self.end
    }

    fn intersection(self, other: Self) -> Option<Self> {
        let span = Self {
            start: self.start.max(other.start),
            end: self.end.min(other.end),
        };
        (span.start < span.end).then_some(span)
    }

    fn expand(self, event: &Event) -> Result<Self, String> {
        Ok(Self {
            start: self
                .start
                .checked_sub_signed(Duration::minutes(i64::from(
                    event.buffer_before_minutes.unwrap_or(0),
                )))
                .ok_or("The declared setup buffer exceeds the supported time range.")?,
            end: self
                .end
                .checked_add_signed(Duration::minutes(i64::from(
                    event.buffer_after_minutes.unwrap_or(0),
                )))
                .ok_or("The declared rest buffer exceeds the supported time range.")?,
        })
    }

    fn wire(self) -> Interval {
        Interval {
            start: self.start.to_rfc3339_opts(SecondsFormat::AutoSi, true),
            end: self.end.to_rfc3339_opts(SecondsFormat::AutoSi, true),
        }
    }
}

fn timestamp(value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| "A required timestamp is missing or is not RFC3339 with a timezone.".into())
}

struct Prepared<'a> {
    events: Vec<&'a Event>,
    spans: Vec<Span>,
    people: BTreeMap<&'a str, &'a Person>,
    availability: BTreeMap<&'a str, Vec<Span>>,
    target: usize,
    window: Span,
    earliest: DateTime<Utc>,
}

fn prepare(inputs: &Inputs) -> Result<Prepared<'_>, String> {
    if inputs.people.len() > MAX_PEOPLE || inputs.events.len() > MAX_EVENTS {
        return Err(
            "The input exceeds the declared 64-person / 128-event assessment bound.".into(),
        );
    }
    if !inputs.schedule_complete {
        return Err(
            "The schedule is truncated or its completeness has not been established.".into(),
        );
    }
    let observed = timestamp(&inputs.roster_observed_at)?;
    let expires = timestamp(&inputs.roster_valid_until)?;
    let assessed = timestamp(&inputs.assessed_at)?;
    if observed > assessed || observed >= expires || assessed >= expires {
        return Err(
            "Personnel inputs are stale or their observation/freshness times are inconsistent."
                .into(),
        );
    }
    let coverage = Span::parse(&inputs.coverage)?;
    let window = Span::parse(&inputs.rules.window)?;
    let earliest = timestamp(&inputs.rules.earliest_start)?;
    if inputs.rules.duration_minutes == 0
        || inputs.rules.grid_minutes == 0
        || inputs.rules.grid_minutes > 1440
    {
        return Err(
            "Move rules require a positive duration and a 1–1440 minute UTC daily grid.".into(),
        );
    }
    let mut people = BTreeMap::new();
    let mut availability = BTreeMap::new();
    for person in &inputs.people {
        if person.id.trim().is_empty() || person.name.trim().is_empty() {
            return Err("A person has no stable ID or display name.".into());
        }
        if let Some(previous) = people.insert(person.id.as_str(), person)
            && previous != person
        {
            return Err(format!("Conflicting duplicate personnel ID {}.", person.id));
        }
        let Some(qualifications) = &person.qualifications else {
            return Err(format!("Qualifications are unknown for {}.", person.id));
        };
        if qualifications.iter().any(|value| value.trim().is_empty()) {
            return Err(format!(
                "An unresolved qualification is present for {}.",
                person.id
            ));
        }
        let Some(windows) = &person.availability else {
            return Err(format!("Availability is unknown for {}.", person.id));
        };
        let mut spans = windows
            .iter()
            .map(Span::parse)
            .collect::<Result<Vec<_>, _>>()?;
        spans.sort_by_key(|span| (span.start, span.end));
        // Adjacent and overlapping declarations form continuous availability.
        let mut merged: Vec<Span> = Vec::new();
        for span in spans {
            if let Some(last) = merged.last_mut()
                && span.start <= last.end
            {
                last.end = last.end.max(span.end);
                continue;
            }
            merged.push(span);
        }
        availability.insert(person.id.as_str(), merged);
    }
    let mut events = BTreeMap::new();
    for event in &inputs.events {
        if event.id.trim().is_empty()
            || event.source_ref.trim().is_empty()
            || event.version.trim().is_empty()
        {
            return Err("An event lacks a stable identity, source reference, or version.".into());
        }
        if let Some(previous) = events.insert(event.id.as_str(), event)
            && previous != event
        {
            return Err(format!("Conflicting duplicate event ID {}.", event.id));
        }
        if event.person_ids.is_empty() {
            return Err(format!(
                "Actual assigned people are unknown for {}.",
                event.id
            ));
        }
        if event
            .person_ids
            .iter()
            .any(|id| !people.contains_key(id.as_str()))
        {
            return Err(format!(
                "An assigned person is missing from the roster for {}.",
                event.id
            ));
        }
        let Some(required) = &event.required_qualifications else {
            return Err(format!(
                "Required qualifications are unknown for {}.",
                event.id
            ));
        };
        if required.iter().any(|value| value.trim().is_empty()) {
            return Err(format!(
                "An unresolved required qualification is present for {}.",
                event.id
            ));
        }
    }
    let events = events.into_values().collect::<Vec<_>>();
    let target = events
        .iter()
        .position(|event| event.id == inputs.rules.event_id)
        .ok_or("The movable event is missing from the complete input schedule.")?;
    if events[target].fixed {
        return Err("The selected event is fixed and cannot be moved by a local proposal.".into());
    }
    let spans = events
        .iter()
        .map(|event| {
            let span = Span::parse(
                event
                    .interval
                    .as_ref()
                    .ok_or_else(|| format!("The interval is unresolved for {}.", event.id))?,
            )?;
            if !coverage.contains(span.expand(event)?) {
                return Err(
                    "Schedule coverage does not contain all occupied event intervals.".into(),
                );
            }
            Ok(span)
        })
        .collect::<Result<Vec<_>, String>>()?;
    if spans[target].end - spans[target].start
        != Duration::minutes(i64::from(inputs.rules.duration_minutes))
    {
        return Err("The declared training duration differs from its current interval; resolve the inputs before proposing a move.".into());
    }
    if !coverage.contains(window.expand(events[target])?) {
        return Err(
            "Complete schedule coverage does not include the move window and its declared buffers."
                .into(),
        );
    }
    Ok(Prepared {
        events,
        spans,
        people,
        availability,
        target,
        window,
        earliest,
    })
}

fn collisions(events: &[&Event], spans: &[Span]) -> Result<Vec<Collision>, String> {
    let occupied = events
        .iter()
        .zip(spans)
        .map(|(event, span)| span.expand(event))
        .collect::<Result<Vec<_>, _>>()?;
    let mut result = Vec::new();
    for first in 0..events.len() {
        for second in first + 1..events.len() {
            let Some(overlap) = occupied[first].intersection(occupied[second]) else {
                continue;
            };
            let common = events[first]
                .person_ids
                .iter()
                .filter(|id| events[second].person_ids.contains(id))
                .collect::<BTreeSet<_>>();
            for person_id in common {
                result.push(Collision {
                    person_id: person_id.clone(),
                    event_ids: [events[first].id.clone(), events[second].id.clone()],
                    overlap: overlap.wire(),
                    includes_buffer: spans[first].intersection(spans[second]) != Some(overlap),
                });
            }
        }
    }
    result.sort_by(|a, b| (&a.person_id, &a.event_ids).cmp(&(&b.person_id, &b.event_ids)));
    Ok(result)
}

fn violations(prepared: &Prepared<'_>, spans: &[Span]) -> Result<Vec<String>, String> {
    let mut result = BTreeSet::new();
    for (event, span) in prepared.events.iter().zip(spans) {
        let occupied = span.expand(event)?;
        for id in event.person_ids.iter().collect::<BTreeSet<_>>() {
            let person = prepared.people[id.as_str()];
            let qualified = event
                .required_qualifications
                .as_ref()
                .expect("prepared requirements")
                .iter()
                .all(|qualification| {
                    person
                        .qualifications
                        .as_ref()
                        .expect("prepared qualifications")
                        .contains(qualification)
                });
            if !qualified {
                result.insert(format!(
                    "{} lacks a declared required qualification for {}.",
                    id, event.id
                ));
            }
            if !prepared.availability[id.as_str()]
                .iter()
                .any(|available| available.contains(occupied))
            {
                result.insert(format!(
                    "{} is unavailable for {} including its declared buffers.",
                    id, event.id
                ));
            }
        }
    }
    Ok(result.into_iter().collect())
}

/// Round forward to the UTC midnight-anchored grid. A grid resets each UTC day.
fn grid_start(at: DateTime<Utc>, minutes: u32) -> Option<DateTime<Utc>> {
    let midnight = at.date_naive().and_hms_opt(0, 0, 0)?.and_utc();
    let nanos = (at - midnight).num_nanoseconds()?;
    let step = i64::from(minutes) * 60 * 1_000_000_000;
    let rounded =
        midnight.checked_add_signed(Duration::nanoseconds(((nanos + step - 1) / step) * step))?;
    if rounded.date_naive() != midnight.date_naive() {
        midnight.checked_add_signed(Duration::days(1))
    } else {
        Some(rounded)
    }
}

fn assessment(inputs: &Inputs) -> Assessment {
    Assessment {
        status: "incomplete".into(),
        provisional: inputs.events.iter().any(|event| !event.validated),
        collisions: Vec::new(),
        alternative: None,
        explanation: Vec::new(),
        checked_starts: 0,
    }
}

/// Check the complete declared schedule and return the earliest feasible move.
/// No-solution means every permitted start was checked; resource limits instead
/// yield incomplete. Missing information is never interpreted as permission.
pub fn assess(inputs: &Inputs, search_budget: usize) -> Assessment {
    let mut result = assessment(inputs);
    let outcome = assess_inner(inputs, search_budget.min(MAX_SEARCH), &mut result);
    if let Err(reason) = outcome {
        result.status = "incomplete".into();
        result.alternative = None;
        result.explanation.push(reason);
    }
    if result.provisional {
        result.explanation.push("Provisional: one or more input events have not been operationally validated. Reading a version does not validate its parsed facts.".into());
    }
    result
}

fn assess_inner(
    inputs: &Inputs,
    search_budget: usize,
    result: &mut Assessment,
) -> Result<(), String> {
    let prepared = prepare(inputs)?;
    result.collisions = collisions(&prepared.events, &prepared.spans)?;
    let current_violations = violations(&prepared, &prepared.spans)?;
    let original = prepared.spans[prepared.target];
    if result.collisions.is_empty()
        && current_violations.is_empty()
        && prepared.window.contains(original)
        && original.start >= prepared.earliest
    {
        result.status = "clear".into();
        result.explanation.push("No personnel collision under the complete declared schedule; qualifications, availability, duration and explicit buffers are satisfied.".into());
        return Ok(());
    }
    result.explanation.extend(current_violations);
    let mut candidate_spans = prepared.spans.clone();
    let duration = Duration::minutes(i64::from(inputs.rules.duration_minutes));
    let latest = prepared
        .window
        .end
        .checked_sub_signed(duration)
        .ok_or("The move window exceeds the supported time range.")?;
    let lower = original
        .start
        .max(prepared.window.start)
        .max(prepared.earliest);
    let mut start = grid_start(lower, inputs.rules.grid_minutes)
        .ok_or("The UTC grid exceeds the supported time range.")?;
    while start <= latest {
        if result.checked_starts == search_budget {
            return Err("The search was interrupted at its declared budget; permitted starts remain unchecked.".into());
        }
        let candidate = Span {
            start,
            end: start
                .checked_add_signed(duration)
                .ok_or("The candidate interval exceeds the supported time range.")?,
        };
        result.checked_starts += 1;
        candidate_spans[prepared.target] = candidate;
        if collisions(&prepared.events, &candidate_spans)?.is_empty()
            && violations(&prepared, &candidate_spans)?.is_empty()
        {
            result.status = "feasible".into();
            result.alternative = Some(candidate.wire());
            result.explanation.push(format!(
                "Earliest feasible alternative after checking {} permitted starts: {}–{}. It preserves {} minutes, stays within the move window, starts no earlier than the current plan and declared lower bound, and lies on the {}-minute UTC daily grid.",
                result.checked_starts,
                candidate.wire().start,
                candidate.wire().end,
                inputs.rules.duration_minutes,
                inputs.rules.grid_minutes,
            ));
            result.explanation.push(format!(
                "All actually assigned people ({}) hold the declared qualifications and are available for the full occupied interval including explicit buffers. No occupied event overlaps; every other event, including fixed source-directed events, remains unchanged.",
                prepared.events[prepared.target].person_ids.iter().collect::<BTreeSet<_>>()
                    .into_iter().cloned().collect::<Vec<_>>().join(", "),
            ));
            return Ok(());
        }
        let next = start
            .checked_add_signed(Duration::minutes(i64::from(inputs.rules.grid_minutes)))
            .ok_or("The next grid start exceeds the supported time range.")?;
        start = if next.date_naive() != start.date_naive() {
            start
                .date_naive()
                .succ_opt()
                .and_then(|date| date.and_hms_opt(0, 0, 0))
                .map(|value| value.and_utc())
                .ok_or("The next UTC day exceeds the supported time range.")?
        } else {
            next
        };
    }
    result.status = "no_feasible_slot".into();
    result
        .explanation
        .push("No feasible slot under the declared move rules".into());
    result.explanation.push(format!("Exhausted all {} permitted starts through the latest start that preserves the declared duration. No event was changed.", result.checked_starts));
    Ok(())
}

#[cfg(test)]
#[path = "calculation_tests.rs"]
mod tests;
