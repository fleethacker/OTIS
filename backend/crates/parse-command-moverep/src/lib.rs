//! Source-linked MOVEREP facts. This contributor does not assign command authority.
use chrono::NaiveDate;
use parse_command_parser_api::coordinate::point;
use parse_command_parser_api::*;
use parse_command_types::*;
use serde_json::{Map, Value, json};

pub const BASELINE: &str = "usmtf-2003-moverep-v1";
pub const EXAMPLES: &str = "observed-moverep-b10112-v1";
pub struct MoverepParser;
static DESCRIPTOR: ParserDescriptor = ParserDescriptor {
    id: "moverep",
    version: "0.1.0",
    icd_major: ICD_MAJOR,
    message_types: &["MOVEREP"],
    profiles: &[BASELINE, EXAMPLES],
    fact_categories: &[FactCategory::Movement, FactCategory::Location],
};

fn bad(code: &'static str, r: &RecordView<'_>) -> ParseFailure {
    ParseFailure::new(ErrorKind::InvalidValue, code).at(r.span.start)
}
fn field(r: &RecordView<'_>, n: usize) -> String {
    r.fields
        .get(n - 1)
        .map(|f| f.normalized().into_owned())
        .unwrap_or_default()
}
fn present(raw: String) -> Option<String> {
    (!raw.is_empty() && raw != "-").then_some(raw)
}
fn arity(r: &RecordView<'_>, min: usize, max: usize) -> Result<(), ParseFailure> {
    if !(min..=max).contains(&r.fields.len()) || !r.rows.is_empty() {
        return Err(bad("moverep_record_layout", r));
    }
    Ok(())
}
fn profile(input: &MessageView<'_>) -> Option<&'static str> {
    if input.message_type != "MOVEREP" {
        return None;
    }
    let header = input.records.iter().find(|r| r.set_id == "MSGID")?;
    if field(header, 2) == "MIL-STD-6040(SERIES)" {
        return (field(header, 3) == "B.1.01.12" && arity(header, 10, 11).is_ok())
            .then_some(EXAMPLES);
    }
    (!field(header, 2).starts_with("MIL-STD") && arity(header, 2, 6).is_ok()).then_some(BASELINE)
}
fn issue(raw: &str) -> Option<UtcTimestamp> {
    if raw.len() != 16 || !raw.is_ascii() || &raw[8..9] != "T" || !raw.ends_with('Z') {
        return None;
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
    .ok()
}
fn header(
    r: &RecordView<'_>,
    p: &str,
    context: &ParseContext<'_>,
    out: &mut dyn ParseSink,
) -> Result<Option<i32>, ParseFailure> {
    if p == BASELINE {
        out.review_flag("issue_time_review")?;
        out.header(HeaderInterpretation {
            message_type: "MOVEREP".into(),
            originator: field(r, 2),
            serial: present(field(r, 3)),
            issued_at: None,
            security: context
                .security_override
                .cloned()
                .ok_or(bad("baseline_security_context_required", r))?,
        })?;
        return Ok(None);
    }
    let at = issue(&field(r, 6));
    if at.is_none() {
        out.review_flag("issue_time_review")?;
    }
    let classification = match field(r, 10).as_str() {
        "UNCLASSIFIED" => Some(SecurityClassification::Unclassified),
        "CONFIDENTIAL" => Some(SecurityClassification::Confidential),
        "SECRET" => Some(SecurityClassification::Secret),
        "TOP SECRET" => Some(SecurityClassification::TopSecret),
        _ => None,
    };
    if classification.is_none() || field(r, 9) == "-" {
        out.review_flag("security_review")?;
    }
    let year = at.as_ref().and_then(|t| t.as_str()[..4].parse().ok());
    out.header(HeaderInterpretation {
        message_type: "MOVEREP".into(),
        originator: field(r, 4),
        serial: present(field(r, 5)),
        issued_at: at,
        security: Security {
            policy: field(r, 9),
            classification,
            release_to: field(r, 11)
                .split_whitespace()
                .filter(|s| *s != "-")
                .map(str::to_owned)
                .collect(),
            status: if classification.is_some() {
                SecurityStatus::Unvalidated
            } else {
                SecurityStatus::Conflict
            },
        },
    })?;
    Ok(year)
}
fn evidence(
    r: &RecordView<'_>,
    profile: &str,
    subject: Option<&str>,
    companions: &[&RecordView<'_>],
    detail: Value,
) -> AuditEntry {
    let span = |r: &RecordView<'_>| json!({"start_byte":r.span.start,"end_byte":r.span.end,"representation":"decoded_utf8_body","set_id":r.set_id,"record_sequence":r.sequence});
    let payload = json!({"rule_id":"moverep.c350.v1","rule_revision":"1","profile":profile,"inferred":profile==EXAMPLES,
        "record_sequence":r.sequence,"set_id":r.set_id,
        "source_reference":"2003 USMTF C350 pp.465-467, MARACT pp.2152-2153, TASKORG p.2935, SAIL p.2728; Message Examples p.205",
        "span":span(r),"companions":companions.iter().map(|r| span(r)).collect::<Vec<_>>(),"detail":detail});
    AuditEntry {
        kind: if subject.is_some() {
            "fact_interpreted"
        } else {
            "record_interpreted"
        }
        .into(),
        subject_id: subject.map(str::to_owned),
        payload: payload.as_object().cloned().unwrap_or_default(),
    }
}
fn geo_positions(
    r: &RecordView<'_>,
    p: &str,
    context: &ParseContext<'_>,
    count: &mut usize,
    out: &mut dyn ParseSink,
) -> Result<(), ParseFailure> {
    let fields: Vec<usize> = match r.set_id {
        "MARACT" => vec![4],
        "SAIL" | "FYPOS" => vec![2],
        "ROUTE" | "AREA" => (1..=r.fields.len()).collect(),
        _ => return Ok(()),
    };
    for field_number in fields {
        let raw = field(r, field_number);
        // Source place names remain names; only coordinate-shaped source fields
        // can yield map geometry. ROUTE fields are separate points until reviewed.
        if !raw.as_bytes().first().is_some_and(u8::is_ascii_digit)
            || !raw.contains(['N', 'S'])
            || !raw.contains(['E', 'W'])
        {
            continue;
        }
        context.budget.checkpoint(raw.len() as u64)?;
        if *count >= 256 {
            return Err(ParseFailure::new(
                ErrorKind::ResourceLimit,
                "movement_location_count",
            ));
        }
        *count += 1;
        let parsed = point(&raw).ok();
        let label = match r.set_id {
            "MARACT" => "Movement location".to_owned(),
            "SAIL" => "Sailing location".to_owned(),
            "FYPOS" => "Reported unit position".to_owned(),
            "ROUTE" => format!("Route position {field_number}"),
            _ => format!("Area vertex {field_number}"),
        };
        let location = Location {
            id: format!("g{count}"),
            kind: LocationType::Position,
            label,
            datum: "WGS84".into(),
            datum_source: LocationDatumSource::Default,
            status: if parsed.is_some() {
                LocationStatus::Inferred
            } else {
                LocationStatus::Unresolved
            },
            point: parsed,
            shape: None,
            radius_m: None,
            scope: None,
        };
        location.validate()?;
        if location.status == LocationStatus::Unresolved {
            out.review_flag("geospatial_review")?;
        }
        out.audit(evidence(
            r,
            p,
            Some(&location.id),
            &[],
            json!({
                "disposition":"source_coordinate", "field_position":field_number,
                "raw":raw, "datum_basis":"default_wgs84", "geometry_status":location.status,
            }),
        ))?;
        out.location(location)?;
    }
    Ok(())
}
fn temporal(
    map: &mut Map<String, Value>,
    prefix: &str,
    raw: &str,
    year: Option<i32>,
    verified_required: bool,
) -> bool {
    let set_unresolved = |map: &mut Map<String, Value>| {
        map.insert(format!("{prefix}_label"), json!(raw));
        map.insert(format!("{prefix}_status"), json!("unresolved"));
    };
    if !raw.is_ascii() || !matches!(raw.len(), 7 | 8 | 10 | 11) {
        set_unresolved(map);
        return false;
    }
    let bytes = raw.as_bytes();
    if !bytes[..6].iter().all(u8::is_ascii_digit) || bytes[6] != b'Z' {
        set_unresolved(map);
        return false;
    }
    let day = raw[..2].parse::<u32>().ok();
    let hour = raw[2..4].parse::<u32>().ok();
    let minute = raw[4..6].parse::<u32>().ok();
    if day.is_none_or(|v| !(1..=31).contains(&v))
        || hour.is_none_or(|v| v > 23)
        || minute.is_none_or(|v| v > 59)
    {
        set_unresolved(map);
        return false;
    }
    let verified = matches!(raw.len(), 8 | 11);
    if verified_required && !verified {
        set_unresolved(map);
        return false;
    }
    if verified
        && (!bytes[7].is_ascii_digit()
            || bytes[..6].iter().map(|v| (v - b'0') as u32).sum::<u32>() % 10
                != (bytes[7] - b'0') as u32)
    {
        set_unresolved(map);
        return false;
    }
    let month = if raw.len() >= 10 {
        let index = if verified { 8 } else { 7 };
        [
            "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
        ]
        .iter()
        .position(|m| *m == &raw[index..index + 3])
        .map(|n| n as u32 + 1)
    } else {
        None
    };
    if raw.len() >= 10 && month.is_none() {
        set_unresolved(map);
        return false;
    }
    let day = day.unwrap();
    if let Some(month) = month {
        if NaiveDate::from_ymd_opt(year.unwrap_or(2000), month, day).is_none() {
            set_unresolved(map);
            return false;
        }
        if let Some(year) = year {
            map.insert(
                format!("{prefix}_at"),
                json!(format!(
                    "{year:04}-{month:02}-{day:02}T{:02}:{:02}:00Z",
                    hour.unwrap(),
                    minute.unwrap()
                )),
            );
            return true;
        }
        map.insert(format!("{prefix}_label"), json!(raw));
        map.insert(format!("{prefix}_status"), json!("missing_year"));
    } else {
        map.insert(format!("{prefix}_label"), json!(raw));
        map.insert(format!("{prefix}_status"), json!("missing_month_and_year"));
    }
    false
}
fn maract(
    r: &RecordView<'_>,
    p: &str,
    year: Option<i32>,
    references: &[String],
) -> Result<(Map<String, Value>, bool), ParseFailure> {
    arity(r, 3, 8)?;
    let action = field(r, 1);
    let activity = field(r, 2);
    if !["REQUEST", "INTEND", "ORDER", "APPROVE", "REPORT"].contains(&action.as_str())
        || ![
            "ANCHOR", "ARRIVE", "CHOP", "DETACH", "JOIN", "MODIN", "MODOUT", "DEPART", "MOOR",
            "OPCMD", "OTR", "TRANSIT", "MODLOC", "RNDZV", "NAVPIM",
        ]
        .contains(&activity.as_str())
    {
        return Err(bad("moverep_maract_code", r));
    }
    let location = present(field(r, 4));
    if [
        "ANCHOR", "ARRIVE", "RNDZV", "JOIN", "MOOR", "MODLOC", "DEPART",
    ]
    .contains(&activity.as_str())
        && location.is_none()
    {
        return Err(bad("moverep_location_required", r));
    }
    for (n, needed) in [
        (5, activity == "CHOP"),
        (6, activity == "OPCMD"),
        (7, activity == "DETACH" || activity == "JOIN"),
    ] {
        if present(field(r, n)).is_some() != needed {
            return Err(bad("moverep_control_layout", r));
        }
    }
    let mut v = Map::from_iter([
        ("kind".into(), json!("activity")),
        ("action".into(), json!(action)),
        ("activity".into(), json!(activity)),
        ("references".into(), json!(references)),
    ]);
    for (key, value) in [
        ("location", location),
        ("operational_control_authority", present(field(r, 5))),
        ("operational_command", present(field(r, 6))),
        ("tactical_control_authority", present(field(r, 7))),
        ("mission_designator", present(field(r, 8))),
    ] {
        if let Some(value) = value {
            v.insert(key.into(), json!(value));
        }
    }
    let resolved = temporal(&mut v, "effective", &field(r, 3), year, p == BASELINE);
    Ok((v, resolved))
}

impl MessageParser for MoverepParser {
    fn descriptor(&self) -> &'static ParserDescriptor {
        &DESCRIPTOR
    }
    fn assess(&self, input: &MessageView<'_>) -> MatchOutcome {
        profile(input).map_or(MatchOutcome::Unsupported, |profile| {
            MatchOutcome::Applicable {
                profile,
                rule: "moverep.header_signature.v1",
            }
        })
    }
    fn parse(
        &self,
        input: &MessageView<'_>,
        context: &ParseContext<'_>,
        out: &mut dyn ParseSink,
    ) -> Result<ParseSummary, ParseFailure> {
        let p = profile(input).ok_or(ParseFailure::new(
            ErrorKind::UnsupportedProfile,
            "moverep_profile",
        ))?;
        let h = input
            .records
            .iter()
            .position(|r| r.set_id == "MSGID")
            .ok_or(ParseFailure::new(
                ErrorKind::MalformedInput,
                "missing_msgid",
            ))?;
        if h > 1
            || input.records[..h]
                .iter()
                .any(|r| !matches!(r.set_id, "EXER" | "OPER"))
            || input.records[h + 1..]
                .iter()
                .any(|r| matches!(r.set_id, "EXER" | "OPER" | "MSGID"))
        {
            return Err(ParseFailure::new(
                ErrorKind::InvalidValue,
                "moverep_preamble",
            ));
        }
        let year = header(&input.records[h], p, context, out)?;
        if p == EXAMPLES {
            out.review_flag("inferred_profile")?;
        }
        out.audit(evidence(
            &input.records[h],
            p,
            None,
            &[],
            json!({"disposition":"header"}),
        ))?;
        let mut references = Vec::<String>::new();
        let mut movement: Option<(usize, Map<String, Value>, Vec<usize>)> = None;
        let mut count = 0usize;
        let mut location_count = 0usize;
        let mut canx: Option<usize> = None;
        let mut partial = false;
        for (i, r) in input.records.iter().enumerate() {
            context.budget.checkpoint(1 + r.fields.len() as u64)?;
            if i <= h {
                continue;
            }
            match r.set_id {
                "REF" => {
                    if movement.is_some() || canx.is_some() {
                        return Err(bad("moverep_ref_order", r));
                    }
                    arity(r, 4, 16)?;
                    let label = r
                        .fields
                        .iter()
                        .map(|f| f.normalized().into_owned())
                        .collect::<Vec<_>>()
                        .join("/");
                    if references.contains(&label) {
                        return Err(bad("moverep_duplicate_ref", r));
                    }
                    references.push(label);
                    out.audit(evidence(
                        r,
                        p,
                        None,
                        &[],
                        json!({"disposition":"reference"}),
                    ))?;
                }
                "CANX" => {
                    if canx.is_some() || movement.is_some() || references.is_empty() {
                        return Err(bad("moverep_canx_layout", r));
                    }
                    arity(r, 3, 16)?;
                    canx = Some(i);
                }
                "MARACT" => {
                    if canx.is_some() {
                        return Err(bad("moverep_canx_maract_conflict", r));
                    }
                    if let Some(previous) = movement.take() {
                        emit(previous, input, p, &mut count, out)?;
                    }
                    let (value, resolved) = maract(r, p, year, &references)?;
                    if !resolved {
                        out.review_flag("movement_time_review")?;
                    }
                    movement = Some((i, value, Vec::new()));
                }
                "TASKORG" => {
                    let Some((_, value, companions)) = movement.as_mut() else {
                        return Err(bad("moverep_taskorg_without_maract", r));
                    };
                    if value.contains_key("unit_names") {
                        return Err(bad("moverep_duplicate_taskorg", r));
                    }
                    arity(r, 4, r.fields.len().min(64))?;
                    if let Some(name) = present(field(r, 1)) {
                        value.insert("task_org".into(), json!(name));
                    }
                    let mut units = Vec::new();
                    for f in r.fields.iter().skip(3) {
                        if let Some(name) = present(f.normalized().into_owned())
                            && !units.contains(&name)
                        {
                            units.push(name);
                        }
                    }
                    if units.is_empty() {
                        out.review_flag("movement_unit_review")?;
                    }
                    value.insert("unit_names".into(), json!(units));
                    companions.push(i);
                    out.audit(evidence(
                        r,
                        p,
                        None,
                        &[],
                        json!({"disposition":"task_organization"}),
                    ))?;
                }
                "SAIL" => {
                    let Some((_, value, companions)) = movement.as_mut() else {
                        return Err(bad("moverep_sail_without_maract", r));
                    };
                    if value.contains_key("sail_location") {
                        partial = true;
                        out.review_flag("movement_sail_review")?;
                        out.audit(evidence(
                            r,
                            p,
                            None,
                            &[],
                            json!({"disposition":"additional_sail_preserved"}),
                        ))?;
                        continue;
                    }
                    arity(r, 2, 3)?;
                    let location = present(field(r, 2)).ok_or(bad("moverep_sail_location", r))?;
                    value.insert("sail_location".into(), json!(location));
                    if !temporal(value, "sail_arrival", &field(r, 1), year, false) {
                        out.review_flag("movement_time_review")?;
                    }
                    if let Some(departure) = present(field(r, 3)) {
                        if !temporal(value, "sail_departure", &departure, year, false) {
                            out.review_flag("movement_time_review")?;
                        }
                    }
                    companions.push(i);
                    out.audit(evidence(r, p, None, &[], json!({"disposition":"sailing"})))?;
                }
                "AMPN" | "POC" | "DECL" | "SPECGRU" | "FYPOS" | "ROUTE" | "SOA" | "AREA"
                | "EPREQ" | "LIMITS" | "POST" | "BDCT" | "BDCTNUM" | "COMMS" | "LQDSTAT"
                | "SHORNAV" | "METEO" | "AKNLDG" | "RMKS" => {
                    partial = true;
                    out.audit(evidence(
                        r,
                        p,
                        None,
                        &[],
                        json!({"disposition":"preserved_unprojected"}),
                    ))?;
                }
                _ => {
                    partial = true;
                    out.review_flag("movement_record_review")?;
                    out.audit(evidence(
                        r,
                        p,
                        None,
                        &[],
                        json!({"disposition":"unknown_set"}),
                    ))?;
                }
            }
            geo_positions(r, p, context, &mut location_count, out)?;
        }
        if let Some(previous) = movement.take() {
            emit(previous, input, p, &mut count, out)?;
        }
        if let Some(i) = canx {
            if count != 0 {
                return Err(bad("moverep_canx_maract_conflict", &input.records[i]));
            }
            count += 1;
            let r = &input.records[i];
            let cancellation = r
                .fields
                .iter()
                .map(|f| f.normalized().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            let mut value = json!({"id":format!("m{count}"),"kind":"cancellation","references":references,"cancellation":cancellation,
                "cancelled_type":field(r,1),"cancelled_originator":field(r,2),"cancelled_date_label":field(r,3)});
            if let Some(serial) = present(field(r, 4)) {
                value["cancelled_serial"] = json!(serial);
            }
            let fact: Movement =
                serde_json::from_value(value).map_err(|_| bad("moverep_canx_value", r))?;
            fact.validate()?;
            out.audit(evidence(
                r,
                p,
                Some(&fact.id),
                &[],
                json!({"disposition":"unresolved_cancellation"}),
            ))?;
            out.movement(fact)?;
            out.review_flag("movement_lineage_review")?;
        }
        if count == 0 {
            return Err(ParseFailure::new(
                ErrorKind::InvalidValue,
                "moverep_missing_maract_or_canx",
            ));
        }
        if !references.is_empty() {
            out.review_flag("movement_lineage_review")?;
        }
        out.review_flag("movement_review")?;
        if partial {
            out.review_flag("partial_interpretation")?;
        }
        Ok(ParseSummary {
            profile: p,
            completeness: if partial {
                Completeness::Partial
            } else {
                Completeness::Complete
            },
        })
    }
}

fn emit(
    previous: (usize, Map<String, Value>, Vec<usize>),
    input: &MessageView<'_>,
    p: &str,
    count: &mut usize,
    out: &mut dyn ParseSink,
) -> Result<(), ParseFailure> {
    let (i, mut value, companions) = previous;
    let r = &input.records[i];
    if !value.contains_key("unit_names") {
        return Err(bad("moverep_taskorg_required", r));
    }
    if *count >= 64 {
        return Err(ParseFailure::new(
            ErrorKind::ResourceLimit,
            "movement_count",
        ));
    }
    *count += 1;
    value.insert("id".into(), json!(format!("m{count}")));
    let fact: Movement =
        serde_json::from_value(Value::Object(value)).map_err(|_| bad("moverep_maract_value", r))?;
    fact.validate()?;
    let related = companions
        .iter()
        .map(|i| &input.records[*i])
        .collect::<Vec<_>>();
    out.audit(evidence(
        r,
        p,
        Some(&fact.id),
        &related,
        json!({"disposition":"source_candidate","time_resolution":fact.effective_at.as_ref().map(|at|json!({
            "rule":"source_issue_year_for_month_day_zulu","year_source":"source_issue_timestamp",
            "applied_year":&at.as_str()[..4]}))}),
    ))?;
    out.movement(fact)
}
