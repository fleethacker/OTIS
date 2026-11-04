use parse_command_intake::{IntakeError, Result, config::Config, service::Service};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
fn main() {
    // A library panic must not print input/server/SQL data through the default hook.
    std::panic::set_hook(Box::new(|_| eprintln!("intake_error: internal_panic")));
    if let Err(error) = run() {
        eprintln!("intake_error: {error}");
        std::process::exit(1);
    }
}
fn run() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 2
        || !["once", "watch", "status", "export", "receipts"].contains(&args[0].as_str())
    {
        return Err(IntakeError(
            "usage: parse-command-intake <once|watch|status|export|receipts> <config.json>",
        ));
    }
    let config = Config::load(std::path::Path::new(&args[1]))?;
    let password_name = config.password_env.clone();
    let mut service = Service::open(config)?;
    if args[0] == "status" {
        println!("{}", service.journal.status()?);
        return Ok(());
    }
    if args[0] == "export" {
        return service.journal.export(std::io::stdout().lock());
    }
    if args[0] == "receipts" {
        return service.journal.receipts(std::io::stdout().lock());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = cancelled.clone();
    ctrlc::set_handler(move || flag.store(true, Ordering::Relaxed))
        .map_err(|_| IntakeError("shutdown_handler"))?;
    let mut retry = service.delay();
    loop {
        // Resume staged work even when the mailbox is unavailable.
        let poll = (|| {
            service.process(&cancelled)?;
            let password =
                std::env::var(&password_name).map_err(|_| IntakeError("password_environment"))?;
            let poll = service.poll(&password, &cancelled);
            drop(password);
            service.process(&cancelled)?;
            poll
        })();
        if args[0] == "once" {
            poll?;
            println!("{}", service.journal.status()?);
            break;
        }
        let delay = match poll {
            Ok(_) => {
                retry = service.delay();
                service.delay()
            }
            Err(error) => {
                eprintln!("intake_poll_error: {error}");
                let wait = retry;
                retry = retry.saturating_mul(2).min(service.retry_limit());
                wait
            }
        };
        if cancelled.load(Ordering::Relaxed) {
            break;
        }
        for _ in 0..delay {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
        if cancelled.load(Ordering::Relaxed) {
            break;
        }
    }
    Ok(())
}
