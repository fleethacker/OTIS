//! Explicit station assignments constrain personal relevance; authorization roles stay separate.
use crate::{Error, Result, accounts::User, private::Private, responsibilities};
use parse_command_state::Store;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssignmentInput {
    pub ship_name: String,
    pub command_ids: Vec<String>,
    pub department: String,
    pub watch_station: String,
    pub responsibility_ids: Vec<String>,
    pub include_unassigned: bool,
}
impl AssignmentInput {
    pub fn validate(&self) -> Result<()> {
        if [&self.ship_name, &self.department, &self.watch_station]
            .iter()
            .any(|name| {
                name.trim().is_empty()
                    || name.chars().count() > 100
                    || name.chars().any(char::is_control)
            })
        {
            return Err(Error::invalid(
                "Ship, department and watch station names must have 1–100 characters",
            ));
        }
        for (ids, max) in [(&self.command_ids, 256), (&self.responsibility_ids, 128)] {
            if ids.is_empty()
                || ids.len() > 32
                || ids.iter().any(|id| {
                    id.trim().is_empty() || id.len() > max || id.chars().any(char::is_control)
                })
            {
                return Err(Error::invalid(
                    "A station assignment requires 1–32 exact command IDs and responsibility profile IDs",
                ));
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    #[serde(flatten)]
    pub details: AssignmentInput,
    pub revision: u64,
    pub source: String,
}
#[derive(Default, Debug)]
pub enum AssignmentPatch {
    #[default]
    Keep,
    Clear,
    Set(AssignmentInput),
}
impl<'de> Deserialize<'de> for AssignmentPatch {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        Ok(Option::<AssignmentInput>::deserialize(deserializer)?
            .map(Self::Set)
            .unwrap_or(Self::Clear))
    }
}
#[derive(Clone, Debug)]
pub struct ResolvedScope {
    pub assigned_commands: Option<Vec<String>>,
    pub include_unassigned: bool,
    pub message_types: Option<Vec<String>>,
    pub match_none: bool,
    pub fingerprint: String,
    pub context: Value,
}
fn types(profiles: &[responsibilities::Profile]) -> Vec<String> {
    profiles
        .iter()
        .flat_map(|p| p.message_types.iter().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}
fn intersection(left: Option<Vec<String>>, right: Option<Vec<String>>) -> Option<Vec<String>> {
    match (left, right) {
        (None, value) | (value, None) => value,
        (Some(left), Some(right)) => Some(left.into_iter().filter(|v| right.contains(v)).collect()),
    }
}
pub async fn effective_scope(store: &Private, owner: &str) -> Result<ResolvedScope> {
    let user = crate::accounts::account(&store.state, owner).await?;
    let personal = crate::accounts::message_scope(&store.state, owner).await?;
    resolve(&store.state, &user, &personal, required()?).await
}
pub fn required() -> Result<bool> {
    match std::env::var("PARSE_COMMAND_REQUIRE_STATION_ASSIGNMENT") {
        Err(std::env::VarError::NotPresent) => Ok(false),
        Ok(value) if value == "true" => Ok(true),
        Ok(value) if value == "false" => Ok(false),
        _ => Err(Error::config(
            "PARSE_COMMAND_REQUIRE_STATION_ASSIGNMENT must be true or false",
        )),
    }
}
pub async fn resolve(
    db: &Store,
    user: &User,
    personal: &MessageScope,
    required: bool,
) -> Result<ResolvedScope> {
    user.require("schedule:read")?;
    personal.validate()?;
    if required && user.station_assignment.is_none() {
        return Err(Error::new(
            "permission_denied",
            "Your account needs a station assignment from an administrator",
        ));
    }
    let selected = responsibilities::resolve(db, &personal.responsibility_ids).await?;
    let personal_types = (!personal.responsibility_ids.is_empty()).then(|| types(&selected));
    let personal_commands = (!personal.all_commands).then(|| personal.command_ids.clone());
    let (commands, include_unassigned, assigned_profiles) =
        if let Some(assignment) = &user.station_assignment {
            assignment.details.validate()?;
            (
                intersection(
                    Some(assignment.details.command_ids.clone()),
                    personal_commands,
                ),
                assignment.details.include_unassigned && personal.include_unassigned,
                responsibilities::resolve(db, &assignment.details.responsibility_ids).await?,
            )
        } else {
            (personal_commands, personal.include_unassigned, vec![])
        };
    let assigned_types = user
        .station_assignment
        .as_ref()
        .map(|_| types(&assigned_profiles));
    let message_types = intersection(assigned_types, personal_types);
    let match_none = (commands.as_ref().is_some_and(Vec::is_empty) && !include_unassigned)
        || message_types.as_ref().is_some_and(Vec::is_empty);
    let context = json!({"stationAssignment":user.station_assignment,"effectiveScope":{"allCommands":commands.is_none(),"commandIds":commands.as_deref().unwrap_or(&[]),"includeUnassigned":include_unassigned,"messageTypes":message_types,"matchNone":match_none}});
    let fingerprint=crate::accounts::digest(&json!({"owner":user.id,"revision":user.station_revision,"assignment":user.station_assignment,"personal":personal,"required":required,"assignedProfiles":assigned_profiles,"selectedProfiles":selected}).to_string());
    Ok(ResolvedScope {
        assigned_commands: commands,
        include_unassigned,
        message_types,
        match_none,
        fingerprint,
        context,
    })
}
impl ResolvedScope {
    pub fn matches(&self, core: &Value) -> Result<bool> {
        if self.match_none {
            return Ok(false);
        }
        let commands = core["command_ids"].as_array();
        let unassigned = commands.is_none_or(|v| v.is_empty());
        let command_match = if unassigned {
            self.include_unassigned
        } else {
            self.assigned_commands.as_ref().is_none_or(|ids| {
                commands.is_some_and(|values| {
                    values
                        .iter()
                        .any(|v| v.as_str().is_some_and(|v| ids.iter().any(|id| id == v)))
                })
            })
        };
        Ok(command_match
            && self.message_types.as_ref().is_none_or(|types| {
                core["type"]
                    .as_str()
                    .is_some_and(|kind| types.iter().any(|value| value == kind))
            }))
    }
    pub fn search_filters(&self) -> Result<Vec<Value>> {
        if self.match_none {
            return Ok(vec![json!({"match_none":{}})]);
        }
        let mut filters = vec![];
        let unassigned = json!({"bool":{"must_not":[{"exists":{"field":"command_ids"}}]}});
        match &self.assigned_commands {
            None => {
                if !self.include_unassigned {
                    filters.push(json!({"exists":{"field":"command_ids"}}));
                }
            }
            Some(ids) if ids.is_empty() => filters.push(unassigned),
            Some(ids) => {
                if self.include_unassigned {
                    filters.push(json!({"bool":{"should":[{"terms":{"command_ids":ids}},unassigned],"minimum_should_match":1}}));
                } else {
                    filters.push(json!({"terms":{"command_ids":ids}}));
                }
            }
        }
        if let Some(types) = &self.message_types {
            filters.push(json!({"terms":{"type":types}}));
        }
        Ok(filters)
    }
}

impl ResolvedScope {
    pub fn command_visible(&self, id: &str) -> bool {
        !self.match_none
            && self
                .assigned_commands
                .as_ref()
                .is_none_or(|ids| ids.iter().any(|v| v == id))
    }
    pub fn unrestricted(&self) -> bool {
        !self.match_none
            && self.assigned_commands.is_none()
            && self.include_unassigned
            && self.message_types.is_none()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageScope {
    pub all_commands: bool,
    pub command_ids: Vec<String>,
    pub include_unassigned: bool,
    #[serde(default)]
    pub responsibility_ids: Vec<String>,
}
impl Default for MessageScope {
    fn default() -> Self {
        Self {
            all_commands: true,
            command_ids: vec![],
            include_unassigned: true,
            responsibility_ids: vec![],
        }
    }
}
impl MessageScope {
    pub fn validate(&self) -> Result<()> {
        if self.command_ids.len() > 32
            || self
                .command_ids
                .iter()
                .any(|id| id.trim().is_empty() || id.len() > 256)
        {
            return Err(Error::invalid(
                "Select at most 32 exact command IDs of at most 256 bytes",
            ));
        }
        if self.responsibility_ids.len() > 32
            || self.responsibility_ids.iter().any(|id| {
                id.trim().is_empty() || id.len() > 128 || id.chars().any(char::is_control)
            })
        {
            return Err(Error::invalid("Select at most 32 responsibility profiles"));
        }
        Ok(())
    }
}
