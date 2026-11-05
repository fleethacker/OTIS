//! Demo-only calendar writes; no mail or scheduling messages are sent.
use crate::{Error, Result, api::App, config::DemoCalendar};
use axum::{
    Json,
    body::to_bytes,
    extract::{Request, State},
    http::HeaderMap,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, sync::Arc, time::Duration};

pub const MAX_BODY: usize = 2 * 1024 * 1024;
const MAX_EVENTS: usize = 500;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SyncRequest {
    ics: String,
}
#[derive(Debug, Serialize)]
pub struct SyncReply {
    pub synced: usize,
    pub created: usize,
    pub updated: usize,
    pub calendar: String,
}
#[derive(Debug)]
pub struct CalendarObject {
    pub name: String,
    pub ics: String,
}

pub fn safe_name(uid: &str) -> String {
    format!("{:x}.ics", Sha256::digest(uid.as_bytes()))
}
fn invalid() -> Error {
    Error::invalid("Expected a VCALENDAR with unique VEVENT UIDs and at most 500 events")
}
fn unavailable() -> Error {
    Error::new("calendar_unavailable", "Mailbox calendar unavailable; some events may have synced. Retry safely.")
}
fn uid_text(raw: &str) -> Result<String> {
    let mut text = String::new();
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some(c @ ('\\' | ',' | ';')) => text.push(c),
                _ => return Err(invalid()),
            }
        } else {
            text.push(c);
        }
    }
    if text.trim().is_empty() || text.chars().any(char::is_control) {
        return Err(invalid());
    }
    Ok(text)
}
fn fold(line: &str, output: &mut String) {
    let mut width = 0;
    for c in line.chars() {
        if width + c.len_utf8() > 75 {
            output.push_str("\r\n ");
            width = 1;
        }
        output.push(c);
        width += c.len_utf8();
    }
    output.push_str("\r\n");
}

/// Unfold before parsing; reject nested components, scheduling envelopes and
/// duplicate UIDs. Each stored object is a standalone calendar, never a collection PUT.
pub fn split_calendar(ics: &str) -> Result<Vec<CalendarObject>> {
    if ics.len() > MAX_BODY || ics.contains('\0') {
        return Err(invalid());
    }
    let normalized = ics.replace("\r\n", "\n");
    if normalized.contains('\r') {
        return Err(invalid());
    }
    let mut lines: Vec<String> = Vec::new();
    for line in normalized.trim_end_matches('\n').split('\n') {
        if line.starts_with([' ', '\t']) {
            lines.last_mut().ok_or_else(invalid)?.push_str(&line[1..]);
        } else {
            lines.push(line.to_owned());
        }
    }
    if lines.first().map(String::as_str) != Some("BEGIN:VCALENDAR")
        || lines.last().map(String::as_str) != Some("END:VCALENDAR")
    {
        return Err(invalid());
    }
    let mut version = false;
    let mut current: Option<Vec<String>> = None;
    let mut uid: Option<String> = None;
    let mut seen = HashSet::new();
    let mut objects = Vec::new();
    for line in &lines[1..lines.len() - 1] {
        match line.as_str() {
            "BEGIN:VEVENT" if current.is_none() && objects.len() < MAX_EVENTS => {
                current = Some(vec![line.clone()]);
                uid = None;
            }
            "END:VEVENT" if current.is_some() => {
                let uid = uid.take().ok_or_else(invalid)?;
                if !seen.insert(uid.clone()) {
                    return Err(invalid());
                }
                let mut event = current.take().ok_or_else(invalid)?;
                event.push(line.clone());
                let mut output = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//OTIS//Mailbox Calendar//EN\r\nCALSCALE:GREGORIAN\r\n".to_owned();
                for property in event {
                    fold(&property, &mut output);
                }
                output.push_str("END:VCALENDAR\r\n");
                objects.push(CalendarObject { name: safe_name(&uid), ics: output });
            }
            _ => {
                let (property, value) = line.split_once(':').ok_or_else(invalid)?;
                let name = property.split(';').next().ok_or_else(invalid)?;
                if name.is_empty() || !name.bytes().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'-')
                    || matches!(name, "BEGIN" | "END" | "METHOD") || line.chars().any(|c| c.is_control())
                {
                    return Err(invalid());
                }
                if let Some(event) = &mut current {
                    if name == "UID" {
                        if uid.is_some() || property != "UID" {
                            return Err(invalid());
                        }
                        uid = Some(uid_text(value)?);
                    }
                    event.push(line.clone());
                } else {
                    match (property, value) {
                        ("VERSION", "2.0") if !version => version = true,
                        ("PRODID" | "CALSCALE", _) => (),
                        _ => return Err(invalid()),
                    }
                }
            }
        }
    }
    if !version || current.is_some() || objects.is_empty() {
        return Err(invalid());
    }
    Ok(objects)
}

