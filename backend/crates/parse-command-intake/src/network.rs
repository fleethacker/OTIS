//! Transport-owned demo metadata. Never infer precedence or command applicability
//! from a subject, narrative, participant, originator, or network name.
use crate::{IntakeError, Result, config::MimeLimits};
use mailparse::MailHeaderMap;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum Network {
    #[serde(rename = "HIGH")]
    High,
    #[serde(rename = "LOW")]
    Low,
}
impl Network {
    pub fn as_str(self) -> &'static str {
        match self { Self::High => "HIGH", Self::Low => "LOW" }
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Precedence { Routine, Priority, Immediate, Flash }

#[derive(Clone, Default, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub command_ids: Vec<String>,
    pub precedence: Option<Precedence>,
}
/// A deliberately narrow RFC 6477 §3.8 subset: bare labels or numbers 1–4.
/// Unsupported values, comments, duplicates and absent fields remain unstated.
pub fn precedence(values: &[String]) -> Option<Precedence> {
    if values.len() != 1 { return None; }
    match values[0].trim().to_ascii_uppercase().as_str() {
        "1" | "ROUTINE" => Some(Precedence::Routine),
        "2" | "PRIORITY" => Some(Precedence::Priority),
        "3" | "IMMEDIATE" => Some(Precedence::Immediate),
        "4" | "FLASH" => Some(Precedence::Flash),
        _ => None,
    }
}
/// Only explicitly allowlisted fictional command IDs in this demo extension
/// become host context. The header is not an operational roster resolver.
pub fn envelope(raw: &[u8], limits: MimeLimits, allowed: &[String]) -> Result<Envelope> {
    let stop = raw.windows(4).position(|w| w == b"\r\n\r\n").map(|n| n + 4)
        .or_else(|| raw.windows(2).position(|w| w == b"\n\n").map(|n| n + 2))
        .ok_or(IntakeError("mime_header_boundary"))?;
    if stop > limits.max_header_bytes { return Err(IntakeError("mime_header_limit")); }
    let (headers, _) = mailparse::parse_headers(&raw[..stop]).map_err(|_| IntakeError("mime_headers"))?;
    if headers.len() > limits.max_headers { return Err(IntakeError("mime_header_count")); }
    let values = headers.get_all_values("X-Demo-Command-IDs");
    let mut commands = BTreeSet::new();
    if values.len() == 1 {
        for id in values[0].split(',').map(str::trim) {
            if allowed.iter().any(|v| v == id) { commands.insert(id.to_owned()); }
        }
    }
    Ok(Envelope { command_ids: commands.into_iter().collect(), precedence: precedence(&headers.get_all_values("MMHS-Primary-Precedence")) })
}

/// Preserve the first accepted envelope on each network; duplicate deliveries do
/// not change precedence or silently reassign an already noticed message.
pub fn record_arrival(row: &mut parse_command_state::Record, network: Option<Network>, arrival: &serde_json::Value) -> parse_command_state::Result<()> {
    let Some(network) = network else { return Ok(()); };
    if row.payload["arrivals"].is_null() { row.payload["arrivals"] = serde_json::json!({}); }
    let arrivals = row.payload["arrivals"].as_object_mut().ok_or(parse_command_state::Error("state_record"))?;
    arrivals.entry(network.as_str()).or_insert_with(|| arrival.clone());
    let flag = format!("arrival:{}", network.as_str());
    if !row.flags.contains(&flag) { row.flags.push(flag); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn precedence_is_only_an_explicit_supported_source_field() {
        for (source, expected) in [("routine", Precedence::Routine), ("2", Precedence::Priority), ("IMMEDIATE", Precedence::Immediate), ("4", Precedence::Flash)] {
            assert_eq!(precedence(&[source.into()]), Some(expected));
        }
        for values in [vec![], vec!["URGENT".into()], vec!["0".into()], vec!["5".into()], vec!["FLASH".into(), "FLASH".into()], vec!["3 (IMMEDIATE)".into()]] {
            assert_eq!(precedence(&values), None);
        }
    }
    #[test]
    fn subject_body_and_unapproved_commands_cannot_supply_metadata() {
        let limits = MimeLimits { max_depth: 8, max_parts: 64, max_header_bytes: 4096, max_headers: 64, max_decoded_bytes: 4096 };
        let raw = b"Subject: FLASH\r\nX-Demo-Command-IDs: demo-meridian, Not approved\r\n\r\nMSGID/FLASH//\nMMHS-Primary-Precedence: FLASH";
        let result = envelope(raw, limits, &["demo-meridian".into()]).unwrap();
        assert_eq!(result.precedence, None);
        assert_eq!(result.command_ids, ["demo-meridian"]);
    }
}
