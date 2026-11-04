//! Field interpretation only. Never supplies a date, zone or year from the machine clock.
use chrono::NaiveDate;
use parse_command_parser_api::*;
use parse_command_types::*;

#[derive(Clone, Debug)]
pub(crate) struct TimeValue {
    pub at: Option<UtcTimestamp>,
    pub clock: Option<String>,
    pub label: Option<String>,
    pub status: Option<TimeStatus>,
}
fn bad(code: &'static str) -> ParseFailure {
    ParseFailure::new(ErrorKind::InvalidValue, code)
}
fn number(s: &str) -> Result<u32, ParseFailure> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err(bad("time_digits"));
    }
    s.parse().map_err(|_| bad("time_digits"))
}
fn month(s: &str) -> Result<u32, ParseFailure> {
    [
        "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
    ]
    .iter()
    .position(|v| *v == s)
    .map(|n| n as u32 + 1)
    .ok_or(bad("time_month"))
}
pub(crate) fn issue(raw: &str) -> Result<Option<UtcTimestamp>, ParseFailure> {
    if raw == "-"
        || [
            "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
        ]
        .contains(&raw)
    {
        return Ok(None);
    }
    if !raw.is_ascii() || raw.len() != 16 || &raw[8..9] != "T" || !raw.ends_with('Z') {
        return Err(bad("issue_format"));
    }
    UtcTimestamp::new(format!(
        "{}-{}-{}T{}:{}:{}Z",
        &raw[..4],
        &raw[4..6],
        &raw[6..8],
        &raw[9..11],
        &raw[11..13],
        &raw[13..15]
    ))
    .map(Some)
    .map_err(|_| bad("issue_calendar"))
}
pub(crate) fn parse(raw: &str) -> Result<TimeValue, ParseFailure> {
    let unresolved = |status| TimeValue {
        at: None,
        clock: None,
        label: Some(raw.into()),
        status: Some(status),
    };
    match raw {
        "-" => return Ok(unresolved(TimeStatus::NotAvailableWithheldOrInapplicable)),
        "UFN" => return Ok(unresolved(TimeStatus::OpenEnded)),
        "AS REQD" => return Ok(unresolved(TimeStatus::ConditionNotScheduled)),
        _ => {}
    }
    if !raw.is_ascii() {
        return Err(bad("time_ascii"));
    }
    let value = raw
        .strip_prefix("ASOF:")
        .or_else(|| raw.strip_prefix("NLT:"))
        .or_else(|| raw.strip_prefix("TIME:"))
        .unwrap_or(raw);
    let len = value.len();
    if !matches!(len, 4 | 5 | 7 | 8 | 10 | 11 | 14) {
        return Err(bad("time_format"));
    }
    if len == 4 || len == 5 {
        let h = number(&value[..2])?;
        let m = number(&value[2..4])?;
        if h > 23 || m > 59 {
            return Err(bad("time_clock"));
        }
        let zone = if len == 5 {
            Some(value.as_bytes()[4])
        } else {
            None
        };
        if zone.is_some_and(|z| !z.is_ascii_uppercase() || z == b'J') {
            return Err(bad("time_zone"));
        }
        if zone.is_some_and(|z| z != b'Z') {
            return Ok(unresolved(TimeStatus::Unresolved));
        }
        return Ok(TimeValue {
            at: None,
            clock: Some(format!(
                "{h:02}:{m:02}{}",
                if zone.is_some() { "Z" } else { "" }
            )),
            label: None,
            status: Some(if zone.is_some() {
                TimeStatus::MissingDate
            } else {
                TimeStatus::MissingDateAndZone
            }),
        });
    }
    let d = number(&value[..2])?;
    let h = number(&value[2..4])?;
    let m = number(&value[4..6])?;
    if !(1..=31).contains(&d) || h > 23 || m > 59 {
        return Err(bad("time_components"));
    }
    let z = value.as_bytes()[6];
    if !z.is_ascii_uppercase() || z == b'J' {
        return Err(bad("time_zone"));
    }
    let verified = len == 8 || len == 11;
    if verified {
        let checksum = value.as_bytes()[7];
        if !checksum.is_ascii_digit()
            || value.as_bytes()[..6]
                .iter()
                .map(|b| (b - b'0') as u32)
                .sum::<u32>()
                % 10
                != (checksum - b'0') as u32
        {
            return Err(bad("time_checksum"));
        }
    }
    let month_start = if verified { 8 } else { 7 };
    let mon = if len == 10 || len == 11 || len == 14 {
        Some(month(&value[month_start..month_start + 3])?)
    } else {
        None
    };
    let year = if len == 14 {
        Some(number(&value[10..14])? as i32)
    } else {
        None
    };
    if let Some(mon) = mon {
        // A leap year admits February 29 when year is unknown, but never February 30.
        if NaiveDate::from_ymd_opt(year.unwrap_or(2000), mon, d).is_none() {
            return Err(bad("time_calendar"));
        }
    }
    if z != b'Z' {
        return Ok(unresolved(TimeStatus::Unresolved));
    }
    if let (Some(mon), Some(year)) = (mon, year) {
        return Ok(TimeValue {
            at: Some(
                UtcTimestamp::new(format!("{year:04}-{mon:02}-{d:02}T{h:02}:{m:02}:00Z"))
                    .map_err(|_| bad("time_calendar"))?,
            ),
            clock: None,
            label: None,
            status: None,
        });
    }
    Ok(TimeValue {
        at: None,
        clock: Some(format!("{h:02}:{m:02}Z")),
        label: None,
        status: Some(if mon.is_some() {
            TimeStatus::MissingYear
        } else {
            TimeStatus::MissingMonthAndYear
        }),
    })
}
impl TimeValue {
    pub fn apply_activity(self, a: &mut Activity, purpose: &str) {
        match purpose {
            "start" => {
                a.start_at = self.at;
                a.start_time = self.clock;
                a.start_label = self.label;
                a.start_status = self.status;
            }
            "end" => {
                a.end_at = self.at;
                a.end_time = self.clock;
                a.end_label = self.label;
                a.end_status = self.status;
            }
            "as_of" => {
                a.as_of_at = self.at;
                a.as_of_time = self.clock;
                a.as_of_label = self.label;
                a.as_of_status = self.status;
            }
            "deadline" => {
                a.deadline_at = self.at;
                a.deadline_time = self.clock;
                a.deadline_label = self.label;
                a.deadline_status = self.status;
            }
            _ => {
                a.at = self.at;
                a.time = self.clock;
                a.time_label = self.label;
                a.time_status = self.status;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calendar_checksum_and_partial_context() {
        assert_eq!(parse("252310Z3").unwrap().clock.as_deref(), Some("23:10Z"));
        assert!(parse("252310Z2").is_err());
        assert!(parse("252310Z2SEP").is_err());
        assert_eq!(
            parse("252310Z3SEP").unwrap().status,
            Some(TimeStatus::MissingYear)
        );
        assert!(parse("300100ZFEB").is_err());
        assert!(parse("290100ZFEB2025").is_err());
        assert_eq!(
            parse("290100ZFEB2024").unwrap().at.unwrap().as_str(),
            "2024-02-29T01:00:00Z"
        );
        assert_eq!(parse("1200A").unwrap().status, Some(TimeStatus::Unresolved));
        assert!(parse("1200J").is_err());
        assert!(parse("2460Z").is_err());
        assert!(issue("20250230T120000Z").is_err());
        assert_eq!(issue("FEB").unwrap(), None);
    }
}
