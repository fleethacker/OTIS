use crate::{IntakeError, Result};
use serde::Deserialize;
use std::{io::Read, path::PathBuf};

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub account_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub mailbox: String,
    pub password_env: String,
    pub transport: Transport,
    #[serde(default = "default_search")]
    pub opensearch_url: String,
    #[serde(default = "default_index")]
    pub custody_index: String,
    #[serde(default)]
    pub tls_ca: Option<PathBuf>,
    pub revision: String,
    pub poll_seconds: u64,
    pub retry_max_seconds: u64,
    pub io_timeout_seconds: u64,
    pub uid_window: u32,
    pub jobs_per_cycle: usize,
    pub max_raw_bytes: usize,
    pub max_response_bytes: usize,
    pub max_wire_bytes_per_poll: usize,
    pub max_responses_per_command: usize,
    pub max_receipts: u64,
    pub max_retained_bytes: u64,
    pub max_parse_attempts: u32,
    pub parser_work_units: u64,
    pub mime: MimeLimits,
    pub parser: parse_command_core::HostLimits,
    pub enabled_types: Vec<String>,
    pub subject_policy: SubjectPolicy,
}
fn default_search() -> String {
    std::env::var("PARSE_COMMAND_OPENSEARCH_URL")
        .unwrap_or_else(|_| "http://opensearch:9200".into())
}
fn default_index() -> String {
    std::env::var("PARSE_COMMAND_CUSTODY_INDEX")
        .unwrap_or_else(|_| ".parse-command-custody-v1".into())
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Transport {
    PlaintextDemo,
    /// Implicit TLS with certificate and hostname verification; never STARTTLS downgrade.
    Tls,
}
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SubjectPolicy {
    LatestReceived,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MimeLimits {
    pub max_depth: usize,
    pub max_parts: usize,
    pub max_header_bytes: usize,
    pub max_headers: usize,
    pub max_decoded_bytes: usize,
}
impl Config {
    pub fn load(path: &std::path::Path) -> Result<Self> {
        let mut bytes = Vec::new();
        std::fs::File::open(path)?
            .take(65537)
            .read_to_end(&mut bytes)?;
        if bytes.len() > 65536 {
            return Err(IntakeError("config_size"));
        }
        let value: Self = serde_json::from_slice(&bytes).map_err(|_| IntakeError("config_json"))?;
        value.validate()?;
        Ok(value)
    }
    pub fn validate(&self) -> Result<()> {
        parse_command_types::validate_revision(&self.account_id, "account_id")
            .map_err(|_| IntakeError("account_id"))?;
        parse_command_types::validate_revision(&self.revision, "revision")
            .map_err(|_| IntakeError("revision"))?;
        // This explicit demo transport never sends credentials to a remote Exchange host.
        if matches!(self.transport, Transport::PlaintextDemo)
            && !matches!(self.host.as_str(), "127.0.0.1" | "::1" | "mailserver")
        {
            return Err(IntakeError("demo_host_only"));
        }
        if self.host.is_empty()
            || self.host.len() > 253
            || self.host.contains(['/', '\\', '\r', '\n', '\0'])
        {
            return Err(IntakeError("imap_host"));
        }
        if self.port == 0
            || self.username.is_empty()
            || self.mailbox.is_empty()
            || self.password_env.is_empty()
            || self.io_timeout_seconds > 300
            || self.poll_seconds > 3600
            || self.retry_max_seconds > 3600
            || self.jobs_per_cycle > 10000
            || self.max_retained_bytes > i64::MAX as u64
            || self.max_receipts > i64::MAX as u64
            || self.uid_window == 0
            || self.uid_window > 4096
            || self.jobs_per_cycle == 0
            || self.max_parse_attempts == 0
            || [
                self.poll_seconds,
                self.retry_max_seconds,
                self.io_timeout_seconds,
                self.max_receipts,
                self.max_retained_bytes,
                self.parser_work_units,
            ]
            .contains(&0)
            || [
                self.max_raw_bytes,
                self.max_response_bytes,
                self.max_wire_bytes_per_poll,
                self.max_responses_per_command,
                self.mime.max_depth,
                self.mime.max_parts,
                self.mime.max_header_bytes,
                self.mime.max_headers,
                self.mime.max_decoded_bytes,
            ]
            .contains(&0)
            || self.mime.max_depth > 32
            || self.max_raw_bytes > u32::MAX as usize
            || self.max_response_bytes < self.max_raw_bytes.saturating_add(16384)
            || self.max_wire_bytes_per_poll < self.max_response_bytes
            || self.retry_max_seconds < self.poll_seconds
            || self.enabled_types.is_empty()
        {
            return Err(IntakeError("config_limits"));
        }
        self.parser
            .scan
            .validate()
            .map_err(|_| IntakeError("parser_limits"))?;
        self.parser
            .output
            .validate()
            .map_err(|_| IntakeError("parser_limits"))?;
        if self.parser.max_subject_bytes == 0 {
            return Err(IntakeError("parser_limits"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    #[test]
    fn remote_mail_requires_tls_and_plaintext_demo_stays_restricted() {
        let mut c = Config::load(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/demo-intake.json"),
        )
        .unwrap();
        c.host = "mail.example.invalid".into();
        assert_eq!(c.validate().unwrap_err().0, "demo_host_only");
        c.transport = Transport::Tls;
        c.port = 993;
        assert!(c.validate().is_ok());
        c.host = "mail.example.invalid/attacker".into();
        assert!(c.validate().is_err());
    }
}
