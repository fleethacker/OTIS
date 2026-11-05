//! Transport-independent contribution interface. No filesystem, network, clock, or storage clients.
mod output;
mod scanner;
pub use output::*;
pub use parse_command_types as types;
pub use scanner::*;
use serde::Serialize;
use std::{
    cell::Cell,
    fmt,
    sync::atomic::{AtomicBool, Ordering},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    UnsupportedProfile,
    AmbiguousProfile,
    MalformedInput,
    InvalidValue,
    ResourceLimit,
    Cancelled,
    InternalDefect,
    RegistryConflict,
}
/// Safe codes and offsets only: errors do not capture source message text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParseFailure {
    pub kind: ErrorKind,
    pub code: &'static str,
    pub offset: Option<usize>,
}
impl ParseFailure {
    pub const fn new(kind: ErrorKind, code: &'static str) -> Self {
        Self {
            kind,
            code,
            offset: None,
        }
    }
    pub const fn at(mut self, offset: usize) -> Self {
        self.offset = Some(offset);
        self
    }
}
impl fmt::Display for ParseFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.code)
    }
}
impl std::error::Error for ParseFailure {}
impl From<types::ValidationError> for ParseFailure {
    fn from(_: types::ValidationError) -> Self {
        Self::new(ErrorKind::InvalidValue, "invalid_icd_output")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FactCategory {
    Period,
    Frequency,
    Activity,
    Contact,
    Location,
    Casualty,
    Recurrence,
}
#[derive(Debug)]
pub struct ParserDescriptor {
    pub id: &'static str,
    pub version: &'static str,
    pub icd_major: u16,
    pub message_types: &'static [&'static str],
    pub profiles: &'static [&'static str],
    pub fact_categories: &'static [FactCategory],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MatchOutcome {
    Unsupported,
    Applicable {
        profile: &'static str,
        rule: &'static str,
    },
    Ambiguous {
        code: &'static str,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Completeness {
    Complete,
    Partial,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParseSummary {
    pub profile: &'static str,
    pub completeness: Completeness,
}

/// Cooperative work limit. It cannot forcibly preempt code in an in-process contribution.
pub struct WorkBudget<'a> {
    remaining: Cell<u64>,
    cancelled: &'a AtomicBool,
}
impl<'a> WorkBudget<'a> {
    pub fn new(units: u64, cancelled: &'a AtomicBool) -> Self {
        Self {
            remaining: Cell::new(units),
            cancelled,
        }
    }
    pub fn checkpoint(&self, units: u64) -> Result<(), ParseFailure> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(ParseFailure::new(ErrorKind::Cancelled, "cancelled"));
        }
        let remaining = self
            .remaining
            .get()
            .checked_sub(units)
            .ok_or(ParseFailure::new(ErrorKind::ResourceLimit, "work_units"))?;
        self.remaining.set(remaining);
        Ok(())
    }
    pub fn remaining(&self) -> u64 {
        self.remaining.get()
    }
}
pub struct ReferenceTime<'a> {
    pub instant: &'a types::UtcTimestamp,
    pub provenance: &'a str,
}
pub struct ParseContext<'a> {
    pub revision: &'a str,
    pub recorded_at: &'a types::UtcTimestamp,
    pub command_ids: &'a [String],
    /// Only host-supplied policy can establish validated markings.
    pub security_override: Option<&'a types::Security>,
    pub reference_time: Option<ReferenceTime<'a>>,
    pub budget: &'a WorkBudget<'a>,
}

pub trait MessageParser: Send + Sync {
    fn descriptor(&self) -> &'static ParserDescriptor;
    fn assess(&self, input: &MessageView<'_>) -> MatchOutcome;
    fn parse(
        &self,
        input: &MessageView<'_>,
        context: &ParseContext<'_>,
        output: &mut dyn ParseSink,
    ) -> Result<ParseSummary, ParseFailure>;
}

/// The caller has already decoded MIME/charset. This never performs mailbox or MIME I/O.
#[derive(Clone, Copy)]
pub struct DecodedMessage<'a> {
    pub body: &'a str,
    pub subject: Option<&'a str>,
}
/// Remove exactly one leading marker from an already decoded header, preserving interior markers.
pub fn display_subject(decoded: Option<&str>) -> Option<&str> {
    let value = decoded?.trim();
    let value = value.strip_prefix("SUBJ:").unwrap_or(value).trim();
    (!value.is_empty()).then_some(value)
}