pub async fn handle(State(app): State<Arc<App>>, headers: HeaderMap, request: Request) -> Result<Json<SyncReply>> {
    let config = app.config.demo_calendar.as_ref().ok_or_else(|| Error::new("not_found", "Direct calendar sync is not configured"))?;
    app.headers_identity(&headers).await?;
    if headers.get("content-type").and_then(|v| v.to_str().ok()).and_then(|v| v.split(';').next()) != Some("application/json") {
        return Err(Error::invalid("Expected application/json"));
    }
    let bytes = to_bytes(request.into_body(), MAX_BODY).await
        .map_err(|_| Error::new("payload_too_large", "Calendar request exceeds 2 MiB"))?;
    Ok(Json(sync_calendar(config, decode_request(&bytes)?).await?))
}

pub fn decode_request(bytes: &[u8]) -> Result<Vec<CalendarObject>> {
    if bytes.len() > MAX_BODY {
        return Err(Error::new("payload_too_large", "Calendar request exceeds 2 MiB"));
    }
    let request: SyncRequest = serde_json::from_slice(bytes).map_err(|_| Error::invalid("Expected only an ics string"))?;
    split_calendar(&request.ics)
}

async fn ensure_collection(client: &reqwest::Client, config: &DemoCalendar) -> Result<()> {
    let probe = || client.request(reqwest::Method::from_bytes(b"PROPFIND").expect("static method"), config.url.clone())
        .basic_auth(&config.user, Some(&config.password)).header("Depth", "0");
    let response = probe().send().await.map_err(|_| unavailable())?;
    if response.status().is_success() {
        return Ok(());
    }
    if response.status() != reqwest::StatusCode::NOT_FOUND {
        return Err(unavailable());
    }
    let status = client.request(reqwest::Method::from_bytes(b"MKCALENDAR").expect("static method"), config.url.clone())
        .basic_auth(&config.user, Some(&config.password))
        .header("Content-Type", "application/xml; charset=utf-8")
        .body("<?xml version=\"1.0\"?><c:mkcalendar xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:set><d:prop><d:displayname>OTIS</d:displayname><c:supported-calendar-component-set><c:comp name=\"VEVENT\"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>")
        .send().await.map_err(|_| unavailable())?.status();
    // Another request may have created it between PROPFIND and MKCALENDAR.
    if status.is_success() || probe().send().await.map_err(|_| unavailable())?.status().is_success() {
        Ok(())
    } else {
        Err(unavailable())
    }
}

