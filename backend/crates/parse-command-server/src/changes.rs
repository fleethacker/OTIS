//! Turnover evidence uses source issue time, separate from first availability time.
use crate::{Error, Result, api::App, private::text};
use axum::{Json, extract::State, http::HeaderMap};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
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
pub fn read_entries(
    entries: &[Value],
    request: &Request,
    scope: &crate::station::ResolvedScope,
) -> Result<Value> {
    request.filters.validate()?;
    let start = bound(&request.since)?;
    let end = bound(&request.until)?;
    if end <= start || end.signed_duration_since(start) > chrono::Duration::days(42) {
        return Err(Error::invalid(
            "Watch window must be positive and at most 42 days",
        ));
    }
    let high = entries
        .iter()
        .filter_map(|e| e["sequence"].as_i64())
        .max()
        .unwrap_or(0);
    let watermark = request.watermark.unwrap_or(high);
    if watermark < 0 || watermark > high || request.before.is_some_and(|b| b <= 0 || b > watermark)
    {
        return Err(Error::invalid("Invalid watch cursor; refresh the watch"));
    }
    let mut bodies: BTreeMap<String, Value> = BTreeMap::new();
    for e in entries {
        if e["sequence"].as_i64().is_some_and(|n| n <= watermark) {
            let entry = bodies
                .entry(text(&e["core"], "id").into())
                .or_insert_with(|| e.clone());
            if e["sequence"].as_i64() < entry["sequence"].as_i64() {
                *entry = e.clone();
            }
        }
    }
    let mut dated = Vec::new();
    let mut unknown = Vec::new();
    for e in bodies.into_values() {
        let c = &e["core"];
        if !scope.matches(c)? {
            continue;
        }
        let sequence = e["sequence"].as_i64().ok_or_else(Error::unavailable)?;
        let ids = c["command_ids"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect::<Vec<_>>();
        let issued = c["issued_at"]
            .as_str()
            .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
            .map(|v| v.with_timezone(&Utc));
        let item = Change {
            id: text(c, "id").into(),
            message_key: e["messageKey"].as_str().map(str::to_owned),
            receipt_id: None,
            sequence: Some(sequence),
            title: text(c, "subject").into(),
            command_ids: ids,
            issued_at: issued.map(|v| v.to_rfc3339_opts(SecondsFormat::Millis, true)),
            recorded_at: e["availableAt"].as_str().map(str::to_owned),
            basis: if issued.is_some() {
                "source_issue_time"
            } else {
                "issue_time_unavailable"
            },
        };
        if let Some(at) = issued {
            if at >= start && at < end && request.before.is_none_or(|b| sequence < b) {
                dated.push(item)
            }
        } else {
            unknown.push(item)
        }
    }
    dated.sort_by_key(|r| std::cmp::Reverse(r.sequence));
    let more = dated.len() > PAGE;
    dated.truncate(PAGE);
    let next = if more {
        dated.last().and_then(|r| r.sequence)
    } else {
        None
    };
    let returned = dated.len();
    let mut hidden = 0;
    let mut hidden_ships = BTreeSet::new();
    dated.retain(|r| {
        let visible = request.filters.matches(&r.command_ids);
        if !visible {
            hidden += 1;
            if r.command_ids.is_empty() {
                hidden_ships.insert("unassigned:".to_owned());
            } else {
                hidden_ships.extend(r.command_ids.iter().map(|id| format!("unit:{id}")));
            }
        }
        visible
    });
    dated.sort_by(|a, b| {
        b.issued_at
            .cmp(&a.issued_at)
            .then(b.sequence.cmp(&a.sequence))
    });
    let unknown_limited = unknown.len() > 50;
    unknown.truncate(50);
    let unknown_hidden = unknown
        .iter()
        .filter(|r| !request.filters.matches(&r.command_ids))
        .count();
    unknown.retain(|r| request.filters.matches(&r.command_ids));
    Ok(
        json!({"items":dated,"unknownTime":unknown,"unknownHiddenCount":unknown_hidden,"unknownLimited":unknown_limited,"returnedNewCount":returned,"hiddenCount":hidden,"hiddenShipIds":hidden_ships,"nextBefore":next,"watermark":watermark,"since":start.to_rfc3339_opts(SecondsFormat::Millis,true),"until":end.to_rfc3339_opts(SecondsFormat::Millis,true),"availability":{"newRecords":"available","amended":"not_available","cancelled":"not_available","reviewTransitions":"not_available"},"scope":"Published messages by source issue time (DTG); counts cover returned pages only. Messages without an issue time are listed separately."}),
    )
}
pub async fn list(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    let scope = crate::station::effective_scope(&app.private, &identity.owner).await?;
    Ok(Json(read_entries(
        &crate::briefing::published(&app.custody).await?,
        &request,
        &scope,
    )?))
}
