use crate::{IntakeError, Result, config::MimeLimits};
use mailparse::{MailHeader, MailHeaderMap};
use serde_json::{Value, json};
pub struct Email {
    pub body: String,
    pub subject: Option<String>,
    pub metadata: Value,
}
fn headers<'a>(raw: &'a [u8], l: MimeLimits) -> Result<(Vec<MailHeader<'a>>, usize)> {
    let stop = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|n| n + 4)
        .or_else(|| raw.windows(2).position(|w| w == b"\n\n").map(|n| n + 2))
        .ok_or(IntakeError("mime_header_boundary"))?;
    if stop > l.max_header_bytes {
        return Err(IntakeError("mime_header_limit"));
    }
    let (h, n) = mailparse::parse_headers(&raw[..stop]).map_err(|_| IntakeError("mime_headers"))?;
    if h.len() > l.max_headers {
        return Err(IntakeError("mime_header_count"));
    }
    for key in [
        "Content-Type",
        "Content-Transfer-Encoding",
        "Content-Disposition",
        "Subject",
    ] {
        if h.get_all_headers(key).len() > 1 {
            return Err(IntakeError("mime_duplicate_header"));
        }
    }
    Ok((h, n))
}
pub fn decode(raw: &[u8], limits: MimeLimits) -> Result<Email> {
    let (h, n) = headers(raw, limits)?;
    let subject = h.get_first_value("Subject");
    let mut parts = 0;
    let mut candidates = Vec::new();
    walk(raw, 0, 0, limits, &mut parts, &mut candidates)?;
    if candidates.len() != 1 {
        return Err(IntakeError("mime_plain_body_count"));
    }
    let (body, provenance) = candidates.pop().ok_or(IntakeError("mime_plain_body"))?;
    if !["MSGID/", "EXER/", "OPER/"]
        .iter()
        .any(|prefix| body.starts_with(prefix))
    {
        return Err(IntakeError("mime_usmtf_framing"));
    }
    use base64::Engine;
    let metadata = json!({"decoded_subject":subject,"message_id":h.get_first_value("Message-ID"),"from":h.get_first_value("From"),
        "date":h.get_first_value("Date"),"header_base64":base64::engine::general_purpose::STANDARD.encode(&raw[..n]),"selected_body":provenance,"parts_examined":parts});
    Ok(Email {
        body,
        subject,
        metadata,
    })
}
fn walk(
    raw: &[u8],
    offset: usize,
    depth: usize,
    l: MimeLimits,
    parts: &mut usize,
    candidates: &mut Vec<(String, Value)>,
) -> Result<()> {
    *parts += 1;
    if *parts > l.max_parts || depth > l.max_depth {
        return Err(IntakeError("mime_structure_limit"));
    }
    let (h, n) = headers(raw, l)?;
    let content = mailparse::parse_content_type(
        &h.get_first_value("Content-Type")
            .unwrap_or_else(|| "text/plain; charset=us-ascii".into()),
    );
    let disposition = h.get_first_value("Content-Disposition").unwrap_or_default();
    if disposition
        .split(';')
        .next()
        .is_some_and(|s| s.trim().eq_ignore_ascii_case("attachment"))
    {
        return Ok(());
    }
    if content.mimetype.starts_with("multipart/") {
        if !matches!(
            content.mimetype.as_str(),
            "multipart/mixed" | "multipart/alternative" | "multipart/related"
        ) {
            return Err(IntakeError("mime_multipart_type"));
        }
        let boundary = content
            .params
            .get("boundary")
            .filter(|s| !s.is_empty() && s.len() <= 70 && s.is_ascii())
            .ok_or(IntakeError("mime_boundary"))?;
        let marker = format!("--{boundary}");
        let closing = format!("--{boundary}--");
        let body = &raw[n..];
        let mut cursor = 0;
        let mut start = None;
        let mut closed = false;
        for line in body.split_inclusive(|b| *b == b'\n') {
            let trimmed = line.strip_suffix(b"\n").unwrap_or(line);
            let trimmed = trimmed.strip_suffix(b"\r").unwrap_or(trimmed);
            let trimmed = trimmed.trim_ascii_end();
            if trimmed == marker.as_bytes() || trimmed == closing.as_bytes() {
                if let Some(s) = start.take() {
                    let mut end = cursor;
                    // MIME boundary owns the preceding CRLF; it is not payload data.
                    if end >= 2 && &body[end - 2..end] == b"\r\n" {
                        end -= 2;
                    } else if end >= 1 && body[end - 1] == b'\n' {
                        end -= 1;
                    }
                    walk(
                        &body[s..end],
                        offset + n + s,
                        depth + 1,
                        l,
                        parts,
                        candidates,
                    )?;
                }
                if trimmed == closing.as_bytes() {
                    closed = true;
                    break;
                }
                start = Some(cursor + line.len());
            }
            cursor += line.len();
        }
        if !closed {
            return Err(IntakeError("mime_unclosed_multipart"));
        }
        return Ok(());
    }
    if content.mimetype != "text/plain" {
        return Ok(());
    }
    if !matches!(
        content.charset.to_ascii_lowercase().as_str(),
        "utf-8" | "us-ascii"
    ) {
        return Err(IntakeError("mime_charset"));
    }
    let transfer = h
        .get_first_value("Content-Transfer-Encoding")
        .unwrap_or_else(|| "7bit".into())
        .to_ascii_lowercase();
    if !matches!(
        transfer.trim(),
        "base64" | "quoted-printable" | "7bit" | "8bit" | "binary"
    ) {
        return Err(IntakeError("mime_transfer_encoding"));
    }
    // Only a verified non-multipart leaf reaches the library's recursive parser.
    let leaf = mailparse::parse_mail(raw).map_err(|_| IntakeError("mime_leaf"))?;
    let bytes = leaf
        .get_body_raw()
        .map_err(|_| IntakeError("mime_transfer_decode"))?;
    if bytes.len() > l.max_decoded_bytes {
        return Err(IntakeError("mime_decoded_limit"));
    }
    if content.charset.eq_ignore_ascii_case("us-ascii") && !bytes.is_ascii() {
        return Err(IntakeError("mime_ascii"));
    }
    let body = String::from_utf8(bytes).map_err(|_| IntakeError("mime_utf8"))?;
    candidates.push((body,json!({"part_start_byte":offset,"encoded_body_start_byte":offset+n,"part_end_byte":offset+raw.len(),"transfer_encoding":transfer,"charset":content.charset,"representation":"decoded_utf8_body"})));
    if candidates.len() > 1 {
        return Err(IntakeError("mime_plain_body_count"));
    }
    Ok(())
}
