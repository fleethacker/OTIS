//! The LOW projection is an allowlist, never a redacted source document.
use parse_command_intake::network::Precedence;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
pub enum DeskNetwork {
    #[serde(rename = "LOW")]
    Low,
    #[serde(rename = "HIGH")]
    High,
    #[default]
    #[serde(rename = "ALL")]
    All,
}
impl DeskNetwork {
    pub fn copies(self) -> bool { matches!(self, Self::High | Self::All) }
    pub fn notices(self) -> bool { matches!(self, Self::Low | Self::All) }
    pub fn network(self) -> Option<&'static str> {
        match self { Self::Low => Some("LOW"), Self::High => Some("HIGH"), Self::All => None }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum HighestPrecedence {
    Stated(Precedence),
    Unstated(NotStated),
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub enum NotStated { #[serde(rename = "not stated")] Value }
/// This is the entire traffic payload permitted on LOW. Workflow timestamps and
/// opaque notice identity live in a separate typed envelope, never source data.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoticePayload {
    pub ship_id: String,
    pub count: usize,
    pub highest_precedence: HighestPrecedence,
    pub first_waiting_at: String,
    pub latest_waiting_at: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Waiting {
    pub at: String,
    pub precedence: Option<Precedence>,
    pub copied_at: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Acknowledgement {
    pub username: String,
    pub at: String,
    pub version: u64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Episode {
    pub id: String,
    pub sent_at: String,
    pub cleared_at: Option<String>,
    pub version: u64,
    pub members: BTreeMap<String, Waiting>,
    pub acknowledgements: BTreeMap<String, Acknowledgement>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ShipState { pub episodes: Vec<Episode> }
impl ShipState {
    pub fn contains(&self, key: &str) -> bool { self.episodes.iter().any(|e| e.members.contains_key(key)) }
    pub fn add(&mut self, ship: &str, key: &str, waiting: Waiting, sent_at: &str) -> parse_command_state::Result<()> {
        if self.contains(key) { return Ok(()); }
        if self.episodes.iter().map(|e| e.members.len()).sum::<usize>() >= 2000 {
            return Err(parse_command_state::Error("state_capacity"));
        }
        if self.episodes.last().is_none_or(|e| e.cleared_at.is_some()) {
            if self.episodes.len() >= 256 { return Err(parse_command_state::Error("state_capacity")); }
            self.episodes.push(Episode { id: parse_command_types::event_id(&["xnet", ship, key]), sent_at: sent_at.into(), cleared_at: None, version: 0, members: BTreeMap::new(), acknowledgements: BTreeMap::new() });
        }
        let episode = self.episodes.last_mut().ok_or(parse_command_state::Error("state_record"))?;
        episode.version += 1;
        episode.members.insert(key.into(), waiting);
        episode.clear_if_copied(sent_at);
        Ok(())
    }
    pub fn copied(&mut self, key: &str, at: &str) {
        for episode in &mut self.episodes {
            if let Some(member) = episode.members.get_mut(key) {
                member.copied_at.get_or_insert_with(|| at.into());
                episode.clear_if_copied(at);
            }
        }
    }
}
impl Episode {
    fn clear_if_copied(&mut self, at: &str) {
        if !self.members.is_empty() && self.members.values().all(|v| v.copied_at.is_some()) {
            self.cleared_at.get_or_insert_with(|| at.into());
        }
    }
    pub fn payload(&self, ship: &str) -> NoticePayload {
        // Cleared history retains the final episode summary, not a zero-message
        // banner. Open summaries describe only messages still waiting to be copied.
        let members: Vec<_> = self.members.values().filter(|v| self.cleared_at.is_some() || v.copied_at.is_none()).collect();
        NoticePayload {
            ship_id: ship.into(), count: members.len(),
            highest_precedence: members.iter().filter_map(|v| v.precedence).max().map(HighestPrecedence::Stated).unwrap_or(HighestPrecedence::Unstated(NotStated::Value)),
            first_waiting_at: members.iter().map(|v| &v.at).min().cloned().unwrap_or_default(),
            latest_waiting_at: members.iter().map(|v| &v.at).max().cloned().unwrap_or_default(),
        }
    }
    pub fn acknowledge(&mut self, owner: &str, username: &str, at: &str, version: u64) -> parse_command_state::Result<()> {
        if version == 0 || version > self.version { return Err(parse_command_state::Error("xnet_version")); }
        if self.acknowledgements.get(owner).is_some_and(|ack| ack.version >= version) { return Ok(()); }
        if !self.acknowledgements.contains_key(owner) && self.acknowledgements.len() >= 500 {
            return Err(parse_command_state::Error("state_capacity"));
        }
        self.acknowledgements.insert(owner.into(), Acknowledgement { username: username.chars().take(120).collect(), at: at.into(), version });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    fn waiting(precedence: Option<Precedence>) -> Waiting { Waiting { at: "2026-11-05T14:12:00Z".into(), precedence, copied_at: None } }
    #[test]
    fn payload_has_exactly_the_schema_allowlist_and_rejects_any_other_field() {
        let mut state = ShipState::default();
        state.add("USS Meridian", "hidden-message-key", waiting(None), "2026-11-05T14:13:00Z").unwrap();
        let payload = serde_json::to_value(state.episodes[0].payload("USS Meridian")).unwrap();
        let schema: Value = serde_json::from_str(include_str!("../../../../../docs/schemas/xnet-notice.schema.json")).unwrap();
        let fields = payload.as_object().unwrap();
        assert_eq!(fields.len(), schema["properties"].as_object().unwrap().len());
        assert!(fields.keys().all(|k| schema["properties"].get(k).is_some()));
        assert_eq!(payload["highestPrecedence"], "not stated");
        assert!(!payload.to_string().contains("hidden-message-key"));
        for field in ["subject", "originator", "body", "sets", "eventTitle", "eventTime", "messageKey", "unexpected"] {
            let mut extra = payload.clone(); extra[field] = json!("forbidden");
            assert!(serde_json::from_value::<NoticePayload>(extra).is_err());
        }
    }
    #[test]
    fn aggregation_replay_precedence_acknowledgements_and_clearing() {
        let mut state = ShipState::default();
        state.add("USS Meridian", "one", waiting(None), "sent").unwrap();
        state.add("USS Meridian", "two", waiting(Some(Precedence::Immediate)), "later").unwrap();
        state.add("USS Meridian", "one", waiting(Some(Precedence::Flash)), "replay").unwrap();
        assert_eq!(state.episodes.len(), 1);
        let episode = &mut state.episodes[0];
        assert_eq!(episode.payload("USS Meridian").count, 2);
        assert_eq!(episode.payload("USS Meridian").highest_precedence, HighestPrecedence::Stated(Precedence::Immediate));
        episode.acknowledge("viewer-one", "One", "1415", 2).unwrap();
        episode.acknowledge("viewer-two", "Two", "1416", 1).unwrap();
        assert_eq!(episode.acknowledgements["viewer-one"].at, "1415");
        assert_eq!(episode.acknowledgements["viewer-two"].version, 1);
        state.copied("one", "1420");
        assert_eq!(state.episodes[0].cleared_at, None);
        assert_eq!(state.episodes[0].payload("USS Meridian").count, 1);
        state.copied("two", "1430");
        assert_eq!(state.episodes[0].cleared_at.as_deref(), Some("1430"));
        state.add("USS Meridian", "two", waiting(None), "replay").unwrap();
        assert_eq!(state.episodes.len(), 1);
        state.add("USS Meridian", "three", waiting(None), "1440").unwrap();
        assert_eq!(state.episodes.len(), 2);
        assert!(state.episodes[1].acknowledgements.is_empty());
    }
    #[test]
    fn desk_network_is_a_view_and_copy_rule_not_a_role() {
        assert!(!DeskNetwork::Low.copies()); assert!(DeskNetwork::Low.notices());
        assert!(DeskNetwork::High.copies()); assert!(!DeskNetwork::High.notices());
        assert!(DeskNetwork::default().copies()); assert!(DeskNetwork::default().notices());
        assert!(serde_json::from_value::<DeskNetwork>(json!("OTHER")).is_err());
    }
}
