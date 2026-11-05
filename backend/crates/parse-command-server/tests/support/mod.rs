#![allow(dead_code)]
use parse_command_server::{
    api::App, auth, config::Config, private::Private, publisher::Status, search::Search,
};
use parse_command_state::Store;
use std::sync::{Arc, atomic::AtomicBool};
static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub async fn store() -> Store {
    let endpoint = std::env::var("PARSE_COMMAND_TEST_OPENSEARCH_URL")
        .expect("Set isolated OpenSearch test endpoint");
    let index = format!(
        ".parse-command-test-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    let store = Store::new(&endpoint, &index).unwrap();
    store.provision().await.unwrap();
    store
}
pub async fn cleanup(store: &Store) {
    store
        .request(
            reqwest::Method::DELETE,
            &format!("/{}", store.index()),
            None,
        )
        .await
        .unwrap();
}
pub fn auth_config() -> auth::Config {
    auth::Config {
        mode: "local_demo".into(),
        public_url: "http://127.0.0.1:8080".into(),
        issuer: String::new(),
        client_id: String::new(),
        client_secret: String::new(),
        ca: None,
        key: None,
        admin_group: "/Parse Command/Admin".into(),
        viewer_group: "/Parse Command/Viewer".into(),
    }
}
pub async fn app() -> Arc<App> {
    app_with_demo(false).await
}
/// `demo` is the Watch Desk demo flag (`PARSE_COMMAND_WATCHDESK_DEMO`).
pub async fn app_with_demo(demo: bool) -> Arc<App> {
    let state = store().await;
    parse_command_server::settings::bootstrap(&state)
        .await
        .unwrap();
    let mut intake = parse_command_intake::config::Config::load(std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../config/demo-compose-intake.json"
    )))
    .unwrap();
    intake.demo_fixture_assignments = demo;
    let config = Config {
        intake,
        search: std::env::var("PARSE_COMMAND_TEST_OPENSEARCH_URL").unwrap(),
        state_index: state.index().into(),
        auth: auth_config(),
        tokenizer: "unused".into(),
        tokenizer_hash: String::new(),
        listen: "127.0.0.1:0".into(),
        auto_role: Some("viewer".into()),
        allow_fixtures: false,
        demo_calendar: None,
    };
    Arc::new(App {
        search: Search::new(config.search.clone()).unwrap(),
        auth: auth::Auth::new(config.auth.clone(), state.clone()).unwrap(),
        config,
        private: Private::new(state.clone()),
        custody: state,
        notification_sync: Arc::new(tokio::sync::Mutex::new(())),
        status: Status {
            ready: Arc::new(AtomicBool::new(false)),
            model: Arc::new(AtomicBool::new(false)),
        },
        inference: Arc::new(tokio::sync::Semaphore::new(1)),
    })
}
/// App whose state endpoints are unreachable: only checks that fail before any
/// state read can pass.
pub fn offline_app(demo: bool) -> Arc<App> {
    let mut intake = parse_command_intake::config::Config::load(std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../config/demo-compose-intake.json"
    )))
    .unwrap();
    assert!(!intake.demo_fixture_assignments);
    intake.demo_fixture_assignments = demo;
    let state =
        parse_command_state::Store::new("http://127.0.0.1:9", ".parse-command-offline").unwrap();
    let config = Config {
        intake,
        search: "http://127.0.0.1:9".into(),
        state_index: state.index().into(),
        auth: auth_config(),
        tokenizer: "unused".into(),
        tokenizer_hash: String::new(),
        listen: "127.0.0.1:0".into(),
        auto_role: None,
        allow_fixtures: false,
        demo_calendar: None,
    };
    Arc::new(App {
        search: Search::new(config.search.clone()).unwrap(),
        auth: auth::Auth::new(config.auth.clone(), state.clone()).unwrap(),
        config,
        private: Private::new(state.clone()),
        custody: state,
        notification_sync: Arc::new(tokio::sync::Mutex::new(())),
        status: Status {
            ready: Arc::new(AtomicBool::new(false)),
            model: Arc::new(AtomicBool::new(false)),
        },
        inference: Arc::new(tokio::sync::Semaphore::new(1)),
    })
}