pub async fn sync_calendar(config: &DemoCalendar, objects: Vec<CalendarObject>) -> Result<SyncReply> {
    let client = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2)).timeout(Duration::from_secs(5))
        .build().map_err(|_| unavailable())?;
    let work = async {
        ensure_collection(&client, config).await?;
        let mut reply = SyncReply { synced: 0, created: 0, updated: 0, calendar: format!("{} · OTIS", config.user) };
        let mut pending = objects.into_iter();
        loop {
            let mut batch = tokio::task::JoinSet::new();
            for object in pending.by_ref().take(8) {
                let client = client.clone();
                let config = config.clone();
                batch.spawn(async move {
                    let url = config.url.join(&object.name).map_err(|_| unavailable())?;
                    client.put(url).basic_auth(&config.user, Some(&config.password))
                        .header("Content-Type", "text/calendar; charset=utf-8").body(object.ics)
                        .send().await.map(|r| r.status()).map_err(|_| unavailable())
                });
            }
            if batch.is_empty() { break; }
            while let Some(result) = batch.join_next().await {
                match result.map_err(|_| unavailable())?? {
                    reqwest::StatusCode::CREATED => reply.created += 1,
                    reqwest::StatusCode::OK | reqwest::StatusCode::NO_CONTENT => reply.updated += 1,
                    _ => return Err(unavailable()),
                }
                reply.synced += 1;
            }
        }
        Ok(reply)
    };
    tokio::time::timeout(Duration::from_secs(30), work).await.map_err(|_| unavailable())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn calendar(events: &str) -> String { format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{events}END:VCALENDAR\r\n") }
    fn event(uid: &str) -> String { format!("BEGIN:VEVENT\r\nUID:{uid}\r\nDTSTART:20261105T080000Z\r\nDTEND:20261105T083000Z\r\nSUMMARY:Fictional check\r\nEND:VEVENT\r\n") }
    #[test]
    fn splits_unfolds_and_names_by_decoded_uid() {
        let objects = split_calendar(&calendar(&(event("abc") + &event("demo\\,\r\n second")))).unwrap();
        assert_eq!(objects.len(), 2);
        assert_eq!(objects[0].name, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.ics");
        assert_eq!(objects[1].name, safe_name("demo,second"));
        for object in objects {
            assert!(object.ics.starts_with("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
            assert_eq!(object.ics.matches("BEGIN:VEVENT").count(), 1);
            assert!(object.ics.ends_with("END:VEVENT\r\nEND:VCALENDAR\r\n"));
            assert!(!object.ics.replace("\r\n", "").contains('\n'));
        }
        let name = safe_name("../../outside?query#fragment");
        assert_eq!(name.len(), 68);
        assert!(name[..64].bytes().all(|c| c.is_ascii_hexdigit()));
    }
    #[test]
    fn rejects_invalid_components_ids_and_bounds() {
        for input in [
            String::new(), calendar(""), calendar(&event("")), calendar(&(event("same") + &event("same"))),
            calendar(&event("a").replace("UID:a\r\n", "")),
            calendar(&event("a").replace("UID:a", "UID:a\r\nUID:b")),
            calendar(&event("a").replace("END:VEVENT", "BEGIN:VALARM\r\nEND:VALARM\r\nEND:VEVENT")),
            calendar("BEGIN:VTODO\r\nUID:a\r\nEND:VTODO\r\n"),
            calendar(&event("a")).replace("VERSION:2.0", "METHOD:REQUEST"),
            calendar(&event("a")).replace("END:VEVENT\r\n", ""),
            calendar(&event("a")) + "trailing",
            calendar(&event("a\\nUID:b")),
            "x".repeat(MAX_BODY + 1),
        ] { assert!(split_calendar(&input).is_err()); }
        let events: String = (0..500).map(|i| event(&format!("demo-{i}"))).collect();
        assert_eq!(split_calendar(&calendar(&events)).unwrap().len(), 500);
        assert!(split_calendar(&calendar(&(events + &event("overflow")))).is_err());
        assert!(decode_request(br#"{"ics":"","extra":true}"#).is_err());
        assert!(decode_request(br#"{"ics":5}"#).is_err());
        assert_eq!(decode_request(&vec![b'x'; MAX_BODY + 1]).unwrap_err().code, "payload_too_large");
    }
    #[test]
    fn refolding_preserves_utf8_and_limits_octets() {
        let input = calendar(&event("a").replace("Fictional check", &"航é🛟".repeat(60)));
        let output = &split_calendar(&input).unwrap()[0].ics;
        assert!(output.split("\r\n").all(|line| line.len() <= 75));
        assert!(output.replace("\r\n ", "").contains(&"航é🛟".repeat(60)));
    }
}
