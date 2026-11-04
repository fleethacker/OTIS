use crate::{ErrorKind, ParseFailure};
use std::{borrow::Cow, fmt};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}
impl Span {
    pub fn slice(self, source: &str) -> Result<&str, ParseFailure> {
        source
            .get(self.start..self.end)
            .ok_or(ParseFailure::new(ErrorKind::InvalidValue, "source_span"))
    }
}
#[derive(Clone, Copy)]
pub struct FieldView<'a> {
    pub position: usize,
    pub span: Span,
    raw: &'a str,
}
impl<'a> FieldView<'a> {
    pub fn raw(&self) -> &'a str {
        self.raw
    }
    /// Explicit convenience for linear fields; raw bytes and column alignment remain available.
    pub fn normalized(&self) -> Cow<'a, str> {
        let trimmed = self.raw.trim();
        if !trimmed.contains(['\r', '\n', '\t']) {
            Cow::Borrowed(trimmed)
        } else {
            Cow::Owned(trimmed.split_whitespace().collect::<Vec<_>>().join(" "))
        }
    }
}
impl fmt::Debug for FieldView<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FieldView")
            .field("position", &self.position)
            .field("span", &self.span)
            .finish_non_exhaustive()
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SetKind {
    Linear,
    Columnar,
    FreeText,
}
#[derive(Debug)]
pub struct RowView<'a> {
    pub span: Span,
    pub fields: Vec<FieldView<'a>>,
}
#[derive(Debug)]
pub struct RecordView<'a> {
    pub sequence: usize,
    pub set_id: &'a str,
    pub kind: SetKind,
    pub span: Span,
    /// Columnar records store their header here; data rows remain separate.
    pub fields: Vec<FieldView<'a>>,
    pub rows: Vec<RowView<'a>>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScanDiagnostic {
    SetNotOnNewLine { sequence: usize, offset: usize },
}
#[derive(Clone, Copy, Debug)]
pub struct ScanLimits {
    pub max_source_bytes: usize,
    pub max_records: usize,
    pub max_set_bytes: usize,
    pub max_fields_per_record: usize,
    pub max_total_fields: usize,
}
impl ScanLimits {
    pub fn validate(self) -> Result<(), ParseFailure> {
        if [
            self.max_source_bytes,
            self.max_records,
            self.max_set_bytes,
            self.max_fields_per_record,
            self.max_total_fields,
        ]
        .contains(&0)
        {
            return Err(ParseFailure::new(
                ErrorKind::InvalidValue,
                "zero_scan_limit",
            ));
        }
        Ok(())
    }
}
pub struct ScannedMessage<'a> {
    source: &'a str,
    pub records: Vec<RecordView<'a>>,
    pub diagnostics: Vec<ScanDiagnostic>,
    message_type: Cow<'a, str>,
}
impl fmt::Debug for ScannedMessage<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ScannedMessage")
            .field("records", &self.records.len())
            .field("diagnostics", &self.diagnostics)
            .finish_non_exhaustive()
    }
}
impl ScannedMessage<'_> {
    pub fn message_type(&self) -> &str {
        &self.message_type
    }
    pub fn view<'a>(&'a self, subject: Option<&'a str>) -> MessageView<'a> {
        MessageView {
            source: self.source,
            subject,
            message_type: &self.message_type,
            records: &self.records,
        }
    }
}
#[derive(Clone, Copy)]
pub struct MessageView<'a> {
    pub source: &'a str,
    pub subject: Option<&'a str>,
    pub message_type: &'a str,
    pub records: &'a [RecordView<'a>],
}

fn malformed(code: &'static str, at: usize) -> ParseFailure {
    ParseFailure::new(ErrorKind::MalformedInput, code).at(at)
}
fn limit(code: &'static str, at: usize) -> ParseFailure {
    ParseFailure::new(ErrorKind::ResourceLimit, code).at(at)
}
fn free(id: &str) -> bool {
    matches!(id, "GENTEXT" | "AMPN" | "NARR" | "RMKS")
}

struct FieldBudget {
    total: usize,
    current: usize,
    limits: ScanLimits,
}
impl FieldBudget {
    fn field<'a>(
        &mut self,
        source: &'a str,
        start: usize,
        end: usize,
        position: usize,
    ) -> Result<FieldView<'a>, ParseFailure> {
        if self.current >= self.limits.max_fields_per_record
            || self.total >= self.limits.max_total_fields
        {
            return Err(limit("field_count", start));
        }
        self.current += 1;
        self.total += 1;
        let span = Span { start, end };
        let raw = span.slice(source)?;
        if raw.trim().is_empty() {
            return Err(malformed("empty_field", start));
        }
        Ok(FieldView {
            position,
            span,
            raw,
        })
    }
    fn split<'a>(
        &mut self,
        source: &'a str,
        start: usize,
        end: usize,
    ) -> Result<Vec<FieldView<'a>>, ParseFailure> {
        let mut result = Vec::new();
        let mut field_start = start;
        for (offset, b) in source.as_bytes()[start..end].iter().enumerate() {
            if *b == b'/' {
                result.push(self.field(source, field_start, start + offset, result.len() + 1)?);
                field_start = start + offset + 1;
            }
        }
        result.push(self.field(source, field_start, end, result.len() + 1)?);
        Ok(result)
    }
}

