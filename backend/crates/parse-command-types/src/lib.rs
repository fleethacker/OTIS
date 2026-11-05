//! Compact ICD 1.2.0 documents. Validate before publication; core never carries parser evidence.
use chrono::{DateTime, Duration, FixedOffset, SecondsFormat};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fmt};

mod generated;
pub use generated::*;
pub const ICD_VERSION: &str = "1.2.0";
pub const ICD_MAJOR: u16 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ValidationError {
    pub field: &'static str,
    pub rule: &'static str,
}
impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.field, self.rule)
    }
}
impl std::error::Error for ValidationError {}
pub trait Validate {
    fn validate(&self) -> Result<(), ValidationError>;
}
pub(crate) fn invalid(field: &'static str, rule: &'static str) -> ValidationError {
    ValidationError { field, rule }
}

/// Serializes a document only after its structural and semantic checks pass.
#[derive(Debug, Serialize)]
#[serde(transparent)]
pub struct Validated<T>(T);
impl<T: Validate> Validated<T> {
    pub fn new(value: T) -> Result<Self, ValidationError> {
        value.validate()?;
        Ok(Self(value))
    }
    pub fn get(&self) -> &T {
        &self.0
    }
    pub fn into_inner(self) -> T {
        self.0
    }
}

/// An explicit UTC instant, preserving source precision instead of applying the host clock.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct UtcTimestamp(String);
impl UtcTimestamp {
    pub fn new(value: impl Into<String>) -> Result<Self, ValidationError> {
        let value = value.into();
        let b = value.as_bytes();
        if b.len() < 20
            || b.get(10) != Some(&b'T')
            || !value.ends_with('Z')
            || b.get(4) != Some(&b'-')
        {
            return Err(invalid("timestamp", "explicit_utc_datetime"));
        }
        DateTime::parse_from_rfc3339(&value).map_err(|_| invalid("timestamp", "calendar"))?;
        if let Some(dot) = value.find('.') {
            if value.len() - dot - 2 > 9 {
                return Err(invalid("timestamp", "precision_exceeds_nanoseconds"));
            }
        }
        Ok(Self(value))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub fn instant(&self) -> Result<DateTime<FixedOffset>, ValidationError> {
        DateTime::parse_from_rfc3339(&self.0).map_err(|_| invalid("timestamp", "calendar"))
    }
    pub fn add_days(&self, days: i64) -> Result<Self, ValidationError> {
        let delta = Duration::try_days(days).ok_or(invalid("timestamp", "overflow"))?;
        let time = self
            .instant()?
            .checked_add_signed(delta)
            .ok_or(invalid("timestamp", "overflow"))?;
        Self::new(time.to_rfc3339_opts(SecondsFormat::AutoSi, true))
    }
}
impl<'de> Deserialize<'de> for UtcTimestamp {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}
pub(crate) fn required_nullable<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(d)
}
pub(crate) fn optional_present<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}

