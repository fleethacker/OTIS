//! Local planning decisions; persisted with the shared workflow CAS aggregate.
use super::calculation::{self, Assessment, Event, Inputs, Interval, MoveRules, Person};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Planning {
    pub version: u64,
    pub roster_version: u64,
    pub plan_version: u64,
    pub people: Vec<Person>,
    pub roster_observed_at: String,
    pub roster_valid_until: String,
    pub local_event: Event,
    pub rules: MoveRules,
    pub coverage: Interval,
    pub schedule_complete: bool,
    pub proposals: Vec<Proposal>,
    pub decisions: Vec<Decision>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Proposal {
    pub id: String,
    pub input_version: String,
    pub status: String,
    pub alternative: Interval,
    pub created_at: String,
    pub actor: String,
    pub inputs: Inputs,
    pub assessment: Assessment,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Decision {
    pub proposal_id: String,
    pub decision: String,
    pub actor: String,
    pub recorded_at: String,
    pub input_version: String,
    pub roster_version: u64,
    pub plan_version: u64,
    pub reason: String,
}
pub struct DecisionRequest<'a> {
    pub proposal_id: &'a str,
    pub decision: &'a str,
    pub reason: &'a str,
    pub actor: &'a str,
    pub recorded_at: &'a str,
}
pub fn input_version(planning: &Planning, inputs: &Inputs, event_token: &str) -> String {
    let bytes = serde_json::to_vec(&(
        planning.roster_version,
        planning.plan_version,
        inputs,
        event_token,
    ))
    .expect("serializable planning inputs");
    format!("pb4t:{:x}", Sha256::digest(bytes))
}
impl Planning {
    fn require_bound_inputs(&self, inputs: &Inputs, event_token: &str) -> Result<(), &'static str> {
        if event_token.trim().is_empty() {
            return Err("Current-event version is missing; recalculate before planning.");
        }
        if inputs.people != self.people
            || inputs.rules != self.rules
            || inputs.roster_observed_at != self.roster_observed_at
            || inputs.roster_valid_until != self.roster_valid_until
            || inputs.coverage != self.coverage
            || inputs.schedule_complete != self.schedule_complete
            || self.rules.event_id != self.local_event.id
            || self.local_event.fixed
            || !inputs.events.iter().any(|event| event == &self.local_event)
            || inputs
                .events
                .iter()
                .any(|event| event.id == self.local_event.id && event != &self.local_event)
        {
            return Err(
                "Planning inputs do not match the persisted personnel and local plan; recalculate.",
            );
        }
        Ok(())
    }
    pub fn propose(
        &mut self,
        inputs: Inputs,
        event_token: &str,
        actor: &str,
        now: &str,
    ) -> Result<(), &'static str> {
        self.require_bound_inputs(&inputs, event_token)?;
        require_actor_time(actor, now)?;
        let assessment = calculation::assess(&inputs, 4096);
        let alternative = assessment
            .alternative
            .clone()
            .ok_or("No complete feasible alternative is available; recalculate the inputs.")?;
        let version = input_version(self, &inputs, event_token);
        if self
            .proposals
            .iter()
            .any(|p| p.input_version == version && p.status == "pending")
        {
            return Ok(());
        }
        if self.proposals.len() >= 64 {
            return Err("Planning history capacity reached.");
        }
        let next_version = self
            .version
            .checked_add(1)
            .ok_or("Planning version capacity reached.")?;
        if self
            .proposals
            .iter()
            .any(|proposal| proposal.id == format!("proposal-{next_version}"))
        {
            return Err("Planning proposal identity is inconsistent.");
        }
        self.version = next_version;
        self.proposals.push(Proposal {
            id: format!("proposal-{}", self.version),
            input_version: version,
            status: "pending".into(),
            alternative,
            created_at: now.into(),
            actor: actor.into(),
            inputs,
            assessment,
        });
        Ok(())
    }
    /// Caller resolves current events and applies this method to the same loaded
    /// aggregate before one CAS write. Never retry a decision after CAS failure.
    pub fn decide(
        &mut self,
        request: DecisionRequest<'_>,
        inputs: &Inputs,
        event_token: &str,
    ) -> Result<(), &'static str> {
        let DecisionRequest {
            proposal_id,
            decision,
            reason,
            actor,
            recorded_at: now,
        } = request;
        self.require_bound_inputs(inputs, event_token)?;
        require_actor_time(actor, now)?;
        if !matches!(decision, "accept" | "reject") {
            return Err("Choose accept or reject.");
        }
        if reason.chars().count() > 500 || reason.chars().any(char::is_control) {
            return Err("Decision reason must contain at most 500 printable characters.");
        }
        let position = self
            .proposals
            .iter()
            .position(|p| p.id == proposal_id)
            .ok_or("Proposal not found.")?;
        let proposal = &self.proposals[position];
        if proposal.status != "pending" {
            return Err("This proposal already has a decision.");
        }
        if proposal.input_version != input_version(self, inputs, event_token) {
            return Err("Planning inputs changed; recalculate before deciding.");
        }
        if self.decisions.len() >= 256 {
            return Err("Planning history capacity reached.");
        }
        if decision == "accept" {
            let assessment = calculation::assess(inputs, 4096);
            if assessment.status != "feasible"
                || assessment.alternative.as_ref() != Some(&proposal.alternative)
            {
                return Err(
                    "Constraints changed or assessment incomplete; recalculate before accepting.",
                );
            }
        }
        let next_version = self
            .version
            .checked_add(1)
            .ok_or("Planning version capacity reached.")?;
        let next_plan_version = if decision == "accept" {
            self.plan_version
                .checked_add(1)
                .ok_or("Local plan version capacity reached.")?
        } else {
            self.plan_version
        };
        self.decisions.push(Decision {
            proposal_id: proposal_id.into(),
            decision: decision.into(),
            actor: actor.into(),
            recorded_at: now.into(),
            input_version: proposal.input_version.clone(),
            roster_version: self.roster_version,
            plan_version: self.plan_version,
            reason: reason.trim().into(),
        });
        if decision == "accept" {
            self.plan_version = next_plan_version;
            self.local_event.interval = Some(proposal.alternative.clone());
            self.local_event.version = format!("local-plan:{}", self.plan_version);
        }
        self.proposals[position].status = if decision == "accept" {
            "accepted"
        } else {
            "rejected"
        }
        .into();
        self.version = next_version;
        Ok(())
    }
}
fn require_actor_time(actor: &str, now: &str) -> Result<(), &'static str> {
    if actor.trim().is_empty() || chrono::DateTime::parse_from_rfc3339(now).is_err() {
        return Err("An authenticated actor and actual RFC3339 decision time are required.");
    }
    Ok(())
}
