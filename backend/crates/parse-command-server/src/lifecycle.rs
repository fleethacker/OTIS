use crate::{
    Error, Result,
    private::{text, timestamp},
};
use parse_command_state::Store;
use serde_json::{Value, json};

fn entry(id: String, milestone: &str, at: &str, detail: &str) -> Result<Value> {
    Ok(
        json!({"id":id,"milestone":milestone,"recordedAt":timestamp(at)?,"detail":detail,"provenance":"custody"}),
    )
}
pub async fn read(store: &Store, id: &str, revision: &str) -> Result<Value> {
    let key = format!("{id}@{revision}");
    let mut entries = Vec::new();
    let mut limited = false;
    for kind in ["custody_event", "publication_event"] {
        let docs = store
            .list(kind, vec![json!({"term":{"source":key}})], 501)
            .await?;
        limited |= docs.len() > 500;
        for doc in docs.into_iter().take(500) {
            let row = doc.record;
            let state = row.state.as_str();
            let at = text(&row.payload, "at");
            let (milestone, detail) = if kind == "custody_event" {
                match state {
                    "staged" => ("ingested", ""),
                    "parsed" => ("parsed", ""),
                    "duplicate" => ("received_again", ""),
                    "quarantined" | "unsupported" | "retrying" | "fetch_failed" | "rejected" => {
                        ("ingest_failed", text(&row.payload, "code"))
                    }
                    _ => continue,
                }
            } else if state == "publication_succeeded" {
                continue;
            } else {
                (
                    "ingest_failed",
                    match row.category.as_str() {
                        "message" => "Message indexing failed",
                        "passage" => "Search indexing failed",
                        "enrich" => "Embedding failed",
                        "audit" => "Audit storage failed",
                        _ => "Publication failed",
                    },
                )
            };
            entries.push(entry(
                format!("{kind}-{}", row.order),
                milestone,
                at,
                detail,
            )?);
        }
    }
    if let Some(job) = store
        .get("publication", &format!("message:{id}:{revision}"))
        .await?
        && job.record.state == "published"
    {
        entries.push(entry(
            "indexed".into(),
            "indexed",
            job.record.payload["published_at"]
                .as_str()
                .ok_or_else(Error::unavailable)?,
            "",
        )?);
    }
    entries.sort_by(|a, b| {
        text(a, "recordedAt")
            .cmp(text(b, "recordedAt"))
            .then_with(|| text(a, "id").cmp(text(b, "id")))
    });
    Ok(json!({"entries":entries,"limited":limited}))
}
