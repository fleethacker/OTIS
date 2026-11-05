//! Read-only turnover evidence, windowed and ordered by source issue time (the message DTG).
//! Receipt time is kept as custody metadata only; it is not when the message was sent.
//! Reads published projections from the OpenSearch custody index.
use crate::{Error, Result, api::App, private::timestamp};
use axum::{Json, extract::State, http::HeaderMap};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
    time::Duration,
};

const PAGE: usize = 200;
#[derive(Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Filters {
    pub command_ids: Vec<String>,
    pub unassigned_only: bool,
    pub no_commands: bool,
}
impl Filters {
    fn matches(&self, ids: &[String]) -> bool {
        !self.no_commands
            && ((self.command_ids.is_empty() && !self.unassigned_only)
                || (self.unassigned_only && ids.is_empty())
                || ids.iter().any(|id| self.command_ids.contains(id)))
    }
    fn validate(&self) -> Result<()> {
        crate::api::Filters {
            command_ids: self.command_ids.clone(),
            unassigned_only: self.unassigned_only,
            no_commands: self.no_commands,
            ..crate::api::Filters::default()
        }
        .validate()?;
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Request {
    pub since: String,
    pub until: String,
    #[serde(default)]
    pub filters: Filters,
    pub before: Option<i64>,
    pub watermark: Option<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub id: String,
    pub message_key: Option<String>,
    pub receipt_id: Option<String>,
    pub sequence: Option<i64>,
    pub title: String,
    pub command_ids: Vec<String>,
    pub issued_at: Option<String>,
    pub recorded_at: Option<String>,
    pub basis: &'static str,
}
fn bound(value: &str) -> Result<DateTime<Utc>> {
    let at = DateTime::parse_from_rfc3339(value)
        .map_err(|_| Error::invalid("Use complete ISO UTC watch bounds"))?
        .with_timezone(&Utc);
    if !value.ends_with('Z')
        || !(1..=9999).contains(&chrono::Datelike::year(&at))
        || at.timestamp_subsec_nanos() >= 1_000_000_000
        || at.timestamp_subsec_nanos() % 1_000_000 != 0
    {
        return Err(Error::invalid(
            "Watch bounds require UTC Z and at most millisecond precision",
        ));
    }
    Ok(at)
}
/// One published custody projection, reduced to the metadata Since last watch needs.
/// `sequence` is the custody receipt order of the projection's selected receipt.
#[derive(Clone)]
pub struct Source {
    pub id: String,
    pub message_key: Option<String>,
    pub receipt_id: Option<String>,
    pub sequence: Option<i64>,
    pub recorded_at: Option<String>,
    pub issued_at: Option<String>,
    pub title: String,
    pub command_ids: Vec<String>,
}
fn change(source: &Source, unknown: bool) -> Result<Change> {
    parse_command_types::validate_hash_id(&source.id, "message_id")
        .map_err(|_| Error::unavailable())?;
    let ids = &source.command_ids;
    if ids.len() > 32 || ids.iter().any(|id| id.is_empty() || id.len() > 256) {
        return Err(Error::unavailable());
    }
    Ok(Change {
        id: source.id.clone(),
        message_key: source.message_key.clone(),
        receipt_id: source.receipt_id.clone(),
        sequence: source.sequence,
        title: source.title.chars().take(256).collect(),
        command_ids: ids.clone(),
        issued_at: if unknown {
            None
        } else {
            Some(timestamp(
                source.issued_at.as_deref().ok_or_else(Error::unavailable)?,
            )?)
        },
        recorded_at: source
            .recorded_at
            .as_deref()
            .and_then(|at| timestamp(at).ok()),
        basis: if unknown {
            "issue_time_unavailable"
        } else {
            "source_issue_time"
        },
    })
}
fn issued(source: &Source) -> Option<DateTime<Utc>> {
    source
        .issued_at
        .as_deref()
        .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|v| v.with_timezone(&Utc))
}
/// Pure window/paging computation over published custody sources. `high` is the
/// current custody receipt watermark.
pub fn compute(sources: &[Source], high: i64, request: &Request) -> Result<Value> {
    request.filters.validate()?;
    let start = bound(&request.since)?;
    let end = bound(&request.until)?;
    if end <= start || end.signed_duration_since(start) > chrono::Duration::days(42) {
        return Err(Error::invalid(
            "Watch window must be positive and at most 42 days",
        ));
    }
    let watermark = request.watermark.unwrap_or(high);
    if watermark < 0 || watermark > high || request.before.is_some_and(|v| v <= 0 || v > watermark)
    {
        return Err(Error::invalid("Invalid custody cursor; refresh the watch"));
    }
    let since = start.to_rfc3339_opts(SecondsFormat::Millis, true);
    let until = end.to_rfc3339_opts(SecondsFormat::Millis, true);
    let current: Vec<&Source> = sources
        .iter()
        .filter(|s| s.sequence.is_none_or(|v| v <= watermark))
        .collect();
    // Exact half-open [since, until) on the source issue time (DTG); the cursor follows receipt order.
    let mut candidates: Vec<&Source> = current
        .iter()
        .copied()
        .filter(|s| issued(s).is_some_and(|at| at >= start && at < end))
        .filter(|s| {
            request
                .before
                .is_none_or(|before| s.sequence.is_some_and(|v| v < before))
        })
        .collect();
    candidates.sort_by(|a, b| b.sequence.cmp(&a.sequence).then(a.id.cmp(&b.id)));
    let more = candidates.len() > PAGE;
    candidates.truncate(PAGE);
    let next = if more {
        candidates.last().and_then(|r| r.sequence)
    } else {
        None
    };
    let mut dated = candidates
        .into_iter()
        .map(|s| change(s, false))
        .collect::<Result<Vec<_>>>()?;
    // Pages follow receipt sequence (stable cursor); within a page, newest sent first.
    dated.sort_by(|a, b| {
        b.issued_at
            .cmp(&a.issued_at)
            .then(b.sequence.cmp(&a.sequence))
    });
    let returned = dated.len();
    let mut hidden = 0usize;
    let mut hidden_ships = BTreeSet::new();
    let mut visible = Vec::new();
    for row in dated {
        if request.filters.matches(&row.command_ids) {
            visible.push(row);
        } else {
            hidden += 1;
            if row.command_ids.is_empty() {
                hidden_ships.insert("unassigned:".to_owned());
            } else {
                hidden_ships.extend(row.command_ids.into_iter().map(|id| format!("unit:{id}")));
            }
        }
    }
    // Unknown evidence has no position within [since,until); keep it outside dated counts.
    let mut unknown: Vec<&Source> = current
        .iter()
        .copied()
        .filter(|s| issued(s).is_none())
        .collect();
    unknown.sort_by(|a, b| a.id.cmp(&b.id));
    let unknown_limited = unknown.len() > 50;
    unknown.truncate(50);
    let mut unknown = unknown
        .into_iter()
        .map(|s| change(s, true))
        .collect::<Result<Vec<_>>>()?;
    let unknown_hidden = unknown
        .iter()
        .filter(|r| !request.filters.matches(&r.command_ids))
        .count();
    unknown.retain(|r| request.filters.matches(&r.command_ids));
    Ok(json!({
        "items":visible,"unknownTime":unknown,"unknownHiddenCount":unknown_hidden,"unknownLimited":unknown_limited,
        "returnedNewCount":returned,"hiddenCount":hidden,"hiddenShipIds":hidden_ships,
        "nextBefore":next,"watermark":watermark,"since":since,"until":until,
        "availability":{"newRecords":"available","amended":"not_available","cancelled":"not_available","reviewTransitions":"not_available"},
        "scope":"Published messages by source issue time (DTG); counts cover returned pages only. Messages without an issue time are listed separately.",
    }))
}
/// Reduce published custody projections to one source per message body. The
/// earliest receipt keeps the message key, so later parser revisions or duplicate
/// receipts never appear as new records.
pub fn sources(docs: &[parse_command_state::Document]) -> Vec<Source> {
    let mut rows: Vec<&parse_command_state::Document> = docs
        .iter()
        .filter(|d| d.record.kind == "projection" && d.record.state == "published")
        .collect();
    rows.sort_by(|a, b| {
        a.record
            .order
            .cmp(&b.record.order)
            .then(a.record.key.cmp(&b.record.key))
    });
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for doc in rows {
        let core = &doc.record.payload["core"];
        let Some(id) = core["id"].as_str() else {
            continue;
        };
        if !seen.insert(id.to_owned()) {
            continue;
        }
        let ids = core["command_ids"]
            .as_array()
            .map(|v| {
                v.iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let title = core["subject"]
            .as_str()
            .or(core["type"].as_str())
            .unwrap_or("Source record");
        out.push(Source {
            id: id.into(),
            message_key: Some(doc.record.key.clone()),
            receipt_id: doc.record.payload["first_receipt"]
                .as_str()
                .map(str::to_owned),
            sequence: (doc.record.order > 0).then_some(doc.record.order),
            recorded_at: doc.record.payload["selected_received_at"]
                .as_str()
                .map(str::to_owned),
            issued_at: core["issued_at"].as_str().map(str::to_owned),
            title: title.into(),
            command_ids: ids,
        });
    }
    out
}
/// Bounded custody read: at most 1000 published projections at or below the watermark.
pub async fn read(store: &parse_command_state::Store, request: &Request) -> Result<Value> {
    let filter = |extra: Vec<Value>| {
        let mut f = vec![
            json!({"term":{"kind":"projection"}}),
            json!({"term":{"state":"published"}}),
        ];
        f.extend(extra);
        json!({"bool":{"filter":f}})
    };
    let stats = store
        .search(json!({"size":0,"query":filter(vec![]),"aggs":{"high":{"max":{"field":"order"}}}}))
        .await?;
    let high = stats["aggregations"]["high"]["value"]
        .as_f64()
        .unwrap_or(0.0)
        .max(0.0) as i64;
    let watermark = request.watermark.unwrap_or(high).clamp(0, high);
    let page = store.search(json!({"size":parse_command_state::MAX_HITS,"query":filter(vec![json!({"range":{"order":{"lte":watermark}}})]),
        "sort":[{"order":"desc"},"key"]})).await?;
    let docs = parse_command_state::hits(&page)?;
    compute(&sources(&docs), high, request)
}
/// Scoped turnover evidence uses the immutable first-publication ledger while
/// preserving the custody window, pagination and timestamp contract.
pub fn read_entries(
    entries: &[Value],
    request: &Request,
    scope: &crate::station::ResolvedScope,
) -> Result<Value> {
    let high = entries
        .iter()
        .filter_map(|e| e["sequence"].as_i64())
        .max()
        .unwrap_or(0);
    let watermark = request.watermark.unwrap_or(high);
    let mut bodies: BTreeMap<&str, &Value> = BTreeMap::new();
    for entry in entries {
        let sequence = entry["sequence"].as_i64().ok_or_else(Error::unavailable)?;
        if sequence > watermark {
            continue;
        }
        let id = entry["core"]["id"]
            .as_str()
            .ok_or_else(Error::unavailable)?;
        let prior = bodies.entry(id).or_insert(entry);
        if sequence < prior["sequence"].as_i64().ok_or_else(Error::unavailable)? {
            *prior = entry;
        }
    }
    let mut sources = Vec::new();
    for entry in bodies.into_values() {
        let core = &entry["core"];
        if !scope.matches(core)? {
            continue;
        }
        let ids = core["command_ids"]
            .as_array()
            .ok_or_else(Error::unavailable)?;
        sources.push(Source {
            id: crate::private::text(core, "id").into(),
            message_key: entry["messageKey"].as_str().map(str::to_owned),
            receipt_id: entry["receiptId"].as_str().map(str::to_owned),
            sequence: entry["sequence"].as_i64(),
            recorded_at: entry["availableAt"].as_str().map(str::to_owned),
            issued_at: core["issued_at"].as_str().map(str::to_owned),
            title: core["subject"]
                .as_str()
                .or_else(|| core["type"].as_str())
                .unwrap_or_default()
                .into(),
            command_ids: ids
                .iter()
                .map(|v| v.as_str().map(str::to_owned).ok_or_else(Error::unavailable))
                .collect::<Result<Vec<_>>>()?,
        });
    }
    compute(&sources, high, request)
}
static CHANGE_READS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
pub async fn list(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    let permit = CHANGE_READS.try_acquire().map_err(|_| {
        Error::new(
            "resource_exhausted",
            "Turnover reads are busy; retry shortly",
        )
    })?;
    let value = tokio::time::timeout(Duration::from_secs(7), async {
        let _permit = permit;
        let scope = crate::station::effective_scope(&app.private, &identity.owner).await?;
        read_entries(
            &crate::briefing::published(&app.custody).await?,
            &request,
            &scope,
        )
    })
    .await
    .map_err(|_| Error::unavailable())??;
    if value.to_string().len() > 2_097_152 {
        return Err(Error::new(
            "resource_exhausted",
            "Turnover response exceeds bound",
        ));
    }
    Ok(Json(value))
}
