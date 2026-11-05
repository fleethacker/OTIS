//! Explicit synthetic-fixture allowlist. Never derive applicability from source text.
use crate::{IntakeError, Result};
use parse_command_types::{AuditEvent, Message, UtcTimestamp, event_id, message_id};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeSet;

pub const CONFIG_SOURCE: &str = "backend/config/watchdesk-demo.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Command {
    pub id: String,
    pub name: String,
    pub short_label: String,
    pub group: String,
    pub color_index: usize,
    pub is_own_ship: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Fixture {
    pub file: String,
    pub body_hashes: Vec<String>,
    pub command_ids: Vec<String>,
    #[serde(default)]
    pub recurrence: Option<String>,
    #[serde(default)]
    pub baseline_security: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    pub provenance: String,
    pub version: String,
    pub commands: Vec<Command>,
    pub fixtures: Vec<Fixture>,
}
impl Catalog {
    pub fn load() -> Result<Self> {
        let value: Self = serde_json::from_str(include_str!("../../../config/watchdesk-demo.json"))
            .map_err(|_| IntakeError("demo_config"))?;
        let ids: BTreeSet<_> = value.commands.iter().map(|c| c.id.clone()).collect();
        let mut hashes = BTreeSet::new();
        if value.commands.len() > 32
            || ids.len() != value.commands.len()
            || value
                .commands
                .iter()
                .any(|c| c.id.is_empty() || c.color_index >= 4)
            || value.fixtures.len() > 32
            || value.fixtures.iter().any(|f| {
                f.body_hashes.is_empty()
                    || f.body_hashes.len() > 2
                    || f.recurrence.as_deref().is_some_and(|v| {
                        v != "daily_radio_check" || f.file != "recurring-radio.txt"
                    })
                    || (f.baseline_security && f.file != "baseline-crypto.txt")
                    || f.command_ids.iter().any(|id| !ids.contains(id))
                    || f.body_hashes.iter().any(|h| {
                        parse_command_types::validate_hash_id(h, "demo_hash").is_err()
                            || !hashes.insert(h.clone())
                    })
            })
        {
            return Err(IntakeError("demo_config"));
        }
        Ok(value)
    }
    pub fn assignment(&self, body: &str) -> Option<&Fixture> {
        let hash = message_id(body);
        self.fixtures.iter().find(|f| f.body_hashes.contains(&hash))
    }
    pub fn audit(&self, fixture: &Fixture, core: &Message, at: &UtcTimestamp) -> AuditEvent {
        AuditEvent {
            id: event_id(&[
                &core.id,
                &core.revision,
                &self.version,
                "demo_command_assignment",
            ]),
            message_id: core.id.clone(),
            revision: core.revision.clone(),
            kind: "demo_command_assignment".into(),
            subject_id: None,
            recorded_at: at.clone(),
            issued_at: core.issued_at.clone(),
            review_only: Some(true),
            security: core.security.clone(),
            payload: serde_json::Map::from_iter([
                ("provenance".into(), json!(self.provenance)),
                ("config".into(), json!(CONFIG_SOURCE)),
                ("version".into(), json!(self.version)),
                ("fixture".into(), json!(fixture.file)),
                ("command_ids".into(), json!(fixture.command_ids)),
                (
                    "assignment_scope".into(),
                    json!("message; synthetic demo only"),
                ),
                (
                    "baseline_security_override".into(),
                    json!(fixture.baseline_security),
                ),
                (
                    "security_override_scope".into(),
                    json!("Exact fictional fixture only; no production baseline security default"),
                ),
            ]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_exact_constructed_fixtures_receive_configured_assignments() {
        let c = Catalog::load().unwrap();
        let bodies = [
            include_str!("../../../config/watchdesk-fixtures/meridian.txt"),
            include_str!("../../../config/watchdesk-fixtures/corvina.txt"),
            include_str!("../../../config/watchdesk-fixtures/tern.txt"),
            include_str!("../../../config/watchdesk-fixtures/halyard.txt"),
            include_str!("../../../config/watchdesk-fixtures/shared.txt"),
            include_str!("../../../config/watchdesk-fixtures/unassigned.txt"),
            include_str!("../../../config/watchdesk-fixtures/recurring-radio.txt"),
            include_str!("../../../config/watchdesk-fixtures/baseline-crypto.txt"),
        ];
        assert_eq!(bodies.len(), c.fixtures.len());
        for (body, fixture) in bodies.iter().zip(&c.fixtures) {
            assert_eq!(c.assignment(body).unwrap().command_ids, fixture.command_ids);
            assert_eq!(
                c.assignment(&body.replace('\n', "\r\n"))
                    .unwrap()
                    .command_ids,
                fixture.command_ids
            );
            assert!(c.assignment(&format!("{body}\n")).is_none());
        }
        assert!(
            c.assignment("USS Meridian USS Halyard USNS Tern USS Corvina")
                .is_none()
        );
        assert!(c.assignment(bodies[5]).unwrap().command_ids.is_empty());
        assert_eq!(c.assignment(bodies[4]).unwrap().command_ids.len(), 2);
    }
}