pub fn scan(source: &str, limits: ScanLimits) -> Result<ScannedMessage<'_>, ParseFailure> {
    limits.validate()?;
    if source.len() > limits.max_source_bytes {
        return Err(limit("source_bytes", 0));
    }
    let bytes = source.as_bytes();
    let mut pos = 0;
    let mut records = Vec::new();
    let mut diagnostics = Vec::new();
    let mut fields = FieldBudget {
        total: 0,
        current: 0,
        limits,
    };
    while pos < bytes.len() {
        while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if pos == bytes.len() {
            break;
        }
        let start = pos;
        if records.len() >= limits.max_records {
            return Err(limit("record_count", start));
        }
        while pos < bytes.len() && bytes[pos].is_ascii_alphanumeric() {
            if bytes[pos].is_ascii_lowercase() {
                return Err(malformed("set_identifier", pos));
            }
            pos += 1;
            if pos - start > 8 {
                return Err(malformed("set_identifier_length", start));
            }
        }
        if pos - start < 3 {
            return Err(malformed("set_identifier_length", start));
        }
        let set_id = &source[start..pos];
        let kind = if bytes[start].is_ascii_digit() {
            SetKind::Columnar
        } else if free(set_id) {
            SetKind::FreeText
        } else {
            SetKind::Linear
        };
        let identifier_end = pos;
        while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }
        // Empty sets are preserved. Whether permitted is a message-profile decision.
        if bytes.get(pos) != Some(&b'/') {
            return Err(malformed("missing_field_marker", pos));
        }
        let marker = pos;
        let mut slash_count = 0;
        let mut in_free = false;
        let stop;
        loop {
            if pos - start >= limits.max_set_bytes {
                return Err(limit("set_bytes", start));
            }
            if pos + 1 >= bytes.len() {
                return Err(malformed("unterminated_set", start));
            }
            if bytes[pos] == b'/' && bytes[pos + 1] == b'/' {
                if in_free && pos > 0 && bytes[pos - 1] == b':' {
                    pos += 2;
                    continue;
                }
                stop = pos;
                pos += 2;
                break;
            }
            if bytes[pos] == b'/' && !in_free {
                slash_count += 1;
                if kind == SetKind::FreeText
                    && slash_count == if set_id == "GENTEXT" { 2 } else { 1 }
                {
                    in_free = true;
                }
            }
            pos += 1;
        }
        if pos - start > limits.max_set_bytes {
            return Err(limit("set_bytes", start));
        }
        let sequence = records.len() + 1;
        let prior_end = records.last().map_or(0, |r: &RecordView<'_>| r.span.end);
        if prior_end > 0
            && !bytes[prior_end..start]
                .iter()
                .any(|b| *b == b'\n' || *b == b'\r')
        {
            diagnostics.push(ScanDiagnostic::SetNotOnNewLine {
                sequence,
                offset: start,
            });
        }
        fields.current = 0;
        let mut record = RecordView {
            sequence,
            set_id,
            kind,
            span: Span { start, end: pos },
            fields: Vec::new(),
            rows: Vec::new(),
        };
        if marker == stop {
            records.push(record);
            continue;
        }
        if kind == SetKind::Columnar {
            if !source[identifier_end..marker].contains(['\n', '\r']) {
                return Err(malformed("column_header_line", marker));
            }
            let content = &source[marker..stop];
            let mut offset = marker;
            for line in content.split_inclusive('\n') {
                let without_break = line.trim_end_matches(['\n', '\r']);
                if without_break.trim().is_empty() {
                    offset += line.len();
                    continue;
                }
                if !without_break.starts_with('/') {
                    return Err(malformed("column_row", offset));
                }
                let row_fields = fields.split(source, offset + 1, offset + without_break.len())?;
                if record.fields.is_empty() {
                    record.fields = row_fields;
                } else {
                    record.rows.push(RowView {
                        span: Span {
                            start: offset,
                            end: offset + without_break.len(),
                        },
                        fields: row_fields,
                    });
                }
                offset += line.len();
            }
        } else if kind == SetKind::FreeText {
            let begin = marker + 1;
            if set_id == "GENTEXT" {
                let split = source[begin..stop]
                    .find('/')
                    .ok_or(malformed("gentext_body", begin))?
                    + begin;
                record.fields.push(fields.field(source, begin, split, 1)?);
                record
                    .fields
                    .push(fields.field(source, split + 1, stop, 2)?);
            } else {
                record.fields.push(fields.field(source, begin, stop, 1)?);
            }
        } else {
            record.fields = fields.split(source, marker + 1, stop)?;
        }
        records.push(record);
    }
    let mut ids = records.iter().filter(|r| r.set_id == "MSGID");
    let id = ids.next().ok_or(malformed("missing_msgid", 0))?;
    if ids.next().is_some() {
        return Err(malformed("multiple_messages", 0));
    }
    let message_type = id
        .fields
        .first()
        .ok_or(malformed("missing_message_type", id.span.start))?
        .normalized();
    // The normalized type either borrows source or owns only that one small field.
    Ok(ScannedMessage {
        source,
        records,
        diagnostics,
        message_type,
    })
}
