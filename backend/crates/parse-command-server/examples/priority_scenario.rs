//! Stage authored synthetic email through the existing durable MIME/parser API.
//! Run before the normal application server. Never accesses IMAP or sends mail.
use base64::Engine;
use parse_command_intake::{config::Config, journal::Receipt, service::Service};
use parse_command_server::work;
use std::{path::Path, sync::atomic::AtomicBool};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: priority_scenario <isolated-intake.json> [--duplicate] [--anchor]")?;
    let flags: Vec<_> = std::env::args().skip(2).collect();
    if flags
        .iter()
        .any(|flag| flag != "--duplicate" && flag != "--anchor")
    {
        return Err("Only optional --duplicate and --anchor are supported".into());
    }
    let duplicate = flags.iter().any(|flag| flag == "--duplicate");
    let config = Config::load(Path::new(&path))?;
    if !config
        .custody_index
        .starts_with(".parse-command-priority-1-")
        || config.revision != "priority-1-demo-v1"
        || !matches!(
            reqwest::Url::parse(&config.opensearch_url)?.host_str(),
            Some("127.0.0.1" | "localhost")
        )
    {
        return Err(
            "Use a dedicated local priority-1 custody index and pinned scenario revision".into(),
        );
    }
    let include_anchor = flags.iter().any(|flag| flag == "--anchor");
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/priority-1");
    let mut service = Service::open(config.clone())?;
    let mut sources: Vec<_> = work::bindings()?
        .into_iter()
        .map(|binding| (directory.clone(), binding))
        .collect();
    if include_anchor {
        let bindings: Vec<work::Binding> =
            serde_json::from_str(include_str!("../../../config/priority-2/sources.json"))?;
        sources.extend(
            bindings
                .into_iter()
                .map(|binding| (directory.with_file_name("priority-2"), binding)),
        );
    }
    for (index, (directory, binding)) in sources.iter().enumerate() {
        let body = std::fs::read(directory.join(&binding.file))?;
        let raw = format!(
            "From: scenario@example.invalid\r\nSubject: SUBJ: Fictional Meridian {}\r\nMessage-ID: <priority-1-{}@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{}\r\n",
            binding.name,
            index,
            base64::engine::general_purpose::STANDARD.encode(&body)
        );
        service.journal.accept(
            &config,
            Receipt {
                validity: 20261110,
                uid: index as u32 + 1 + if duplicate { 100 } else { 0 },
                size: raw.len() as u32,
                raw: Some(raw.as_bytes()),
                state: "staged",
                code: None,
                received_at: "2026-11-10T08:05:00Z",
                server_received_at: Some("2026-11-10T08:04:00Z"),
            },
        )?;
    }
    service.process(&AtomicBool::new(false))?;
    println!("{}", service.journal.status()?);
    service.journal.export(std::io::stdout().lock())?;
    Ok(())
}
