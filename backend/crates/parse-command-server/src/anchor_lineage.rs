//! Independent ANCHOR resolver prototype. No persistence, task system or authorization.
//! Callers must authenticate and verify access to EVERY source before exposing results.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_VERSIONS: usize = 32;

/// Content identity is evidence only. It NEVER establishes lineage.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SourceRef {
    pub message_key: String,
    pub content_hash: String,
    pub fact_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Interval {
    pub start: String,
    pub end: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Relationship {
    Original,
    Amends { target: String },
    Cancels { target: String },
}
impl Relationship {
    fn target(&self) -> Option<&str> {
        match self {
            Self::Original => None,
            Self::Amends { target } | Self::Cancels { target } => Some(target),
        }
    }
}

/// Explicit authored relationship stored separately from immutable parsed source.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeclaredVersion {
    pub id: String,
    pub source: SourceRef,
    pub relationship: Relationship,
    pub effective_at: String,
    /// None means unresolved source time; cancellation must also have None.
    pub interval: Option<Interval>,
    pub provenance: String,
    /// Internal reading acknowledgement must never change this flag.
    pub parsed_review_required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Active,
    Cancelled,
    Pending,
    Unresolved,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Problem {
    EmptyOrOversized,
    InvalidIdentity,
    InvalidTime,
    ConflictingDuplicate,
    OriginalCount,
    MissingTarget,
    Cycle,
    NonMonotonicEffectiveTime,
    CancellationHasInterval,
    AmendmentAfterCancellation,
    ConflictingBranches,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentEvent {
    pub logical_event_id: String,
    pub status: Status,
    /// Opaque token to bind review and planning inputs; absent if unresolved/pending.
    pub version_token: Option<String>,
    pub current: Option<DeclaredVersion>,
    pub original: Option<DeclaredVersion>,
    pub previous: Option<DeclaredVersion>,
    /// Sort is deterministic display order only; it does not select the current version.
    pub history: Vec<DeclaredVersion>,
    pub next_effective_at: Option<String>,
    pub problems: Vec<Problem>,
}

fn utc(value: &str) -> Option<DateTime<Utc>> {
    if !value.ends_with('Z') {
        return None;
    }
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|v| v.with_timezone(&Utc))
}

/// Resolve a COMPLETE bounded event history using the authoritative server/scenario time.
/// All structural defects fail closed, including defective future edges. Valid future
/// branches do not take effect early. Current review does not expire merely because a
/// future amendment was declared; its version token changes when that amendment applies.
pub fn resolve(logical_event_id: &str, versions: &[DeclaredVersion], as_of: &str) -> CurrentEvent {
    let mut view = CurrentEvent {
        logical_event_id: logical_event_id.into(),
        status: Status::Unresolved,
        version_token: None,
        current: None,
        original: None,
        previous: None,
        history: Vec::new(),
        next_effective_at: None,
        problems: Vec::new(),
    };
    macro_rules! fail {
        ($problem:expr) => {{
            view.problems.push($problem);
            return view;
        }};
    }
    if versions.is_empty() || versions.len() > MAX_VERSIONS {
        fail!(Problem::EmptyOrOversized);
    }
    if logical_event_id.is_empty() {
        fail!(Problem::InvalidIdentity);
    }
    let Some(now) = utc(as_of) else {
        fail!(Problem::InvalidTime);
    };
    let mut by_id = BTreeMap::new();
    let mut conflicting_duplicate = false;
    let mut unique = BTreeMap::new();
    for version in versions {
        unique.insert(
            serde_json::to_vec(version).expect("serializing plain lineage structs cannot fail"),
            version.clone(),
        );
        if let Some(previous) = by_id.insert(version.id.as_str(), version)
            && previous != version
        {
            conflicting_duplicate = true;
        }
    }
    view.history = unique.into_values().collect();
    view.history.sort_by(|a, b| {
        utc(&a.effective_at)
            .cmp(&utc(&b.effective_at))
            .then(a.id.cmp(&b.id))
    });
    if conflicting_duplicate {
        fail!(Problem::ConflictingDuplicate);
    }
    let mut times = BTreeMap::new();
    for version in by_id.values() {
        if version.id.is_empty()
            || version.source.message_key.is_empty()
            || version.source.content_hash.is_empty()
            || version.provenance.is_empty()
            || (!matches!(version.relationship, Relationship::Cancels { .. })
                && version.source.fact_id.as_deref().is_none_or(str::is_empty))
        {
            fail!(Problem::InvalidIdentity);
        }
        let Some(at) = utc(&version.effective_at) else {
            fail!(Problem::InvalidTime);
        };
        times.insert(version.id.as_str(), at);
        if let Some(interval) = &version.interval {
            if matches!(version.relationship, Relationship::Cancels { .. }) {
                fail!(Problem::CancellationHasInterval);
            }
            match (utc(&interval.start), utc(&interval.end)) {
                (Some(start), Some(end)) if start < end => (),
                _ => fail!(Problem::InvalidTime),
            }
        }
    }
    let roots = by_id
        .values()
        .filter(|v| matches!(v.relationship, Relationship::Original))
        .copied()
        .collect::<Vec<_>>();
    if roots.len() != 1 {
        fail!(Problem::OriginalCount);
    }
    let original = roots[0];
    view.original = Some(original.clone());
    // Validate the complete graph, independently of arrival order and effective state.
    for version in by_id.values() {
        let mut seen = BTreeSet::new();
        let mut cursor = *version;
        loop {
            if !seen.insert(cursor.id.as_str()) {
                fail!(Problem::Cycle);
            }
            let Some(target) = cursor.relationship.target() else {
                break;
            };
            let Some(parent) = by_id.get(target) else {
                fail!(Problem::MissingTarget);
            };
            if matches!(parent.relationship, Relationship::Cancels { .. }) {
                fail!(Problem::AmendmentAfterCancellation);
            }
            if times[cursor.id.as_str()] < times[parent.id.as_str()] {
                fail!(Problem::NonMonotonicEffectiveTime);
            }
            cursor = parent;
        }
    }
    view.next_effective_at = view
        .history
        .iter()
        .find(|v| times[v.id.as_str()] > now)
        .map(|v| v.effective_at.clone());
    if times[original.id.as_str()] > now {
        view.status = Status::Pending;
        return view;
    }
    let mut path = vec![original];
    let mut current = original;
    loop {
        let children = by_id
            .values()
            .filter(|v| {
                v.relationship.target() == Some(current.id.as_str()) && times[v.id.as_str()] <= now
            })
            .copied()
            .collect::<Vec<_>>();
        match children.as_slice() {
            [] => break,
            [child] => {
                current = child;
                path.push(current);
            }
            _ => fail!(Problem::ConflictingBranches),
        }
    }
    view.status = if matches!(current.relationship, Relationship::Cancels { .. }) {
        Status::Cancelled
    } else {
        Status::Active
    };
    view.previous = path.iter().rev().nth(1).map(|v| (*v).clone());
    // Serialization contains only deterministic explicit path inputs. Never include
    // the observation clock, review records, arrival order, or unrelated event state.
    let bytes = serde_json::to_vec(&("anchor-current-v1", logical_event_id, &path))
        .expect("serializing plain lineage structs cannot fail");
    view.version_token = Some(format!("anchor:v1:{:x}", Sha256::digest(bytes)));
    view.current = Some(current.clone());
    view
}

impl CurrentEvent {
    /// Only dated active events participate in scheduling. Unresolved source times
    /// remain reviewable but cannot be treated as a conflict-free schedule.
    pub fn scheduling_interval(&self) -> Option<&Interval> {
        if self.status == Status::Active {
            self.current.as_ref()?.interval.as_ref()
        } else {
            None
        }
    }

    /// Exact selected facts to suppress from the raw timeline before injecting this
    /// view. Never suppress an entire message: it may contain unrelated events.
    pub fn managed_facts(&self) -> BTreeSet<(&str, &str)> {
        managed_facts(&self.history)
    }
}

/// Timeline overlay should call this on the complete raw declarations BEFORE
/// resolution. Even an early validation failure (bounds/identity/time/conflicting
/// duplicate IDs) must not leave superseded facts plotted as active instructions.
/// As with resolve(), callers must authorize all sources before using these refs.
pub fn managed_facts(versions: &[DeclaredVersion]) -> BTreeSet<(&str, &str)> {
    versions
        .iter()
        .filter_map(|v| {
            v.source
                .fact_id
                .as_deref()
                .map(|fact| (v.source.message_key.as_str(), fact))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    const NOW: &str = "2026-11-10T08:15:00Z";
    fn item(id: &str, relationship: Relationship, effective: &str, start: &str) -> DeclaredVersion {
        let cancelled = matches!(relationship, Relationship::Cancels { .. });
        DeclaredVersion {
            id: id.into(),
            source: SourceRef {
                message_key: format!("{id}@1"),
                content_hash: format!("body-hash-{id}"),
                fact_id: (!cancelled).then(|| format!("fact-{id}")),
            },
            relationship,
            effective_at: effective.into(),
            interval: (!cancelled).then(|| Interval {
                start: format!("2026-11-10T{start}:00Z"),
                end: if start == "09:00" {
                    "2026-11-10T09:45:00Z".into()
                } else {
                    "2026-11-10T11:15:00Z".into()
                },
            }),
            provenance: "Explicit synthetic scenario relationship".into(),
            parsed_review_required: true,
        }
    }
    fn chain() -> Vec<DeclaredVersion> {
        vec![
            item(
                "original",
                Relationship::Original,
                "2026-11-10T07:00:00Z",
                "09:00",
            ),
            item(
                "amendment",
                Relationship::Amends {
                    target: "original".into(),
                },
                "2026-11-10T08:00:00Z",
                "10:30",
            ),
            item(
                "cancellation",
                Relationship::Cancels {
                    target: "amendment".into(),
                },
                "2026-11-10T12:00:00Z",
                "10:30",
            ),
        ]
    }
    fn view(items: &[DeclaredVersion], at: &str) -> CurrentEvent {
        resolve("scenario:event-1", items, at)
    }
    #[test]
    fn explicit_amendment_exposes_before_after_and_preserves_review_flag() {
        let v = view(&chain(), NOW);
        assert_eq!(v.status, Status::Active);
        assert_eq!(v.current.as_ref().unwrap().id, "amendment");
        assert_eq!(
            v.scheduling_interval().unwrap().start,
            "2026-11-10T10:30:00Z"
        );
        assert_eq!(
            v.previous.unwrap().interval.unwrap().start,
            "2026-11-10T09:00:00Z"
        );
        assert!(v.current.unwrap().parsed_review_required);
    }
    #[test]
    fn duplicate_and_out_of_order_replay_are_identical() {
        let mut items = chain();
        let expected = view(&items, NOW);
        items.reverse();
        items.push(items[0].clone());
        assert_eq!(expected, view(&items, NOW));
    }
    #[test]
    fn future_effective_edges_preserve_current_review_token_until_due() {
        let items = chain();
        let before = "2026-11-10T07:30:00Z";
        let original = view(&items[..1], before);
        let future = view(&items, before);
        assert_eq!(original.version_token, future.version_token);
        assert_eq!(
            future.next_effective_at.as_deref(),
            Some("2026-11-10T08:00:00Z")
        );
        assert_ne!(future.version_token, view(&items, NOW).version_token);
        assert_eq!(
            view(&items, "2026-11-10T08:00:00Z").current.unwrap().id,
            "amendment"
        );
    }
    #[test]
    fn cancellation_removes_interval_and_replay_does_not_resurrect() {
        let mut items = chain();
        let at = "2026-11-10T12:00:00Z";
        let cancelled = view(&items, at);
        assert_eq!(cancelled.status, Status::Cancelled);
        assert!(cancelled.scheduling_interval().is_none());
        assert_eq!(
            cancelled.current.as_ref().unwrap().source.message_key,
            "cancellation@1"
        );
        items.push(items[0].clone());
        assert_eq!(cancelled, view(&items, at));
        assert_eq!(cancelled.history.len(), 3);
    }
    #[test]
    fn missing_target_is_unresolved_until_target_arrives() {
        let items = chain();
        let unresolved = view(&items[1..], NOW);
        assert_eq!(unresolved.status, Status::Unresolved);
        let mut items = items;
        items[1].relationship = Relationship::Amends {
            target: "missing".into(),
        };
        assert_eq!(view(&items, NOW).problems, vec![Problem::MissingTarget]);
    }
    #[test]
    fn conflicting_active_branches_never_choose_a_winner() {
        let mut items = chain();
        let mut branch = items[1].clone();
        branch.id = "conflicting-amendment".into();
        items.push(branch);
        let result = view(&items, NOW);
        assert_eq!(result.problems, vec![Problem::ConflictingBranches]);
        assert!(result.current.is_none());
        assert!(result.version_token.is_none());
        assert!(result.scheduling_interval().is_none());
    }
    #[test]
    fn future_branch_only_conflicts_when_effective() {
        let mut items = chain();
        let mut branch = items[1].clone();
        branch.id = "future-conflict".into();
        branch.effective_at = "2026-11-10T09:00:00Z".into();
        items.push(branch);
        assert_eq!(view(&items, NOW).status, Status::Active);
        assert_eq!(
            view(&items, "2026-11-10T09:00:00Z").status,
            Status::Unresolved
        );
    }
    #[test]
    fn cycle_is_unresolved() {
        let mut items = chain();
        items[2].relationship = Relationship::Amends {
            target: "amendment".into(),
        };
        items[2].source.fact_id = Some("cancel-fact".into());
        items[2].effective_at = items[1].effective_at.clone();
        items[1].relationship = Relationship::Amends {
            target: "cancellation".into(),
        };
        assert_eq!(view(&items, NOW).problems, vec![Problem::Cycle]);
    }
    #[test]
    fn parser_revision_and_body_hash_do_not_establish_lineage() {
        let mut items = chain();
        items.truncate(2);
        items[1].relationship = Relationship::Original;
        items[1].source.content_hash = items[0].source.content_hash.clone();
        items[1].source.message_key = "original@2".into();
        assert_eq!(view(&items, NOW).problems, vec![Problem::OriginalCount]);
    }
    #[test]
    fn cancellation_is_terminal_and_effective_times_are_monotonic() {
        let mut items = chain();
        let mut child = items[1].clone();
        child.id = "resurrection".into();
        child.relationship = Relationship::Amends {
            target: "cancellation".into(),
        };
        child.effective_at = "2026-11-10T13:00:00Z".into();
        items.push(child);
        assert_eq!(
            view(&items, NOW).problems,
            vec![Problem::AmendmentAfterCancellation]
        );
        items.pop();
        items[1].effective_at = "2026-11-10T06:00:00Z".into();
        assert_eq!(
            view(&items, NOW).problems,
            vec![Problem::NonMonotonicEffectiveTime]
        );
    }
    #[test]
    fn suppression_targets_exact_facts_only() {
        let v = view(&chain(), NOW);
        let selected = v.managed_facts();
        assert_eq!(selected.len(), 2);
        assert!(selected.contains(&("original@1", "fact-original")));
        assert!(!selected.contains(&("original@1", "unrelated-fact")));
        assert!(!selected.contains(&("original@2", "fact-original")));
    }
    #[test]
    fn conflicting_id_replay_and_invalid_time_fail_closed() {
        let mut items = chain();
        let mut duplicate = items[1].clone();
        duplicate.provenance = "Different claim".into();
        items.push(duplicate);
        assert_eq!(
            view(&items, NOW).problems,
            vec![Problem::ConflictingDuplicate]
        );
        items.pop();
        items[1].interval.as_mut().unwrap().end = "2026-11-10T09:00:00Z".into();
        assert_eq!(view(&items, NOW).problems, vec![Problem::InvalidTime]);
    }
    #[test]
    fn unresolved_source_time_is_not_a_scheduling_interval() {
        let mut items = chain();
        items[1].interval = None;
        let v = view(&items, NOW);
        assert_eq!(v.status, Status::Active);
        assert!(v.scheduling_interval().is_none());
        assert!(v.version_token.is_some());
        assert!(v.current.as_ref().unwrap().parsed_review_required);
    }
    #[test]
    fn suppression_survives_early_invalid_resolution() {
        let mut items = chain();
        let mut duplicate = items[1].clone();
        duplicate.source.message_key = "conflicting-source@1".into();
        items.push(duplicate);
        let expected = managed_facts(&items);
        assert_eq!(expected.len(), 3);
        let invalid = view(&items, NOW);
        assert_eq!(invalid.problems, vec![Problem::ConflictingDuplicate]);
        assert_eq!(invalid.managed_facts(), expected);
        let invalid_clock = view(&items, "invalid time");
        assert!(invalid_clock.history.is_empty());
        // Deriving suppression from raw declarations remains safe after any failure.
        assert!(managed_facts(&items).contains(&("original@1", "fact-original")));
    }
    #[test]
    fn future_original_stays_pending() {
        let v = view(&chain(), "2026-11-10T06:00:00Z");
        assert_eq!(v.status, Status::Pending);
        assert!(v.current.is_none());
        assert!(v.version_token.is_none());
    }
}
