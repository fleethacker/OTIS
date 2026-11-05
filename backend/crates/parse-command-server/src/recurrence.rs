//! Bounded Zulu recurrence-rule subset; never derive an anchor from a request or receipt.
use crate::{Error, Result};
use chrono::{DateTime, Datelike, NaiveDateTime, SecondsFormat, Timelike, Utc};
use parse_command_types::{Recurrence, UtcTimestamp, Validate};
use std::collections::{BTreeMap, BTreeSet};

type RuleResult<T> = std::result::Result<T, &'static str>;
#[derive(Clone, Copy, PartialEq, Eq)]
enum Frequency { Hourly, Daily, Weekly }
pub enum Expansion {
    Ready { instants: Vec<String>, description: String, ongoing: bool },
    Review { code: &'static str, reason: &'static str },
}
struct Rule {
    frequency: Frequency,
    interval: i64,
    hours: Vec<u32>,
    minutes: Vec<u32>,
    days: Vec<u32>,
    anchor: DateTime<Utc>,
    until: Option<DateTime<Utc>>,
    count: Option<u64>,
    base: i64,
    step: i64,
    offsets: Vec<i64>,
}
fn number(value: &str, low: u32, high: u32) -> RuleResult<u32> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) { return Err("Unsupported recurrence numeric value"); }
    value.parse::<u32>().ok().filter(|v| *v >= low && *v <= high).ok_or("Recurrence value is outside supported bounds")
}
fn list(value: &str, maximum: u32) -> RuleResult<Vec<u32>> {
    value.split(',').map(|v| number(v, 0, maximum)).collect::<RuleResult<BTreeSet<_>>>().map(|v| v.into_iter().collect())
}
fn utc(value: &UtcTimestamp) -> RuleResult<DateTime<Utc>> {
    let value = value.instant().map_err(|_| "Invalid recurrence UTC instant")?.with_timezone(&Utc);
    if !(1..=9999).contains(&value.year()) || value.timestamp_subsec_nanos() >= 1_000_000_000 { return Err("Unsupported recurrence calendar instant"); }
    Ok(value)
}
fn both<T: PartialEq>(a: Option<T>, b: Option<T>) -> RuleResult<Option<T>> {
    match (a,b) {
        (Some(a),Some(b)) if a != b => Err("Conflicting recurrence bounds"),
        (Some(a),_) => Ok(Some(a)), (_,b) => Ok(b),
    }
}
fn gcd(mut a: i64, mut b: i64) -> i64 { while b != 0 { (a,b) = (b,a % b); } a }
impl Rule {
    fn parse(value: &Recurrence) -> RuleResult<Self> {
        value.validate().map_err(|_| "Invalid recurrence fact")?;
        let anchor = utc(value.dtstart.as_ref().ok_or("Recurrence has no explicit source anchor")?)?;
        for exclusion in &value.exdates { utc(exclusion)?; }
        if anchor.timestamp_subsec_nanos() != 0 { return Err("Fractional recurrence anchors are unsupported"); }
        let normalized = value.rule.to_ascii_uppercase();
        let mut parts = BTreeMap::new();
        for part in normalized.split(';') {
            let (name, value) = part.split_once('=').ok_or("Unsupported recurrence rule syntax")?;
            if !matches!(name, "FREQ" | "INTERVAL" | "BYHOUR" | "BYMINUTE" | "BYDAY" | "COUNT" | "UNTIL") {
                return Err("Recurrence contains a rule part outside the supported Zulu subset");
            }
            if parts.insert(name,value).is_some() { return Err("Duplicate recurrence rule part"); }
        }
        let frequency = match parts.get("FREQ").copied() {
            Some("HOURLY") => Frequency::Hourly, Some("DAILY") => Frequency::Daily,
            Some("WEEKLY") => Frequency::Weekly, _ => return Err("Only HOURLY, DAILY and WEEKLY recurrence are supported"),
        };
        let interval = parts.get("INTERVAL").map(|v| number(v, 1, 1_000_000)).transpose()?.unwrap_or(1) as i64;
        let hours = parts.get("BYHOUR").map(|v| list(v,23)).transpose()?.unwrap_or_else(|| if frequency == Frequency::Hourly { (0..24).collect() } else { vec![anchor.hour()] });
        let minutes = parts.get("BYMINUTE").map(|v| list(v,59)).transpose()?.unwrap_or_else(|| vec![anchor.minute()]);
        let days = if let Some(value) = parts.get("BYDAY") {
            if frequency != Frequency::Weekly { return Err("BYDAY is supported only for WEEKLY rules"); }
            value.split(',').map(|day| ["MO","TU","WE","TH","FR","SA","SU"].iter().position(|v| *v == day).map(|v| v as u32)
                .ok_or("Only unnumbered weekdays are supported")).collect::<RuleResult<BTreeSet<_>>>()?.into_iter().collect()
        } else { vec![anchor.weekday().num_days_from_monday()] };
        let rule_until = parts.get("UNTIL").map(|v| {
            if v.len() != 16 || !v.ends_with('Z') { return Err("UNTIL must use YYYYMMDDTHHMMSSZ"); }
            let instant = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%SZ").map_err(|_| "Invalid UNTIL calendar value")?.and_utc();
            if instant.timestamp_subsec_nanos() != 0 || !(1..=9999).contains(&instant.year()) { return Err("Unsupported UNTIL instant"); }
            Ok(instant)
        }).transpose()?;
        let until = both(rule_until, value.until.as_ref().map(utc).transpose()?)?;
        let count = both(parts.get("COUNT").map(|v| number(v,1,1_000_000).map(u64::from)).transpose()?,
            value.count.map(|v| u64::try_from(v).map_err(|_| "Invalid recurrence count")).transpose()?)?;
        if count.is_some() && until.is_some() { return Err("COUNT and UNTIL cannot be combined"); }
        if until.is_some_and(|v| v < anchor) { return Err("Recurrence end precedes its source anchor"); }
        let unit = match frequency { Frequency::Hourly => 3600, Frequency::Daily => 86400, Frequency::Weekly => 604800 };
        let base = match frequency {
            Frequency::Hourly => anchor.timestamp().div_euclid(3600) * 3600,
            Frequency::Daily => anchor.timestamp().div_euclid(86400) * 86400,
            Frequency::Weekly => anchor.timestamp().div_euclid(86400) * 86400 - i64::from(anchor.weekday().num_days_from_monday()) * 86400,
        };
        let mut offsets = Vec::new();
        for day in if frequency == Frequency::Weekly { days.clone() } else { vec![0] } {
            for hour in if frequency == Frequency::Hourly { vec![0] } else { hours.clone() } {
                for minute in &minutes { offsets.push(i64::from(day)*86400 + i64::from(hour)*3600 + i64::from(*minute)*60 + i64::from(anchor.second())); }
            }
        }
        let result = Self { frequency, interval, hours, minutes, days, anchor, until, count, base, step: unit * interval, offsets };
        if result.frequency == Frequency::Hourly && !(0..24/gcd(interval,24)).any(|n| result.allowed(n)) {
            return Err("Hourly phase and BYHOUR select no occurrences");
        }
        Ok(result)
    }
    fn allowed(&self, period: i64) -> bool {
        self.frequency != Frequency::Hourly || self.hours.contains(&((self.base + period*self.step).div_euclid(3600).rem_euclid(24) as u32))
    }
    /// Count earlier scheduled positions without walking from an old anchor to now.
    /// Exclusions do not replenish COUNT; an unmatched source lower bound is not an occurrence.
    fn before(&self, period: i64) -> u64 {
        if period == 0 { return 0; }
        let periods = if self.frequency == Frequency::Hourly {
            let cycle = 24/gcd(self.interval,24);
            let per_cycle = (0..cycle).filter(|n| self.allowed(*n)).count() as u64;
            (period/cycle) as u64 * per_cycle + (0..period%cycle).filter(|n| self.allowed(*n)).count() as u64
        } else { period as u64 };
        let excluded = if self.allowed(0) { self.offsets.iter().filter(|offset| self.base + **offset < self.anchor.timestamp()).count() as u64 } else { 0 };
        periods * self.offsets.len() as u64 - excluded
    }
    fn description(&self) -> String {
        let clock = |hour: u32, minute: u32| if self.anchor.second() == 0 { format!("{hour:02}{minute:02}Z") } else { format!("{hour:02}{minute:02}{:02}Z",self.anchor.second()) };
        let times = if self.hours.len() * self.minutes.len() <= 8 {
            self.hours.iter().flat_map(|h| self.minutes.iter().map(move |m| clock(*h,*m))).collect::<Vec<_>>().join(" and ")
        } else { format!("UTC hours {:?}, minutes {:?}",self.hours,self.minutes) };
        let pattern = match self.frequency {
            Frequency::Hourly => format!("Every {} hour(s), UTC hours {:?}, minutes {:?}, second {}",self.interval,self.hours,self.minutes,self.anchor.second()),
            Frequency::Daily if self.interval == 1 => format!("Daily at {times}"),
            Frequency::Daily => format!("Every {} days at {times}",self.interval),
            Frequency::Weekly => format!("Every {} week(s), {} at {times}",self.interval,self.days.iter().map(|d| ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][*d as usize]).collect::<Vec<_>>().join(", ")),
        };
        let start = self.anchor.format("%d %b %Y %H%M%SZ").to_string().to_ascii_uppercase();
        let end = if let Some(until) = self.until { format!(", through {} inclusive",until.format("%d %b %Y %H%M%SZ").to_string().to_ascii_uppercase()) }
            else if let Some(count) = self.count { format!(", {count} scheduled positions before exclusions") } else { ", ongoing; displayed within the requested window".into() };
        format!("{pattern}, from {start}{end}")
    }
}
/// No duration is manufactured: source check/changeover recurrences expand to points.
pub fn expand(value: &Recurrence, from: &str, to: &str, limit: usize) -> Result<Expansion> {
    let rule = match Rule::parse(value) {
        Ok(rule) => rule,
        Err(reason) => return Ok(Expansion::Review { code: if value.dtstart.is_none() { "recurrence_missing_anchor" } else { "recurrence_unsupported" }, reason }),
    };
    let from = DateTime::parse_from_rfc3339(from).map_err(|_| Error::invalid("Recurrence window"))?.with_timezone(&Utc);
    let to = DateTime::parse_from_rfc3339(to).map_err(|_| Error::invalid("Recurrence window"))?.with_timezone(&Utc);
    if to < from || to.signed_duration_since(from) > chrono::Duration::days(42) { return Err(Error::invalid("Recurrence window must be at most 42 days")); }
    let exclusions = value.exdates.iter().map(|v| utc(v).map_err(|_| Error::unavailable())).collect::<Result<BTreeSet<_>>>()?;
    let mut instants = Vec::new();
    let mut period = (from.timestamp() - rule.base).max(0) / rule.step;
    let mut ordinal = rule.before(period);
    let end = rule.until.map_or(to, |until| until.min(to));
    'periods: while rule.base + period*rule.step <= end.timestamp() {
        if rule.count.is_some_and(|count| ordinal >= count) { break; }
        if rule.allowed(period) {
            for offset in &rule.offsets {
                let at = DateTime::from_timestamp(rule.base + period*rule.step + offset,0).ok_or_else(Error::unavailable)?;
                if at < rule.anchor { continue; }
                ordinal += 1;
                if rule.count.is_some_and(|count| ordinal > count) || at >= to || rule.until.is_some_and(|until| at > until) { break 'periods; }
                if at < from || exclusions.contains(&at) { continue; }
                if instants.len() >= limit { return Err(Error::new("resource_exhausted", "Timeline fact bound reached by recurrence; narrow the window")); }
                instants.push(at.to_rfc3339_opts(SecondsFormat::Secs,true));
            }
        }
        period += 1;
    }
    Ok(Expansion::Ready { instants, description: rule.description(), ongoing: rule.count.is_none() && rule.until.is_none() })
}
