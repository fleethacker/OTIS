use parse_command_server::{
    Error,
    api::App,
    config::Config,
    private::Private,
    publisher::{Publisher, Status},
    search::Search,
};
use std::{
    io::{Read, Write},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
fn main() {
    std::panic::set_hook(Box::new(|_| eprintln!("server_error: internal_panic")));
    if let Err(error) = run() {
        eprintln!("server_error: {error}");
        std::process::exit(1);
    }
}
fn run() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.first().map(String::as_str) == Some("healthcheck") {
        let mut socket = std::net::TcpStream::connect_timeout(
            &"127.0.0.1:8081".parse()?,
            Duration::from_secs(2),
        )?;
        socket.set_read_timeout(Some(Duration::from_secs(2)))?;
        socket.write_all(
            b"GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )?;
        let mut bytes = [0; 128];
        let n = socket.read(&mut bytes)?;
        if !bytes[..n].starts_with(b"HTTP/1.1 200") {
            return Err("HTTP health failed".into());
        }
        return Ok(());
    }
    if args.len() != 2 || args[0] != "serve" {
        return Err("usage: parse-command-server serve <intake-config.json> | healthcheck".into());
    }
    let config = Config::load(std::path::Path::new(&args[1]))?;
    // Verify migration and acquire the single-writer lease before starting either worker.
    let lease_token = parse_command_server::private::random_token()?;
    {
        for index in [&config.state_index, &config.intake.custody_index] {
            let store = parse_command_state::BlockingStore::new(&config.search, index)?;
            store.provision()?;
            if std::env::var("PARSE_COMMAND_REQUIRE_STATE_MIGRATION").as_deref() == Ok("true")
                && store
                    .get("migration", "sqlite-to-opensearch-v1")?
                    .is_none_or(|d| d.record.state != "complete")
            {
                return Err("verified state migration is required before startup".into());
            }
        }
        let store =
            parse_command_state::BlockingStore::new(&config.search, &config.intake.custody_index)?;
        // A replaced container can leave its 30-second lease behind. Wait only
        // for that bounded interval; a live peer continues renewing and wins.
        for attempt in 0..=30 {
            let acquired = store.update("server_lease", "application", |old| {
                if old.is_some_and(|r| r.available > parse_command_state::epoch()) {
                    return Err(parse_command_state::Error("another_server_holds_lease"));
                }
                let mut row = parse_command_state::Record::new(
                    "server_lease",
                    "application",
                    serde_json::json!({"token":lease_token}),
                );
                row.available = parse_command_state::epoch() + 30;
                Ok(row)
            });
            match acquired {
                Ok(_) => break,
                Err(error) if error.0 == "another_server_holds_lease" && attempt < 30 => {
                    std::thread::sleep(Duration::from_secs(1));
                }
                Err(error) => return Err(error.into()),
            }
        }
    }
    let mut intake = parse_command_intake::fleet::Fleet::open(config.intake.clone())?;
    let status = Status {
        ready: Arc::new(AtomicBool::new(false)),
        model: Arc::new(AtomicBool::new(false)),
    };
    let publisher = Publisher::open(config.clone(), status.clone())?;
    let cancelled = Arc::new(AtomicBool::new(false));
    let poll_cancel = cancelled.clone();
    let intake_thread = std::thread::Builder::new()
        .name("imap-intake".into())
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                intake.run(&poll_cancel);
            }));
            if result.is_err() {
                std::process::exit(1);
            }
        })?;
    let publish_cancel = cancelled.clone();
    let publish_thread = std::thread::Builder::new()
        .name("search-publisher".into())
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                publisher.run(publish_cancel)
            }));
            if result.is_err() {
                std::process::exit(1);
            }
        })?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(8)
        .enable_all()
        .build()?;
    let listen = config.listen.clone();
    let state_cancel = cancelled.clone();
    let result = runtime.block_on(async move {
        let state = parse_command_state::Store::new(&config.search, &config.state_index)?;
        state.provision().await?;
        // The fictional Watch Desk demo seeds its roster defaults only into an empty store.
        let initial = if config.intake.demo_fixture_assignments {
            parse_command_server::settings::Settings::demo(
                &parse_command_server::commands::catalog(true)?,
            )
        } else {
            parse_command_server::settings::Settings::default()
        };
        parse_command_server::settings::bootstrap_with(&state, initial).await?;
        let custody =
            parse_command_state::Store::new(&config.search, &config.intake.custody_index)?;
        let app = Arc::new(App {
            search: Search::new(config.search.clone())?,
            auth: parse_command_server::auth::Auth::new(config.auth.clone(), state.clone())?,
            config,
            private: Private::new(state),
            custody,
            notification_sync: Arc::new(tokio::sync::Mutex::new(())),
            status,
            inference: Arc::new(tokio::sync::Semaphore::new(1)),
        });
        let lease_store = app.custody.clone();
        let lease_cancel = state_cancel.clone();
        tokio::spawn(async move {
            while !lease_cancel.load(Ordering::Relaxed) {
                let renewed = lease_store
                    .update("server_lease", "application", |old| {
                        let mut row = old
                            .cloned()
                            .ok_or(parse_command_state::Error("lease_lost"))?;
                        if row.payload["token"] != lease_token
                            || row.available <= parse_command_state::epoch()
                        {
                            return Err(parse_command_state::Error("lease_lost"));
                        }
                        row.available = parse_command_state::epoch() + 30;
                        Ok(row)
                    })
                    .await;
                if renewed.is_err() {
                    eprintln!("server_error: writer_lease_lost");
                    std::process::exit(1);
                }
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });
        let background = app.clone();
        tokio::spawn(async move {
            while !state_cancel.load(Ordering::Relaxed) {
                {
                    let _guard = background.notification_sync.lock().await;
                    if parse_command_server::notifications::sync(
                        &background.private.state,
                        &background.custody,
                    )
                    .await
                    .is_err()
                    {
                        eprintln!("notification_error: retry_pending");
                    }
                }
                if background.private.state.cleanup().await.is_err() {
                    eprintln!("state_cleanup_error: retry_pending");
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });
        let routes = parse_command_server::http::router(app);
        let listener = tokio::net::TcpListener::bind(listen)
            .await
            .map_err(|_| Error::config("HTTP listener unavailable"))?;
        axum::serve(listener, routes)
            .with_graceful_shutdown(async {
                shutdown().await;
            })
            .await
            .map_err(|_| Error::unavailable())
    });
    cancelled.store(true, Ordering::Relaxed);
    let _ = intake_thread.join();
    let _ = publish_thread.join();
    result?;
    Ok(())
}
async fn shutdown() {
    #[cfg(unix)]
    {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! {_=tokio::signal::ctrl_c()=>{},_=signal.recv()=>{}}
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
