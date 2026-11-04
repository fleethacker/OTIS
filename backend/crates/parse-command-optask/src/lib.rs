//! Compiled OPTASK contribution. Rules operate only on explicit profiles and supplied evidence.
mod frequency;
mod geo;
mod interpretation;
mod profile;
mod time;

use interpretation::extract;
use parse_command_parser_api::*;
use parse_command_types::*;
use profile::{Profile, field};
use serde_json::{Map, Value, json};

pub use profile::TYPES as SUPPORTED_MESSAGE_TYPES;
pub struct OptaskParser;
static DESCRIPTOR: ParserDescriptor = ParserDescriptor {
    id: "optask",
    version: "0.2.0",
    icd_major: ICD_MAJOR,
    message_types: profile::TYPES,
    profiles: &[profile::BASELINE, profile::EXAMPLES],
    fact_categories: &[
        FactCategory::Period,
        FactCategory::Frequency,
        FactCategory::Activity,
        FactCategory::Contact,
        FactCategory::Location,
    ],
};
impl MessageParser for OptaskParser {
    fn descriptor(&self) -> &'static ParserDescriptor {
        &DESCRIPTOR
    }
    fn assess(&self, input: &MessageView<'_>) -> MatchOutcome {
        match profile::select(input) {
            Some(p) => MatchOutcome::Applicable {
                profile: p.name(),
                rule: "optask.header_signature.v1",
            },
            None => MatchOutcome::Unsupported,
        }
    }
    fn parse(
        &self,
        input: &MessageView<'_>,
        context: &ParseContext<'_>,
        output: &mut dyn ParseSink,
    ) -> Result<ParseSummary, ParseFailure> {
        let profile = profile::select(input).ok_or(ParseFailure::new(
            ErrorKind::UnsupportedProfile,
            "optask_profile",
        ))?;
        let header_record =
            input
                .records
                .iter()
                .find(|r| r.set_id == "MSGID")
                .ok_or(ParseFailure::new(
                    ErrorKind::MalformedInput,
                    "missing_msgid",
                ))?;
        let (header, header_codes) = header(header_record, profile, context)?;
        let issued_at = header.issued_at.clone();
        output.header(header)?;
        output.audit(audit(
            header_record,
            None,
            profile,
            "optask.header.v1",
            "S1 pp.2266-2267; S3 pp.243-263",
            json!({"diagnostics":header_codes}),
        ))?;
        for code in header_codes {
            output.review_flag(code)?;
        }
        output.review_flag("partial_interpretation")?;
        if profile.inferential() {
            output.review_flag("inferred_profile")?;
        }
        let mut scope = Scope::default();
        let mut counts = [0usize; 5];
        let mut message_periods = Vec::new();
        for record in input.records {
            context.budget.checkpoint(1 + record.fields.len() as u64)?;
            if record.set_id == "MSGID" {
                continue;
            }
            scope.advance(record, input.message_type)?;
            for (is_geo, extraction) in [
                extract(record, input.message_type, profile, &scope),
                geo::extract(record, &scope, context.budget),
            ]
            .into_iter()
            .enumerate()
            {
                let extraction = extraction.and_then(|extraction| {
                    if let Some(value) = &extraction {
                        // Reject a bad record before emitting any of its facts.
                        for fact in &value.facts {
                            fact.validate()?;
                        }
                    }
                    Ok(extraction)
                });
                match extraction {
                    Ok(Some(extraction)) => {
                        if extraction.facts.is_empty() {
                            output.audit(audit(
                                record,
                                None,
                                profile,
                                extraction.rule,
                                extraction.source,
                                json!({"disposition":"no_scheduled_fact"}),
                            ))?;
                        }
                        for mut fact in extraction.facts {
                            fact.assign_id(&mut counts);
                            let id = fact.id().to_owned();
                            if matches!(&fact,Fact::Location(v) if v.status==LocationStatus::Unresolved)
                            {
                                output.review_flag("geospatial_review")?;
                            }
                            if fact.has_partial_time() {
                                output.review_flag("time_review")?;
                            }
                            if let Fact::Period(p) = &fact {
                                if p.scope.is_none() {
                                    message_periods.push(p.clone());
                                }
                            }
                            if fact.conflicts_with(
                                &message_periods,
                                issued_at.as_ref(),
                                context.budget,
                            )? {
                                output.review_flag("time_conflict")?;
                            }
                            let temporal = matches!(&fact,Fact::Activity(a) if a.kind=="crypto_changeover" && profile==Profile::Baseline);
                            output.audit(audit(
                                record,
                                Some(id),
                                profile,
                                extraction.rule,
                                extraction.source,
                                json!({"daily_recurrence_evidence":temporal,"scope":fact.scope()}),
                            ))?;
                            fact.emit(output)?;
                        }
                        if let Some(code) = extraction.diagnostic {
                            diagnostic(record, profile, code, output)?;
                        }
                    }
                    Ok(None) if is_geo == 1 => {}
                    Ok(None) => {
                        // Preserve every unprojected record without treating arbitrary prose as tasking.
                        output.audit(audit(
                            record,
                            None,
                            profile,
                            "optask.preserve.v1",
                            "record retained without semantic projection",
                            json!({"disposition":"preserved_only"}),
                        ))?;
                        if matches!(record.set_id, "CANX" | "REF") {
                            output.review_flag("lineage_review")?;
                        }
                        if record.set_id == "CAVEAT" {
                            output.review_flag("security_review")?;
                        }
                    }
                    Err(error)
                        if matches!(
                            error.kind,
                            ErrorKind::MalformedInput | ErrorKind::InvalidValue
                        ) =>
                    {
                        diagnostic(record, profile, error.code, output)?;
                        output.review_flag("record_review")?;
                    }
                    Err(error) => return Err(error),
                }
            }
        }
        Ok(ParseSummary {
            profile: profile.name(),
            completeness: Completeness::Partial,
        })
    }
}
fn diagnostic(
    r: &RecordView<'_>,
    p: Profile,
    code: &'static str,
    sink: &mut dyn ParseSink,
) -> Result<(), ParseFailure> {
    sink.audit(audit(
        r,
        None,
        p,
        "optask.record_review.v1",
        "profile validation",
        json!({"code":code,"disposition":"review_required"}),
    ))
}
fn audit(
    r: &RecordView<'_>,
    subject_id: Option<String>,
    p: Profile,
    rule: &str,
    source: &str,
    detail: Value,
) -> AuditEntry {
    let mut payload = Map::new();
    payload.insert("rule_id".into(), json!(rule));
    payload.insert("rule_revision".into(), json!("1"));
    payload.insert("profile".into(), json!(p.name()));
    payload.insert("inferred".into(), json!(p.inferential()));
    payload.insert("source_reference".into(), json!(source));
    payload.insert("record_sequence".into(), json!(r.sequence));
    payload.insert("set_id".into(), json!(r.set_id));
    payload.insert("span".into(),json!({"start_byte":r.span.start,"end_byte":r.span.end,"representation":"decoded_utf8_body"}));
    payload.insert("fields".into(),json!(r.fields.iter().map(|f|json!({"position":f.position,"start_byte":f.span.start,"end_byte":f.span.end})).collect::<Vec<_>>()));
    payload.insert("detail".into(), detail);
    AuditEntry {
        kind: if subject_id.is_some() {
            "fact_interpreted"
        } else {
            "record_interpreted"
        }
        .into(),
        subject_id,
        payload,
    }
}
fn bad(code: &'static str) -> ParseFailure {
    ParseFailure::new(ErrorKind::InvalidValue, code)
}
fn present(value: &str) -> Option<String> {
    (!value.is_empty() && value != "-").then(|| value.to_owned())
}
fn untag(value: &str) -> &str {
    ["SHIP:", "UNIT:", "SUB:", "DESIG:", "CALLSIGN:"]
        .iter()
        .find_map(|p| value.strip_prefix(p))
        .unwrap_or(value)
}
fn header(
    r: &RecordView<'_>,
    p: Profile,
    c: &ParseContext<'_>,
) -> Result<(HeaderInterpretation, Vec<&'static str>), ParseFailure> {
    let mut codes = Vec::new();
    if p == Profile::Baseline {
        // The old MSGID has no security policy field. Require explicit caller provenance.
        let security = c
            .security_override
            .cloned()
            .ok_or(bad("baseline_security_context_required"))?;
        codes.push("issue_time_review");
        return Ok((
            HeaderInterpretation {
                message_type: field(r, 1)?.into_owned(),
                originator: field(r, 2)?.into_owned(),
                serial: r.fields.get(2).and_then(|f| present(&f.normalized())),
                issued_at: None,
                security,
            },
            codes,
        ));
    }
    let issue = match time::issue(&field(r, 6)?) {
        Ok(t) => t,
        Err(_) => {
            codes.push("invalid_issue_time");
            None
        }
    };
    if issue.is_none() {
        codes.push("issue_time_review");
    }
    let classification = match field(r, 10)?.as_ref() {
        "UNCLASSIFIED" => Some(SecurityClassification::Unclassified),
        "CONFIDENTIAL" => Some(SecurityClassification::Confidential),
        "SECRET" => Some(SecurityClassification::Secret),
        "TOP SECRET" => Some(SecurityClassification::TopSecret),
        _ => {
            codes.push("security_review");
            None
        }
    };
    let policy = field(r, 9)?.into_owned();
    if policy == "-" {
        codes.push("security_review");
    }
    let release_to = r
        .fields
        .get(10)
        .map(|f| {
            f.normalized()
                .split_whitespace()
                .filter(|s| *s != "-")
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    Ok((
        HeaderInterpretation {
            message_type: field(r, 1)?.into_owned(),
            originator: field(r, 4)?.into_owned(),
            serial: present(&field(r, 5)?),
            issued_at: issue,
            security: Security {
                policy,
                classification,
                release_to,
                status: if classification.is_none() {
                    SecurityStatus::Conflict
                } else {
                    SecurityStatus::Unvalidated
                },
            },
        },
        codes,
    ))
}

#[derive(Default)]
struct Scope {
    segment: Option<String>,
    coordinator: Option<String>,
    datum: Option<String>,
}
impl Scope {
    fn advance(&mut self, r: &RecordView<'_>, kind: &str) -> Result<(), ParseFailure> {
        if r.set_id == "GEODATUM" {
            self.datum = r.fields.first().map(|f| f.normalized().into_owned());
        }
        if kind != "OPTASK LINK" {
            return Ok(());
        }
        if matches!(
            r.set_id,
            "INTCOORD"
                | "LNKI"
                | "LNKIV"
                | "LNKXI"
                | "LNKXIB"
                | "LNKATDL"
                | "LNKATDLI"
                | "LNKXIV"
                | "LNKXVI"
                | "LNKXVIJM"
                | "LNKNAT"
                | "LNKSADL"
                | "LNKSAT"
                | "JREDATA"
                | "CNRSEG"
                | "FILTERS"
        ) {
            self.segment = r.fields.first().map(|f| f.normalized().into_owned());
            self.coordinator = None;
        } else if r.set_id == "MULCDUTY" && self.segment.is_some() {
            self.coordinator = r.fields.first().map(|f| untag(&f.normalized()).to_owned());
        } else if r.set_id == "HEADING"
            || (r.set_id == "GENTEXT"
                && r.fields.first().is_some_and(|f| {
                    matches!(
                        f.normalized().as_ref(),
                        "C2 REQUIREMENTS"
                            | "COMMAND AND CONTROL COORDINATION REQUIREMENTS"
                            | "REPORTING REQUIREMENTS"
                            | "SPECIAL INFORMATION"
                            | "SPECIAL INSTRUCTIONS"
                    )
                }))
        {
            self.segment = None;
            self.coordinator = None;
        } else if !matches!(r.set_id, "IVCCN" | "VOICRYPT") {
            self.coordinator = None;
        }
        Ok(())
    }
    fn fact(&self) -> Option<String> {
        match (&self.segment, &self.coordinator) {
            (Some(a), Some(b)) => Some(format!("{a} / {b}")),
            (a, None) => a.clone(),
            _ => None,
        }
    }
}
enum Fact {
    Period(Period),
    Frequency(Frequency),
    Activity(Box<Activity>),
    Contact(Contact),
    Location(Location),
}
impl Fact {
    fn validate(&self) -> Result<(), ValidationError> {
        match self {
            Self::Period(f) => f.validate(),
            Self::Frequency(f) => f.validate(),
            Self::Activity(f) => f.validate(),
            Self::Contact(f) => f.validate(),
            Self::Location(f) => f.validate(),
        }
    }
    fn id(&self) -> &str {
        match self {
            Self::Period(f) => &f.id,
            Self::Frequency(f) => &f.id,
            Self::Activity(f) => &f.id,
            Self::Contact(f) => &f.id,
            Self::Location(f) => &f.id,
        }
    }
    fn assign_id(&mut self, counts: &mut [usize; 5]) {
        let (index, prefix, id) = match self {
            Self::Period(f) => (0, 'v', &mut f.id),
            Self::Frequency(f) => (1, 'f', &mut f.id),
            Self::Activity(f) => (2, 'a', &mut f.id),
            Self::Contact(f) => (3, 'c', &mut f.id),
            Self::Location(f) => (4, 'g', &mut f.id),
        };
        counts[index] += 1;
        *id = format!("{prefix}{}", counts[index]);
    }
    fn scope(&self) -> Option<&str> {
        match self {
            Self::Period(f) => f.scope.as_deref(),
            Self::Frequency(f) => f.scope.as_deref(),
            Self::Activity(f) => f.scope.as_deref(),
            Self::Contact(f) => f.scope.as_deref(),
            Self::Location(f) => f.scope.as_deref(),
        }
    }
    fn emit(self, s: &mut dyn ParseSink) -> Result<(), ParseFailure> {
        match self {
            Self::Period(f) => s.period(f),
            Self::Frequency(f) => s.frequency(f),
            Self::Activity(f) => s.activity(*f),
            Self::Contact(f) => s.contact(f),
            Self::Location(f) => s.location(f),
        }
    }
    fn has_partial_time(&self) -> bool {
        match self {
            Self::Period(f) => {
                f.start_status.is_some()
                    || f.end_status.is_some_and(|s| s != TimeStatus::OpenEnded)
                    || f.qualifier_status.is_some()
            }
            Self::Activity(f) => [
                f.time_status,
                f.start_status,
                f.end_status,
                f.as_of_status,
                f.deadline_status,
            ]
            .iter()
            .any(Option::is_some),
            _ => false,
        }
    }
    fn conflicts_with(
        &self,
        periods: &[Period],
        issue: Option<&UtcTimestamp>,
        budget: &WorkBudget<'_>,
    ) -> Result<bool, ParseFailure> {
        if let Self::Period(p) = self {
            if let (Some(end), Some(issue)) = (&p.end_at, issue) {
                return Ok(end.instant()? < issue.instant()?);
            }
        }
        if let Self::Activity(a) = self {
            for t in [&a.at, &a.start_at, &a.end_at].into_iter().flatten() {
                let instant = t.instant()?;
                for p in periods {
                    budget.checkpoint(1)?;
                    let before = p
                        .start_at
                        .as_ref()
                        .map(|s| s.instant().map(|s| instant < s))
                        .transpose()?
                        .unwrap_or(false);
                    let after = p
                        .end_at
                        .as_ref()
                        .map(|e| e.instant().map(|e| instant > e))
                        .transpose()?
                        .unwrap_or(false);
                    if before || after {
                        return Ok(true);
                    }
                }
            }
        }
        Ok(false)
    }
}
struct Extraction {
    facts: Vec<Fact>,
    rule: &'static str,
    source: &'static str,
    diagnostic: Option<&'static str>,
}
impl Extraction {
    fn new(facts: Vec<Fact>, rule: &'static str, source: &'static str) -> Self {
        Self {
            facts,
            rule,
            source,
            diagnostic: None,
        }
    }
}
fn activity(kind: &str) -> Result<Activity, ParseFailure> {
    serde_json::from_value(json!({"id":"a1","type":kind,"status":"inferred"}))
        .map_err(|_| bad("activity_constructor"))
}
