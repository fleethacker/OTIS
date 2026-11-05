//! Transport-independent CASREP support; GENADMIN is a separate message family.
use chrono::NaiveDate;
use parse_command_parser_api::*;
use parse_command_types::*;
use serde_json::{Value, json};
pub const BASELINE: &str = "usmtf-2003-casrep-v1";
pub const EXAMPLES: &str = "observed-casrep-b10112-v1";
pub struct CasrepParser;
static DESCRIPTOR: ParserDescriptor = ParserDescriptor {
    id: "casrep",
    version: "0.1.0",
    icd_major: ICD_MAJOR,
    message_types: &["CASREP"],
    profiles: &[BASELINE, EXAMPLES],
    fact_categories: &[FactCategory::Casualty],
};
fn bad(code: &'static str) -> ParseFailure {
    ParseFailure::new(ErrorKind::InvalidValue, code)
}
fn field(r: &RecordView<'_>, n: usize) -> String {
    r.fields
        .get(n - 1)
        .map(|f| f.normalized().into_owned())
        .unwrap_or_default()
}
fn arity(r: &RecordView<'_>, min: usize, max: usize) -> Result<(), ParseFailure> {
    if !(min..=max).contains(&r.fields.len()) || !r.rows.is_empty() {
        return Err(bad("casrep_record_layout").at(r.span.start));
    }
    Ok(())
}
fn optional(v: &mut Value, key: &str, s: String) {
    if !s.is_empty() && s != "-" {
        v[key] = json!(s);
    }
}
fn untag(r: &RecordView<'_>, n: usize, prefix: &str) -> Result<String, ParseFailure> {
    field(r, n)
        .strip_prefix(prefix)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .ok_or(bad("casrep_field_designator").at(r.span.start))
}
fn profile(input: &MessageView<'_>) -> Option<&'static str> {
    if input.message_type != "CASREP" {
        return None;
    }
    let h = input.records.iter().find(|r| r.set_id == "MSGID")?;
    let second = field(h, 2);
    if second == "MIL-STD-6040(SERIES)" {
        return (arity(h, 10, 11).is_ok() && field(h, 3) == "B.1.01.12").then_some(EXAMPLES);
    }
    (!second.starts_with("MIL-STD") && arity(h, 2, 6).is_ok()).then_some(BASELINE)
}
fn timestamp(label: &str) -> Option<UtcTimestamp> {
    chrono::NaiveDateTime::parse_from_str(label, "%Y%m%dT%H%M%SZ")
        .ok()
        .and_then(|dt| UtcTimestamp::new(dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()).ok())
}
fn audit(r: &RecordView<'_>, p: &str, subject: Option<&str>) -> AuditEntry {
    let value = json!({"rule_id":"casrep.set.v1","rule_revision":"1","profile":p,"inferred":p==EXAMPLES,
        "source_reference":"2003 USMTF C303; USMTF Message Examples p.52","record_sequence":r.sequence,"set_id":r.set_id,
        "span":{"start_byte":r.span.start,"end_byte":r.span.end,"representation":"decoded_utf8_body"},
        "fields":r.fields.iter().map(|f|json!({"position":f.position,"start_byte":f.span.start,"end_byte":f.span.end})).collect::<Vec<_>>()});
    AuditEntry {
        kind: if subject.is_some() {
            "fact_interpreted"
        } else {
            "record_interpreted"
        }
        .into(),
        subject_id: subject.map(str::to_owned),
        payload: value.as_object().cloned().unwrap_or_default(),
    }
}
fn header(
    r: &RecordView<'_>,
    p: &str,
    c: &ParseContext<'_>,
    out: &mut dyn ParseSink,
) -> Result<(), ParseFailure> {
    if p == BASELINE {
        out.review_flag("issue_time_review")?;
        return out.header(HeaderInterpretation {
            message_type: "CASREP".into(),
            originator: field(r, 2),
            serial: (!field(r, 3).is_empty() && field(r, 3) != "-").then(|| field(r, 3)),
            issued_at: None,
            security: c
                .security_override
                .cloned()
                .ok_or(bad("baseline_security_context_required"))?,
        });
    }
    let issued_at = timestamp(&field(r, 6));
    if issued_at.is_none() {
        out.review_flag("issue_time_review")?;
    }
    let classification = match field(r, 10).as_str() {
        "UNCLASSIFIED" => Some(SecurityClassification::Unclassified),
        "CONFIDENTIAL" => Some(SecurityClassification::Confidential),
        "SECRET" => Some(SecurityClassification::Secret),
        "TOP SECRET" => Some(SecurityClassification::TopSecret),
        _ => None,
    };
    let policy = field(r, 9);
    if classification.is_none() || policy == "-" {
        out.review_flag("security_review")?;
    }
    out.header(HeaderInterpretation {
        message_type: "CASREP".into(),
        originator: field(r, 4),
        serial: (field(r, 5) != "-").then(|| field(r, 5)),
        issued_at,
        security: Security {
            policy,
            classification,
            release_to: field(r, 11)
                .split_whitespace()
                .filter(|v| *v != "-")
                .map(str::to_owned)
                .collect(),
            status: if classification.is_some() {
                SecurityStatus::Unvalidated
            } else {
                SecurityStatus::Conflict
            },
        },
    })
}
fn push(v: &mut Value, key: &str, item: Value) -> Result<(), ParseFailure> {
    v[key]
        .as_array_mut()
        .ok_or(bad("casrep_internal_shape"))?
        .push(item);
    Ok(())
}
impl MessageParser for CasrepParser {
    fn descriptor(&self) -> &'static ParserDescriptor {
        &DESCRIPTOR
    }
    fn assess(&self, input: &MessageView<'_>) -> MatchOutcome {
        profile(input).map_or(MatchOutcome::Unsupported, |p| MatchOutcome::Applicable {
            profile: p,
            rule: "casrep.header_signature.v1",
        })
    }
    fn parse(
        &self,
        input: &MessageView<'_>,
        context: &ParseContext<'_>,
        out: &mut dyn ParseSink,
    ) -> Result<ParseSummary, ParseFailure> {
        let p = profile(input).ok_or(bad("casrep_profile"))?;
        let h = input
            .records
            .iter()
            .position(|r| r.set_id == "MSGID")
            .ok_or(bad("missing_msgid"))?;
        if h > 1
            || input.records[..h]
                .iter()
                .any(|r| !matches!(r.set_id, "EXER" | "OPER"))
        {
            return Err(bad("casrep_preamble"));
        }
        for r in &input.records[..h] {
            arity(r, 1, if r.set_id == "OPER" { 5 } else { 2 })?;
        }
        if input.records[h + 1..]
            .iter()
            .any(|r| matches!(r.set_id, "EXER" | "OPER"))
        {
            return Err(bad("casrep_preamble"));
        }
        header(&input.records[h], p, context, out)?;
        if p == EXAMPLES {
            out.review_flag("inferred_profile")?;
        }
        let mut casualty: Option<Value> = None;
        let mut partial = false;
        let mut estimate = false;
        let mut correction = false;
        let mut required_narrative: Option<&str> = None;
        let mut phase = 0;
        let mut technical = false;
        let mut poc = false;
        let mut declaration = false;
        for r in input.records {
            context.budget.checkpoint(1 + r.fields.len() as u64)?;
            if r.set_id == "GENTEXT" && rank(r).is_none() {
                partial = true;
                out.review_flag("unprojected_casrep_set")?;
            }
            if let Some(rank) = rank(r) {
                if rank < phase {
                    return Err(bad("casrep_set_order").at(r.span.start));
                }
                phase = rank;
            }
            if r.set_id == "POC" {
                if poc {
                    return Err(bad("casrep_duplicate_poc"));
                }
                poc = true;
            }
            if r.set_id == "DECL" {
                if declaration {
                    return Err(bad("casrep_duplicate_decl"));
                }
                declaration = true;
                out.review_flag("security_review")?;
            }

            if let Some(subject) = required_narrative.take() {
                if r.set_id != "GENTEXT" || field(r, 1) != subject {
                    return Err(bad("casrep_required_narrative").at(r.span.start));
                }
            }
            if r.set_id == "CASLTY" {
                if casualty.is_some() {
                    return Err(bad("casrep_duplicate_caslty"));
                }
                arity(r, 9, r.fields.len().max(9))?;
                let mut v = json!({"id":"q1","report_type":field(r,1),"serial":field(r,2),"equipment":field(r,4),"eic":untag(r,5,"EIC:")?,"category":untag(r,6,"CAT:")?,"cause":untag(r,7,"CAUSE:")?,"reporting_uic":field(r,8),"assistance":[],"technical_data":[],"parts":[],"requisitions":[],"receipts":[],"narratives":[]});
                optional(&mut v, "update_sequence", field(r, 3));
                optional(&mut v, "initial_report_label", field(r, 9));
                optional(&mut v, "fleet", field(r, 10));
                let ids = r
                    .fields
                    .iter()
                    .skip(10)
                    .map(|f| {
                        f.normalized()
                            .strip_prefix("CIN:")
                            .filter(|v| !v.is_empty())
                            .map(str::to_owned)
                            .ok_or(bad("casrep_cin"))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                if !ids.is_empty() {
                    v["casualty_identifiers"] = json!(ids);
                }
                casualty = Some(v);
            } else if matches!(r.set_id, "EXER" | "OPER" | "MSGID" | "REF" | "POC" | "DECL") {
                if matches!(r.set_id, "REF" | "POC" | "DECL") {
                    partial = true;
                }
            } else {
                let v = casualty.as_mut().ok_or(bad("casrep_set_before_caslty"))?;
                match r.set_id {
                    "ESTIMATE" => {
                        arity(r, 1, 3)?;
                        if estimate {
                            return Err(bad("casrep_duplicate_estimate"));
                        }
                        estimate = true;
                        let source = field(r, 1);
                        if source.len() != 8 || !source.bytes().all(|b| b.is_ascii_digit()) {
                            return Err(bad("casrep_estimate_date"));
                        }
                        let date = NaiveDate::parse_from_str(&source, "%Y%m%d")
                            .map_err(|_| bad("casrep_estimate_date"))?;
                        v["repair_estimate_date"] = json!(date.format("%Y-%m-%d").to_string());
                        optional(v, "repair_estimate_comments", field(r, 2));
                        optional(v, "repair_requirement_status", field(r, 3));
                        if let Some(issue) = timestamp(&field(&input.records[h], 6)) {
                            if v["repair_estimate_date"]
                                .as_str()
                                .is_some_and(|date| date < &issue.as_str()[..10])
                            {
                                out.review_flag("casualty_time_conflict")?;
                            }
                        }
                    }
                    "ASSIST" => {
                        arity(r, 2, 4)?;
                        let mut a = json!({"action":field(r,1),"kind":field(r,2)});
                        optional(&mut a, "location", field(r, 3));
                        optional(&mut a, "coordinates", field(r, 4));
                        if matches!(field(r, 2).as_str(), "TECHNICAL" | "OTHER") {
                            required_narrative = Some("ASSIST");
                        }
                        push(v, "assistance", a)?;
                    }
                    "TECHDATA" => {
                        arity(r, 6, r.fields.len().max(6))?;
                        if technical {
                            return Err(bad("casrep_duplicate_techdata"));
                        }
                        technical = true;
                        if r.fields.len() > 4 && (r.fields.len() - 4) % 2 != 0 {
                            return Err(bad("casrep_publication_pair"));
                        }
                        let mut t = json!({"action":field(r,1),"allowance_list":field(r,2),"publications":[]});
                        if !field(r, 3).is_empty() && field(r, 3) != "-" {
                            t["component_id"] = json!(untag(r, 3, "CID:")?);
                        }
                        if !field(r, 4).is_empty() && field(r, 4) != "-" {
                            t["job_control_number"] = json!(untag(r, 4, "JCN:")?);
                        }
                        for pair in r.fields.iter().skip(4).collect::<Vec<_>>().chunks(2) {
                            push(
                                &mut t,
                                "publications",
                                json!({"publication":pair[0].normalized(),"availability":pair[1].normalized()}),
                            )?;
                        }
                        if matches!(field(r, 2).as_str(), "NOLIST:UNK" | "NOLIST:NOT LISTED") {
                            required_narrative = Some("TECHDATA");
                        }
                        push(v, "technical_data", t)?;
                    }
                    "PARTS" => {
                        arity(r, 8, 11)?;
                        let mut part = json!({"sequence":field(r,1),"stock_reference":field(r,2),"stock_number":field(r,3),"quantity_required":field(r,4),"allowance":field(r,5),"quantity_onboard":field(r,6),"not_in_stock":field(r,7),"not_carried":field(r,8)});
                        optional(&mut part, "circuit", field(r, 9));
                        optional(&mut part, "material_control", field(r, 10));
                        optional(&mut part, "special_material", field(r, 11));
                        if field(r, 7) == "H"
                            && ["B", "C", "D", "F"].contains(&field(r, 8).as_str())
                        {
                            required_narrative = Some("PARTS");
                        }
                        push(v, "parts", part)?;
                    }
                    "REQNDATA" => {
                        arity(r, 8, 9)?;
                        let mut req = json!({"parts_sequence":field(r,1),"number":field(r,2),"quantity":field(r,3),"priority":field(r,4),"project":field(r,5),"required_date":field(r,6),"routing":field(r,7)});
                        optional(&mut req, "status", field(r, 8));
                        optional(&mut req, "issued_label", field(r, 9));
                        push(v, "requisitions", req)?;
                    }
                    "RCPTDATA" => {
                        arity(r, 6, 6)?;
                        push(
                            v,
                            "receipts",
                            json!({"parts_sequence":field(r,1),"number":field(r,2),"received_date":field(r,3),"satisfaction_code":field(r,4),"quantity":field(r,5),"satisfaction_designator":field(r,6)}),
                        )?;
                        if field(r, 4) == "Z" {
                            required_narrative = Some("RCPTDATA");
                        }
                    }
                    "CORRSTAT" => {
                        arity(r, 4, 4)?;
                        if correction {
                            return Err(bad("casrep_duplicate_corrstat"));
                        }
                        correction = true;
                        v["correction"] = json!({"hours_between_failures":untag(r,1,"HRFAIL:")?,"usage_code":field(r,2),"hours_repair":untag(r,3,"HREPAIR:")?,"hours_waiting_parts":untag(r,4,"HRPARTS:")?});
                    }
                    "GENTEXT" => {
                        arity(r, 2, 2)?;
                        push(
                            v,
                            "narratives",
                            json!({"subject":field(r,1),"text":field(r,2)}),
                        )?;
                    }
                    _ => {
                        partial = true;
                        out.review_flag("unprojected_casrep_set")?;
                    }
                }
            }
            out.audit(audit(
                r,
                p,
                matches!(
                    r.set_id,
                    "CASLTY"
                        | "ESTIMATE"
                        | "ASSIST"
                        | "TECHDATA"
                        | "PARTS"
                        | "REQNDATA"
                        | "RCPTDATA"
                        | "CORRSTAT"
                        | "GENTEXT"
                )
                .then_some("q1"),
            ))?;
        }
        if required_narrative.is_some() {
            return Err(bad("casrep_required_narrative"));
        }
        let value: Casualty = serde_json::from_value(casualty.ok_or(bad("casrep_missing_caslty"))?)
            .map_err(|_| bad("casrep_field_value"))?;
        value.validate()?;
        for req in &value.requisitions {
            if !value
                .parts
                .iter()
                .any(|part| part.sequence == req.parts_sequence)
            {
                out.review_flag("casualty_parts_reference_review")?;
            }
        }
        if value.report_type != CasualtyReportType::Initial {
            out.review_flag("casualty_lineage_review")?;
        }
        let mut value = value;
        let mut identifiers = std::collections::BTreeSet::from([
            value.serial.clone(),
            value.reporting_uic.clone(),
            value.eic.clone(),
        ]);
        identifiers.extend(value.casualty_identifiers.iter().cloned());
        for part in &value.parts {
            identifiers.insert(
                part.stock_number
                    .split_once(':')
                    .map_or(part.stock_number.as_str(), |(_, v)| v)
                    .to_owned(),
            );
        }
        for req in &value.requisitions {
            identifiers.insert(
                req.number
                    .split_once(':')
                    .map_or(req.number.as_str(), |(_, v)| v)
                    .to_owned(),
            );
        }
        value.identifiers = identifiers.into_iter().collect();
        out.review_flag("casualty_review")?;
        out.casualty(value)?;
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

fn rank(r: &RecordView<'_>) -> Option<u8> {
    Some(match r.set_id {
        "EXER" => 1,
        "OPER" => 2,
        "MSGID" => 3,
        "REF" => 4,
        "POC" => 5,
        "CASLTY" => 6,
        "ESTIMATE" => 8,
        "ASSIST" => 9,
        "TECHDATA" => 11,
        "PARTS" => 13,
        "REQNDATA" => 15,
        "RCPTDATA" => 16,
        "CORRSTAT" => 18,
        "DECL" => 22,
        "GENTEXT" => match field(r, 1).as_str() {
            "CASLTY" => 7,
            "ASSIST" => 9,
            "TECHDATA" => 11,
            "PARTS" => 13,
            "RCPTDATA" => 16,
            "IMPACT" => 19,
            "OPSKED" => 20,
            "CO COMMENTS" => 21,
            _ => return None,
        },
        _ => return None,
    })
}
