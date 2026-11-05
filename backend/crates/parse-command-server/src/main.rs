use axum::{
    extract::{Request, State},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use parse_command_server::{
    Error,
    api::App,
    config::Config,
    private::Private,
    publisher::{Publisher, Status},
    rpc,
    search::Search,
    web,
};
use std::{
    io::{Read, Write},
    sync::{
        Arc, Mutex,
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
    if args.len() == 3 && args[0] == "migrate-private" {
        let db = Private::open(
            std::path::Path::new(&args[2]),
            Some(std::path::Path::new(&args[1])),
        )?;
        let counts: String =
            db.db
                .query_row("SELECT counts FROM migration WHERE id='go-v1'", [], |r| {
                    r.get(0)
                })?;
        println!("Migration validated: {counts}");
        return Ok(());
    }
    if args.len() != 2 || args[0] != "serve" {
        return Err("usage: parse-command-server serve <intake-config.json> | healthcheck".into());
    }
    let config = Config::load(std::path::Path::new(&args[1]))?;
    let mut intake = parse_command_intake::service::Service::open(config.intake.clone())?;
    let private = Private::open(&config.private, config.legacy.as_deref())?;
    let status = Status {
        ready: Arc::new(AtomicBool::new(false)),
        model: Arc::new(AtomicBool::new(false)),
    };
    let publisher = Publisher::open(config.clone(), status.clone())?;
    let cancelled = Arc::new(AtomicBool::new(false));
    let poll_cancel = cancelled.clone();
    let poll_config = config.clone();
    let intake_thread = std::thread::Builder::new()
        .name("imap-intake".into())
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut retry = poll_config.intake.poll_seconds;
                while !poll_cancel.load(Ordering::Relaxed) {
                    let result = (|| {
                        intake.process(&poll_cancel)?;
                        let password =
                            std::env::var(&poll_config.intake.password_env).map_err(|_| {
                                parse_command_intake::IntakeError("password_environment")
                            })?;
                        let poll = intake.poll(&password, &poll_cancel);
                        drop(password);
                        intake.process(&poll_cancel)?;
                        poll
                    })();
                    let delay = if result.is_ok() {
                        retry = poll_config.intake.poll_seconds;
                        retry
                    } else {
                        eprintln!("intake_error: retry_pending");
                        let delay = retry;
                        retry = retry
                            .saturating_mul(2)
                            .min(poll_config.intake.retry_max_seconds);
                        delay
                    };
                    for _ in 0..delay * 5 {
                        if poll_cancel.load(Ordering::Relaxed) {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(200));
                    }
                }
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
    let result = runtime.block_on(async move {
        let app = Arc::new(App {
            search: Search::new(config.search.clone())?,
            config,
            private: Arc::new(Mutex::new(private)),
            status,
            inference: Arc::new(tokio::sync::Semaphore::new(1)),
        });
        let rpc_router = rpc::router(app.clone());
        let rpc_service = rpc_router
            .into_axum_service()
            .with_limits(
                connectrpc::Limits::default()
                    .with_max_message_size(2_097_152)
                    .with_max_request_body_size(131072),
            )
            .with_deadline_policy(
                connectrpc::DeadlinePolicy::new()
                    .with_default_timeout(Duration::from_secs(7))
                    .with_max(Duration::from_secs(10)),
            );
        let routes = axum::Router::new()
            .route("/api/health", get(web::health))
            .route(
                "/api/v1/source/status",
                get(parse_command_server::api::status),
            )
            .route(
                "/api/v1/messages/{operation}",
                post(parse_command_server::api::read),
            )
            .route(
                "/api/v1/notifications/{operation}",
                post(parse_command_server::notifications::handle),
            )
            .route("/__ark/mock-whoami", get(web::whoami))
            .route("/__ark/mock-roles", get(web::roles))
            .route("/__ark/mock-login", get(web::login_page).post(web::login))
            .route("/__ark/mock-logout", get(web::logout))
            .route("/logout", get(web::logout))
            .fallback_service(rpc_service)
            .layer(axum::extract::DefaultBodyLimit::max(131072))
            .with_state(app)
            .layer(middleware::from_fn_with_state(
                Arc::new(tokio::sync::Semaphore::new(8)),
                bounds,
            ));
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
async fn bounds(
    State(limit): State<Arc<tokio::sync::Semaphore>>,
    request: Request,
    next: Next,
) -> Response {
    let Ok(_permit) = limit.try_acquire_owned() else {
        return Error::new(
            "resource_exhausted",
            "Request concurrency bound reached; retry shortly",
        )
        .into_response();
    };
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        "cache-control",
        axum::http::HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        axum::http::HeaderValue::from_static("nosniff"),
    );
    response
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
