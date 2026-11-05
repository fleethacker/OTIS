//! Durable, bounded IMAP receipt intake and parser staging. No downstream delivery claim.
pub mod config;
pub mod demo;
mod demo_recurrence;
pub mod journal;
pub mod mailbox;
pub mod mime;
pub mod service;

/// Static diagnostics only. Never log credentials, server prose, email contents or DB bindings.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IntakeError(pub &'static str);
impl std::fmt::Display for IntakeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for IntakeError {}
pub type Result<T> = std::result::Result<T, IntakeError>;
impl From<parse_command_state::Error> for IntakeError {
    fn from(error: parse_command_state::Error) -> Self {
        Self(error.0)
    }
}
impl From<std::io::Error> for IntakeError {
    fn from(_: std::io::Error) -> Self {
        Self("io")
    }
}
pub fn now() -> Result<String> {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| IntakeError("system_clock"))?;
    // Recording time is host metadata, never USMTF issue/event context.
    chrono::DateTime::from_timestamp(
        i64::try_from(t.as_secs()).map_err(|_| IntakeError("system_clock"))?,
        0,
    )
    .map(|v| v.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
    .ok_or(IntakeError("system_clock"))
}
