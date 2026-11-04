use crate::{ErrorKind, ParseFailure};
use parse_command_types::{Activity, Contact, Frequency, Period, Security, UtcTimestamp, Validate};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Map, Value};
use std::{collections::BTreeSet, io};

#[derive(Clone, Debug, Serialize)]
pub struct HeaderInterpretation {
    pub message_type: String,
    pub originator: String,
    pub serial: Option<String>,
    pub issued_at: Option<UtcTimestamp>,
    pub security: Security,
}
impl Validate for HeaderInterpretation {
    fn validate(&self) -> Result<(), parse_command_types::ValidationError> {
        if self.message_type.is_empty()
            || self.originator.is_empty()
            || self.serial.as_ref().is_some_and(String::is_empty)
        {
            return Err(parse_command_types::ValidationError {
                field: "header",
                rule: "nonempty",
            });
        }
        self.security.validate()
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct AuditEntry {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject_id: Option<String>,
    pub payload: Map<String, Value>,
}
impl Validate for AuditEntry {
    fn validate(&self) -> Result<(), parse_command_types::ValidationError> {
        parse_command_types::validate_token(&self.kind, "audit.kind")?;
        if let Some(id) = &self.subject_id {
            parse_command_types::validate_subject_id(id, None, "audit.subject_id")?;
        }
        Ok(())
    }
}
pub trait ParseSink {
    fn header(&mut self, value: HeaderInterpretation) -> Result<(), ParseFailure>;
    fn period(&mut self, value: Period) -> Result<(), ParseFailure>;
    fn frequency(&mut self, value: Frequency) -> Result<(), ParseFailure>;
    fn activity(&mut self, value: Activity) -> Result<(), ParseFailure>;
    fn contact(&mut self, value: Contact) -> Result<(), ParseFailure>;
    fn review_flag(&mut self, value: &str) -> Result<(), ParseFailure>;
    fn audit(&mut self, value: AuditEntry) -> Result<(), ParseFailure>;
}
/// No deployment defaults: callers choose count and serialized byte budgets explicitly.
#[derive(Clone, Copy, Debug)]
pub struct OutputLimits {
    pub max_core_items: usize,
    pub max_core_bytes: usize,
    pub max_audit_entries: usize,
    pub max_audit_bytes: usize,
    pub max_audit_depth: usize,
    pub max_audit_nodes: usize,
}
impl OutputLimits {
    pub fn validate(self) -> Result<(), ParseFailure> {
        if [
            self.max_core_items,
            self.max_core_bytes,
            self.max_audit_entries,
            self.max_audit_bytes,
            self.max_audit_depth,
            self.max_audit_nodes,
        ]
        .contains(&0)
            || self.max_audit_depth > 64
        {
            return Err(ParseFailure::new(ErrorKind::InvalidValue, "output_limits"));
        }
        Ok(())
    }
}
#[derive(Debug)]
pub struct ParsedFacts {
    pub header: HeaderInterpretation,
    pub periods: Vec<Period>,
    pub frequencies: Vec<Frequency>,
    pub activities: Vec<Activity>,
    pub contacts: Vec<Contact>,
    pub review_flags: Vec<String>,
    pub audit: Vec<AuditEntry>,
}

/// Counts serialized bytes without allocating a JSON buffer. Limits fail closed even if ignored.
pub struct BoundedOutput {
    limits: OutputLimits,
    header: Option<HeaderInterpretation>,
    periods: Vec<Period>,
    frequencies: Vec<Frequency>,
    activities: Vec<Activity>,
    contacts: Vec<Contact>,
    flags: Vec<String>,
    audit: Vec<AuditEntry>,
    ids: BTreeSet<String>,
    core_items: usize,
    core_bytes: usize,
    audit_bytes: usize,
    failure: Option<ParseFailure>,
}
impl BoundedOutput {
    pub fn new(limits: OutputLimits) -> Result<Self, ParseFailure> {
        limits.validate()?;
        Ok(Self {
            limits,
            header: None,
            periods: Vec::new(),
            frequencies: Vec::new(),
            activities: Vec::new(),
            contacts: Vec::new(),
            flags: Vec::new(),
            audit: Vec::new(),
            ids: BTreeSet::new(),
            core_items: 0,
            core_bytes: 0,
            audit_bytes: 0,
            failure: None,
        })
    }
    fn remember<T>(&mut self, result: Result<T, ParseFailure>) -> Result<T, ParseFailure> {
        match result {
            Ok(v) => Ok(v),
            Err(e) => {
                let first = *self.failure.get_or_insert(e);
                Err(first)
            }
        }
    }
    fn core<T: Serialize + Validate>(
        &mut self,
        value: &T,
        id: Option<&str>,
    ) -> Result<(), ParseFailure> {
        if let Some(e) = self.failure {
            return Err(e);
        }
        let result = (|| {
            value.validate()?;
            if self.core_items >= self.limits.max_core_items {
                return Err(ParseFailure::new(ErrorKind::ResourceLimit, "core_items"));
            }
            let size = encoded_len(value, self.limits.max_core_bytes - self.core_bytes)?;
            if let Some(id) = id {
                if !self.ids.insert(id.to_owned()) {
                    return Err(ParseFailure::new(
                        ErrorKind::InvalidValue,
                        "duplicate_subject_id",
                    ));
                }
            }
            self.core_bytes += size;
            self.core_items += 1;
            Ok(())
        })();
        self.remember(result)
    }
    pub fn finish(self) -> Result<ParsedFacts, ParseFailure> {
        if let Some(e) = self.failure {
            return Err(e);
        }
        let header = self.header.ok_or(ParseFailure::new(
            ErrorKind::MalformedInput,
            "missing_header_interpretation",
        ))?;
        Ok(ParsedFacts {
            header,
            periods: self.periods,
            frequencies: self.frequencies,
            activities: self.activities,
            contacts: self.contacts,
            review_flags: self.flags,
            audit: self.audit,
        })
    }
}
impl ParseSink for BoundedOutput {
    fn header(&mut self, value: HeaderInterpretation) -> Result<(), ParseFailure> {
        if self.header.is_some() {
            return self.remember(Err(ParseFailure::new(
                ErrorKind::InvalidValue,
                "duplicate_header",
            )));
        }
        self.core(&value, None)?;
        self.header = Some(value);
        Ok(())
    }
    fn period(&mut self, value: Period) -> Result<(), ParseFailure> {
        self.core(&value, Some(&value.id))?;
        self.periods.push(value);
        Ok(())
    }
    fn frequency(&mut self, value: Frequency) -> Result<(), ParseFailure> {
        self.core(&value, Some(&value.id))?;
        self.frequencies.push(value);
        Ok(())
    }
    fn activity(&mut self, value: Activity) -> Result<(), ParseFailure> {
        self.core(&value, Some(&value.id))?;
        self.activities.push(value);
        Ok(())
    }
    fn contact(&mut self, value: Contact) -> Result<(), ParseFailure> {
        self.core(&value, Some(&value.id))?;
        self.contacts.push(value);
        Ok(())
    }
    fn review_flag(&mut self, value: &str) -> Result<(), ParseFailure> {
        if let Some(e) = self.failure {
            return Err(e);
        }
        if self.flags.iter().any(|flag| flag == value) {
            return Ok(());
        }
        let result = (|| {
            parse_command_types::validate_token(value, "review_flag")?;
            if self.core_items >= self.limits.max_core_items {
                return Err(ParseFailure::new(ErrorKind::ResourceLimit, "core_items"));
            }
            self.core_bytes += encoded_len(value, self.limits.max_core_bytes - self.core_bytes)?;
            self.core_items += 1;
            Ok(())
        })();
        self.remember(result)?;
        self.flags.push(value.to_owned());
        Ok(())
    }
    fn audit(&mut self, value: AuditEntry) -> Result<(), ParseFailure> {
        if let Some(e) = self.failure {
            return Err(e);
        }
        let result = (|| {
            value.validate()?;
            if self.audit.len() >= self.limits.max_audit_entries {
                return Err(ParseFailure::new(ErrorKind::ResourceLimit, "audit_entries"));
            }
            check_payload(&value.payload, self.limits)?;
            self.audit_bytes +=
                encoded_len(&value, self.limits.max_audit_bytes - self.audit_bytes)?;
            Ok(())
        })();
        self.remember(result)?;
        self.audit.push(value);
        Ok(())
    }
}
/// Payload walk is iterative and bounded before serde visits recursive JSON values.
fn check_payload(payload: &Map<String, Value>, limits: OutputLimits) -> Result<(), ParseFailure> {
    if payload.len() > limits.max_audit_nodes {
        return Err(ParseFailure::new(ErrorKind::ResourceLimit, "audit_nodes"));
    }
    let mut stack: Vec<_> = payload.values().map(|v| (v, 1usize)).collect();
    let mut nodes = 0;
    while let Some((value, depth)) = stack.pop() {
        nodes += 1;
        if nodes > limits.max_audit_nodes || depth > limits.max_audit_depth {
            return Err(ParseFailure::new(
                ErrorKind::ResourceLimit,
                "audit_structure",
            ));
        }
        let count = match value {
            Value::Array(v) => v.len(),
            Value::Object(v) => v.len(),
            _ => 0,
        };
        let pending = nodes
            .checked_add(stack.len())
            .and_then(|v| v.checked_add(count))
            .ok_or(ParseFailure::new(ErrorKind::ResourceLimit, "audit_nodes"))?;
        if pending > limits.max_audit_nodes {
            return Err(ParseFailure::new(ErrorKind::ResourceLimit, "audit_nodes"));
        }
        match value {
            Value::Array(v) => stack.extend(v.iter().map(|x| (x, depth + 1))),
            Value::Object(v) => stack.extend(v.values().map(|x| (x, depth + 1))),
            _ => {}
        }
    }
    Ok(())
}
struct Counter {
    used: usize,
    max: usize,
}
impl io::Write for Counter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let used = self
            .used
            .checked_add(bytes.len())
            .filter(|n| *n <= self.max)
            .ok_or_else(|| io::Error::other("serialized byte limit"))?;
        self.used = used;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
pub fn encoded_len<T: Serialize + ?Sized>(value: &T, max: usize) -> Result<usize, ParseFailure> {
    let mut counter = Counter { used: 0, max };
    serde_json::to_writer(&mut counter, value)
        .map_err(|_| ParseFailure::new(ErrorKind::ResourceLimit, "serialized_bytes"))?;
    Ok(counter.used)
}
/// Decode a bounded document and then run ICD semantic validation; no schema fetches.
pub fn decode_document<T: DeserializeOwned + Validate>(
    bytes: &[u8],
    max_bytes: usize,
) -> Result<T, ParseFailure> {
    if bytes.len() > max_bytes {
        return Err(ParseFailure::new(
            ErrorKind::ResourceLimit,
            "document_bytes",
        ));
    }
    let value: T = serde_json::from_slice(bytes)
        .map_err(|_| ParseFailure::new(ErrorKind::InvalidValue, "invalid_document_json"))?;
    value.validate()?;
    Ok(value)
}