pub fn message_id(body: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(body.as_bytes()))
}
/// Length-prefixed components avoid delimiter collisions. Persist the resulting event identity.
pub fn event_id(parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    format!("{:x}", hash.finalize())
}
fn lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn validate_hash_id(v: &str, field: &'static str) -> Result<(), ValidationError> {
    if !v
        .strip_prefix("sha256:")
        .is_some_and(|s| s.len() == 64 && lower_hex(s))
    {
        return Err(invalid(field, "sha256_id"));
    }
    Ok(())
}
pub fn validate_revision(v: &str, field: &'static str) -> Result<(), ValidationError> {
    if v.is_empty()
        || v.len() > 64
        || !v.as_bytes()[0].is_ascii_alphanumeric()
        || !v
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        return Err(invalid(field, "revision"));
    }
    Ok(())
}
pub fn validate_token(v: &str, field: &'static str) -> Result<(), ValidationError> {
    if v.is_empty()
        || v.len() > 64
        || !v.as_bytes()[0].is_ascii_lowercase()
        || !v
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b))
    {
        return Err(invalid(field, "token"));
    }
    Ok(())
}
pub fn validate_subject_id(
    v: &str,
    prefix: Option<u8>,
    field: &'static str,
) -> Result<(), ValidationError> {
    let b = v.as_bytes();
    if b.len() < 2
        || !b"afcvgr".contains(&b[0])
        || prefix.is_some_and(|p| p != b[0])
        || b[1] == b'0'
        || !b[1..].iter().all(u8::is_ascii_digit)
    {
        return Err(invalid(field, "subject_id"));
    }
    Ok(())
}
pub fn validate_event_id(v: &str, field: &'static str) -> Result<(), ValidationError> {
    if v.len() != 64 || !lower_hex(v) {
        return Err(invalid(field, "event_id"));
    }
    Ok(())
}
fn nonempty(v: &str, field: &'static str) -> Result<(), ValidationError> {
    if v.is_empty() {
        return Err(invalid(field, "nonempty"));
    }
    Ok(())
}
fn validate_strings(
    v: &[String],
    unique: bool,
    field: &'static str,
) -> Result<(), ValidationError> {
    for s in v {
        nonempty(s, field)?;
    }
    if unique && v.iter().collect::<BTreeSet<_>>().len() != v.len() {
        return Err(invalid(field, "unique"));
    }
    Ok(())
}
fn validate_time(v: &str, field: &'static str) -> Result<(), ValidationError> {
    let b = v.as_bytes();
    if !(b.len() == 5 || (b.len() == 6 && b[5] == b'Z'))
        || b[2] != b':'
        || ![b[0], b[1], b[3], b[4]].iter().all(u8::is_ascii_digit)
        || (b[0] - b'0') * 10 + b[1] - b'0' > 23
        || (b[3] - b'0') * 10 + b[4] - b'0' > 59
    {
        return Err(invalid(field, "clock_time"));
    }
    Ok(())
}
fn endpoint(
    at: &Option<UtcTimestamp>,
    time: &Option<String>,
    label: &Option<String>,
    status: &Option<TimeStatus>,
    required: bool,
) -> Result<(), ValidationError> {
    if at.is_some() && (time.is_some() || label.is_some() || status.is_some()) {
        return Err(invalid("time", "conflicting_representations"));
    }
    if required && at.is_none() && time.is_none() && label.is_none() && status.is_none() {
        return Err(invalid("time", "missing_endpoint"));
    }
    Ok(())
}
fn ordered(
    start: &Option<UtcTimestamp>,
    end: &Option<UtcTimestamp>,
) -> Result<(), ValidationError> {
    if let (Some(start), Some(end)) = (start, end) {
        if start.instant()? > end.instant()? {
            return Err(invalid("interval", "end_before_start"));
        }
    }
    Ok(())
}
impl Security {
    fn validate_semantics(&self) -> Result<(), ValidationError> {
        Ok(())
    }
}
impl ContactChannel {
    fn validate_semantics(&self) -> Result<(), ValidationError> {
        Ok(())
    }
}
impl Contact {
    fn validate_semantics(&self) -> Result<(), ValidationError> {
        Ok(())
    }
}
impl Period {
    fn validate_semantics(&self) -> Result<(), ValidationError> {
        endpoint(
            &self.start_at,
            &self.start_time,
            &self.start_label,
            &self.start_status,
            true,
        )?;
        endpoint(
            &self.end_at,
            &self.end_time,
            &self.end_label,
            &self.end_status,
            true,
        )?;
        endpoint(
            &self.qualifier_at,
            &self.qualifier_time,
            &self.qualifier_label,
            &self.qualifier_status,
            false,
        )?;
        ordered(&self.start_at, &self.end_at)
    }
}
impl Frequency {
    fn validate_semantics(&self) -> Result<(), ValidationError> {
        if self.hz.is_none() && self.status != Some(FrequencyStatus::Unavailable) {
            return Err(invalid("frequency.hz", "missing_requires_unavailable"));
        }
        if let Some(upper) = self.upper_hz {
            if self.hz.is_none_or(|low| upper < low) {
                return Err(invalid("frequency.upper_hz", "range"));
            }
        }
        Ok(())
    }
}
impl Activity {
    fn validate_semantics(&self) -> Result<(), ValidationError> {
        endpoint(
            &self.at,
            &self.time,
            &self.time_label,
            &self.time_status,
            false,
        )?;
        endpoint(
            &self.start_at,
            &self.start_time,
            &self.start_label,
            &self.start_status,
            false,
        )?;
        endpoint(
            &self.end_at,
            &self.end_time,
            &self.end_label,
            &self.end_status,
            false,
        )?;
        endpoint(
            &self.as_of_at,
            &self.as_of_time,
            &self.as_of_label,
            &self.as_of_status,
            false,
        )?;
        endpoint(
            &self.deadline_at,
            &self.deadline_time,
            &self.deadline_label,
            &self.deadline_status,
            false,
        )?;
        ordered(&self.start_at, &self.end_at)?;
        if self.kind == "tasking" && (self.task_type.is_none() || self.description.is_none()) {
            return Err(invalid("activity", "task_fields_required"));
        }
        if self.kind == "reporting_requirement"
            && (self.report.is_none() || self.responsible_party.is_none())
        {
            return Err(invalid("activity", "report_fields_required"));
        }
        Ok(())
    }
}
impl Recurrence {
    fn validate_semantics(&self) -> Result<(), ValidationError> {
        // Interpretation support is checked by the timeline, not by dropping an
        // unfamiliar RRULE from custody. Provenance remains in fact audit.
        if self.rule.len() > 512 || self.exdates.len() > 4096 {
            return Err(invalid("recurrence", "bounds"));
        }
        let mut exclusions = BTreeSet::new();
        for at in &self.exdates {
            if !exclusions.insert(at.instant()?) { return Err(invalid("recurrence.exdates", "unique_instants")); }
        }
        Ok(())
    }
}
impl Message {
    fn validate_semantics(&self) -> Result<(), ValidationError> {
        match (&self.issued_at, &self.expires_at) {
            (Some(issue), Some(expiry))
                if issue.add_days(365)?.instant()? == expiry.instant()? => {}
            (None, None) => {}
            _ => return Err(invalid("message.expires_at", "issue_plus_365_days")),
        }
        let ids = self
            .periods
            .iter()
            .map(|x| &x.id)
            .chain(self.frequencies.iter().map(|x| &x.id))
            .chain(self.activities.iter().map(|x| &x.id))
            .chain(self.contacts.iter().map(|x| &x.id))
            .chain(self.locations.iter().map(|x| &x.id))
            .chain(self.recurrences.iter().map(|x| &x.id));
        let mut seen = BTreeSet::new();
        for id in ids {
            if !seen.insert(id) {
                return Err(invalid("message", "duplicate_subject"));
            }
        }
        for recurrence in &self.recurrences {
            if recurrence.activity_id.as_ref().is_some_and(|id| !self.activities.iter().any(|activity| &activity.id == id && activity.kind == recurrence.kind)) {
                return Err(invalid("recurrence.activity_id", "matching_activity_missing"));
            }
        }
        Ok(())
    }
}
impl Passage {
    fn validate_semantics(&self) -> Result<(), ValidationError> {
        if (self.embedding_status == PassageEmbeddingStatus::Ready) != self.embedding.is_some() {
            return Err(invalid("passage.embedding", "readiness"));
        }
        if self.issued_at.is_none() && self.expires_at.is_some() {
            return Err(invalid("passage.expires_at", "missing_issue"));
        }
        Ok(())
    }
}
impl AuditEvent {
    fn validate_semantics(&self) -> Result<(), ValidationError> {
        Ok(())
    }
}
impl GeoPoint {
    fn validate_semantics(&self) -> Result<(), ValidationError> {
        if !self.lat.is_finite() || !self.lon.is_finite() {
            return Err(invalid("geoPoint", "finite_coordinates"));
        }
        Ok(())
    }
}
impl Location {
    fn validate_semantics(&self) -> Result<(), ValidationError> {
        if self.radius_m.is_some_and(|v| !v.is_finite()) {
            return Err(invalid("location.radius_m", "finite"));
        }
        if self.status == LocationStatus::Unresolved {
            if self.point.is_some() || self.shape.is_some() {
                return Err(invalid("location", "unresolved_geometry"));
            }
            return Ok(());
        }
        if self.datum != "WGS84" || self.point.is_some() == self.shape.is_some() {
            return Err(invalid("location", "one_wgs84_geometry"));
        }
        if let Some(shape) = &self.shape {
            if shape.len() != 2 {
                return Err(invalid("location.shape", "geometry_keys"));
            }
            let kind = shape
                .get("type")
                .and_then(|v| v.as_str())
                .ok_or(invalid("location.shape", "geometry_type"))?;
            let coords = shape
                .get("coordinates")
                .ok_or(invalid("location.shape", "coordinates"))?;
            fn point(v: &serde_json::Value) -> Result<(), ValidationError> {
                let a = v
                    .as_array()
                    .filter(|a| a.len() == 2)
                    .ok_or(invalid("location.shape", "position"))?;
                GeoPoint {
                    lon: a[0]
                        .as_f64()
                        .ok_or(invalid("location.shape", "longitude"))?,
                    lat: a[1].as_f64().ok_or(invalid("location.shape", "latitude"))?,
                }
                .validate()
            }
            fn points(
                v: &serde_json::Value,
                min: usize,
            ) -> Result<&Vec<serde_json::Value>, ValidationError> {
                let a = v
                    .as_array()
                    .filter(|a| a.len() >= min)
                    .ok_or(invalid("location.shape", "vertices"))?;
                for v in a {
                    point(v)?;
                }
                Ok(a)
            }
            match kind {
                "Point" => point(coords)?,
                "LineString" => {
                    let a = points(coords, 2)?;
                    if a.windows(2).all(|w| w[0] == w[1]) {
                        return Err(invalid("location.shape", "degenerate_line"));
                    }
                }
                "Polygon" => {
                    let rings = coords
                        .as_array()
                        .filter(|a| !a.is_empty())
                        .ok_or(invalid("location.shape", "rings"))?;
                    for ring in rings {
                        let a = points(ring, 4)?;
                        if a.first() != a.last() {
                            return Err(invalid("location.shape", "ring_not_closed"));
                        }
                    }
                }
                _ => return Err(invalid("location.shape", "geometry_type")),
            }
        }
        Ok(())
    }
}
