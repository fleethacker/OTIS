use crate::{
    IntakeError, Result,
    config::Config,
    journal::{Journal, Receipt},
    mailbox::Mailbox,
};
use parse_command_core::{ParserHost, Registry};
use parse_command_parser_api::{DecodedMessage, ErrorKind, ParseContext, WorkBudget};
use parse_command_types::UtcTimestamp;
use std::sync::atomic::{AtomicBool, Ordering};

pub struct Service {
    pub journal: Journal,
    host: ParserHost,
    config: Config,
}
impl Service {
    pub fn open(config: Config) -> Result<Self> {
        config.validate()?;
        let registry = Registry::new(
            vec![Box::new(parse_command_optask::OptaskParser)],
            config.enabled_types.iter().cloned().collect(),
        )
        .map_err(|_| IntakeError("parser_registry"))?;
        let host =
            ParserHost::new(registry, config.parser).map_err(|_| IntakeError("parser_config"))?;
        let journal = Journal::open(&config)?;
        Ok(Self {
            journal,
            host,
            config,
        })
    }
    pub fn poll(&mut self, password: &str, cancelled: &AtomicBool) -> Result<usize> {
        let c = &self.config;
        self.journal.check_capacity(c)?;
        let (mut mailbox, selection) = Mailbox::connect(c, password)?;
        for uid in self
            .journal
            .missing_received_times(c, selection.uidvalidity)?
        {
            for row in mailbox.metadata(uid, uid, c)? {
                self.journal.backfill_received_time(
                    c,
                    selection.uidvalidity,
                    uid,
                    &row.received_at,
                )?;
            }
        }
        let cursor = self.journal.cursor(c, selection.uidvalidity)?;
        let start = cursor.checked_add(1).ok_or(IntakeError("uid_exhausted"))?;
        if start >= selection.uidnext {
            return Ok(0);
        }
        let end = start
            .saturating_add(c.uid_window - 1)
            .min(selection.uidnext - 1);
        let metadata = mailbox.metadata(start, end, c)?;
        let mut accepted = 0;
        for entry in metadata {
            if cancelled.load(Ordering::Relaxed) {
                return Err(IntakeError("cancelled"));
            }
            self.journal.check_capacity(c)?;
            let at = crate::now()?;
            if entry.size as usize > c.max_raw_bytes {
                self.journal.accept(
                    c,
                    Receipt {
                        validity: selection.uidvalidity,
                        uid: entry.uid,
                        size: entry.size,
                        raw: None,
                        state: "oversized_upstream",
                        code: Some("raw_size_limit"),
                        received_at: &at,
                        server_received_at: Some(&entry.received_at),
                    },
                )?;
                continue;
            }
            let bytes = mailbox.body(entry.uid, c)?;
            let (state, code) = if bytes.is_none() {
                ("vanished_upstream", Some("uid_disappeared"))
            } else {
                ("staged", None)
            };
            if bytes
                .as_ref()
                .is_some_and(|b| b.len() != entry.size as usize)
            {
                return Err(IntakeError("imap_size_changed"));
            }
            accepted += self.journal.accept(
                c,
                Receipt {
                    validity: selection.uidvalidity,
                    uid: entry.uid,
                    size: entry.size,
                    raw: bytes.as_deref(),
                    state,
                    code,
                    received_at: &at,
                    server_received_at: Some(&entry.received_at),
                },
            )? as usize;
        }
        // The complete metadata range was examined; receipt commits above already cover its UIDs.
        self.journal
            .advance_empty_range(c, selection.uidvalidity, end)?;
        Ok(accepted)
    }
    pub fn process(&mut self, cancelled: &AtomicBool) -> Result<usize> {
        let mut done = 0;
        for _ in 0..self.config.jobs_per_cycle {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            let Some(job) = self.journal.next_job(&self.config)? else {
                break;
            };
            if job.attempts >= self.config.max_parse_attempts {
                self.journal
                    .quarantine(&job.receipt_id, "quarantined", "attempt_limit")?;
                continue;
            }
            self.journal.attempt(&job.receipt_id)?;
            let email = match crate::mime::decode(&job.raw, self.config.mime) {
                Ok(email) => email,
                Err(error) => {
                    self.journal
                        .quarantine(&job.receipt_id, "quarantined", error.0)?;
                    done += 1;
                    continue;
                }
            };
            let budget = WorkBudget::new(self.config.parser_work_units, cancelled);
            let at =
                UtcTimestamp::new(&job.received_at).map_err(|_| IntakeError("receipt_time"))?;
            let context = ParseContext {
                revision: &self.config.revision,
                recorded_at: &at,
                command_ids: &[],
                security_override: None,
                reference_time: None,
                budget: &budget,
            };
            let parsed = self.host.parse(
                DecodedMessage {
                    body: &email.body,
                    subject: email.subject.as_deref(),
                },
                &context,
            );
            match parsed {
                Ok(value) => {
                    if let Err(error) = self.journal.finish(
                        &self.config,
                        &job,
                        value.core.into_inner(),
                        value.audit.into_iter().map(|e| e.into_inner()).collect(),
                        email,
                    ) {
                        self.journal.release_attempt(&job.receipt_id)?;
                        return Err(error);
                    }
                }
                Err(error) if error.kind == ErrorKind::Cancelled => {
                    self.journal.release_attempt(&job.receipt_id)?;
                    break;
                }
                Err(error) => self.journal.quarantine(
                    &job.receipt_id,
                    if error.kind == ErrorKind::UnsupportedProfile {
                        "unsupported"
                    } else {
                        "quarantined"
                    },
                    error.code,
                )?,
            }
            done += 1;
        }
        Ok(done)
    }
    pub fn delay(&self) -> u64 {
        self.config.poll_seconds
    }
    pub fn retry_limit(&self) -> u64 {
        self.config.retry_max_seconds
    }
}
