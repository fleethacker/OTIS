//! One bounded configuration per mailbox, polled by the existing leased worker.
use crate::{IntakeError, Result, config::Config, service::Service};
use std::{sync::atomic::{AtomicBool, Ordering}, time::{Duration, Instant}};
struct Mailbox {
    service: Service,
    config: Config,
    next: Instant,
    retry: u64,
}
pub struct Fleet(Vec<Mailbox>);
impl Fleet {
    pub fn open(primary: Config) -> Result<Self> {
        let mut configs = vec![primary.clone()];
        if let Some(paths) = std::env::var_os("PARSE_COMMAND_ADDITIONAL_MAILBOX_CONFIGS") {
            for path in std::env::split_paths(&paths) {
                if configs.len() >= 8 { return Err(IntakeError("mailbox_config_bound")); }
                let config = Config::load(&path)?;
                if config.custody_index != primary.custody_index || config.opensearch_url != primary.opensearch_url
                    || configs.iter().any(|c| c.account_id == config.account_id || (c.host == config.host && c.port == config.port && c.username == config.username && c.mailbox == config.mailbox)) {
                    return Err(IntakeError("mailbox_config_conflict"));
                }
                configs.push(config);
            }
        }
        Ok(Self(configs.into_iter().map(|config| {
            Ok(Mailbox { service: Service::open(config.clone())?, retry: config.poll_seconds, config, next: Instant::now() })
        }).collect::<Result<Vec<_>>>()?))
    }
    pub fn run(&mut self, cancelled: &AtomicBool) {
        while !cancelled.load(Ordering::Relaxed) {
            for mailbox in &mut self.0 {
                if cancelled.load(Ordering::Relaxed) { break; }
                if Instant::now() < mailbox.next { continue; }
                let result = (|| {
                    mailbox.service.process(cancelled)?;
                    let password = std::env::var(&mailbox.config.password_env).map_err(|_| IntakeError("password_environment"))?;
                    let poll = mailbox.service.poll(&password, cancelled);
                    drop(password);
                    mailbox.service.process(cancelled)?;
                    poll
                })();
                let delay = if result.is_ok() {
                    mailbox.retry = mailbox.config.poll_seconds;
                    mailbox.retry
                } else {
                    eprintln!("intake_error: retry_pending");
                    let delay = mailbox.retry;
                    mailbox.retry = mailbox.retry.saturating_mul(2).min(mailbox.config.retry_max_seconds);
                    delay
                };
                mailbox.next = Instant::now() + Duration::from_secs(delay);
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }
}
