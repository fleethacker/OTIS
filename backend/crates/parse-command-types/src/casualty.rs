//! CASREP wire validation. All quantities/identifiers retain their source spelling.
use super::*;
fn sized(value: &str, min: usize, max: usize, numeric: bool) -> Result<(), ValidationError> {
    if !(min..=max).contains(&value.len())
        || (numeric && !value.bytes().all(|b| b.is_ascii_digit()))
        || value.chars().any(char::is_control)
    {
        return Err(invalid("casualty", "field_format"));
    }
    Ok(())
}
fn tagged(value: &str, tags: &[&str]) -> Result<(), ValidationError> {
    if !tags
        .iter()
        .any(|tag| value.strip_prefix(tag).is_some_and(|v| !v.is_empty()))
    {
        return Err(invalid("casualty", "field_designator"));
    }
    Ok(())
}
impl Casualty {
    pub(crate) fn validate_semantics(&self) -> Result<(), ValidationError> {
        validate_subject_id(&self.id, Some(b'q'), "casualty.id")?;
        sized(&self.serial, 7, 7, true)?;
        sized(&self.reporting_uic, 6, 6, false)?;
        sized(&self.equipment, 1, 30, false)?;
        sized(&self.eic, 4, 7, false)?;
        sized(&self.cause, 1, 1, false)?;
        if !self
            .cause
            .bytes()
            .all(|b| b"123456789ABCDEFGHJKLMNOPQRSTUVWXYZ".contains(&b))
        {
            return Err(invalid("casualty.cause", "code"));
        }
        if !self
            .reporting_uic
            .bytes()
            .chain(self.eic.bytes())
            .all(|b| b.is_ascii_alphanumeric())
            || !["1", "2", "3", "4"].contains(&self.category.as_str())
        {
            return Err(invalid("casualty", "code"));
        }
        if (self.report_type == CasualtyReportType::Update) != self.update_sequence.is_some()
            || (self.report_type != CasualtyReportType::Initial)
                != self.initial_report_label.is_some()
        {
            return Err(invalid("casualty", "conditional_reference"));
        }
        if let Some(value) = &self.update_sequence {
            sized(value, 2, 2, true)?;
        }
        if let Some(value) = &self.initial_report_label {
            sized(value, 14, 14, false)?;
        }
        if let Some(value) = &self.fleet {
            sized(value, 1, 1, false)?;
            if !value.bytes().all(|b| b.is_ascii_alphanumeric()) {
                return Err(invalid("casualty.fleet", "code"));
            }
        }
        if let Some(value) = &self.repair_estimate_comments {
            sized(value, 1, 39, false)?;
        }
        if let Some(value) = &self.repair_requirement_status {
            sized(value, 5, 5, false)?;
        }
        for value in &self.casualty_identifiers {
            sized(value, 1, 10, false)?;
        }
        if let Some(value) = &self.repair_estimate_date {
            if chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err() || value.len() != 10 {
                return Err(invalid("casualty.repair_estimate_date", "date_only"));
            }
        }
        let open = matches!(
            self.report_type,
            CasualtyReportType::Initial | CasualtyReportType::Update
        );
        if open != self.repair_estimate_date.is_some()
            || (self.report_type == CasualtyReportType::Correct) != self.correction.is_some()
            || (!open
                && (self.repair_estimate_comments.is_some()
                    || self.repair_requirement_status.is_some()))
        {
            return Err(invalid("casualty", "conditional_set"));
        }
        let has = |subject: &str| self.narratives.iter().any(|v| v.subject == subject);
        if (self.report_type == CasualtyReportType::Initial
            && (self.assistance.is_empty()
                || self.technical_data.is_empty()
                || !has("IMPACT")
                || !has("CO COMMENTS")))
            || (open && !has("OPSKED"))
            || (!open && !has("CASLTY"))
        {
            return Err(invalid("casualty", "mandatory_set"));
        }
        let mut sequences = BTreeSet::new();
        for part in &self.parts {
            if !sequences.insert(&part.sequence) {
                return Err(invalid("casualty.parts", "duplicate_sequence"));
            }
        }
        Ok(())
    }
}
impl CasualtyAssistance {
    pub(crate) fn validate_semantics(&self) -> Result<(), ValidationError> {
        sized(&self.action, 3, 6, false)?;
        sized(&self.kind, 3, 9, false)?;
        if self.kind != "NONE" && self.location.is_none() && self.coordinates.is_none() {
            return Err(invalid("casualty.assistance", "location_required"));
        }
        Ok(())
    }
}
impl CasualtyTechnicalData {
    pub(crate) fn validate_semantics(&self) -> Result<(), ValidationError> {
        sized(&self.action, 3, 4, false)?;
        tagged(&self.allowance_list, &["APL:", "AEL:", "NOLIST:"])?;
        if self.component_id.is_none()
            || self.job_control_number.is_none()
            || self.publications.is_empty()
        {
            return Err(invalid("casualty.technical_data", "mandatory_fields"));
        }
        Ok(())
    }
}
impl CasualtyPublication {
    pub(crate) fn validate_semantics(&self) -> Result<(), ValidationError> {
        tagged(&self.publication, &["TECHPUB:", "NOPUB:"])?;
        tagged(&self.availability, &["PUBAV:"])
    }
}
impl CasualtyPart {
    pub(crate) fn validate_semantics(&self) -> Result<(), ValidationError> {
        sized(&self.sequence, 3, 3, true)?;
        tagged(&self.stock_reference, &["COG:", "CAGE:", "C:"])?;
        tagged(&self.stock_number, &["NSN:", "NICN:", "C:"])?;
        sized(&self.quantity_required, 1, 5, true)?;
        sized(&self.quantity_onboard, 1, 5, true)?;
        tagged(&self.allowance, &["C:", "I:"])?;
        sized(&self.allowance[2..], 1, 5, true)?;
        if self.stock_number.starts_with("NSN:") {
            let groups = self.stock_number[4..].split('-').collect::<Vec<_>>();
            if groups.len() != 4
                || groups
                    .iter()
                    .zip([4, 2, 3, 4])
                    .any(|(g, len)| g.len() != len || !g.bytes().all(|b| b.is_ascii_digit()))
            {
                return Err(invalid("casualty.parts.stock_number", "nsn"));
            }
        }
        sized(&self.not_in_stock, 1, 1, false)?;
        sized(&self.not_carried, 1, 1, false)
    }
}
impl CasualtyRequisition {
    pub(crate) fn validate_semantics(&self) -> Result<(), ValidationError> {
        sized(&self.parts_sequence, 3, 3, true)?;
        tagged(&self.number, &["R:", "S:"])?;
        sized(
            &self.number[2..],
            if self.number.starts_with("R:") {
                16
            } else {
                17
            },
            if self.number.starts_with("R:") {
                16
            } else {
                17
            },
            false,
        )?;
        sized(&self.quantity, 1, 5, true)?;
        sized(&self.priority, 1, 2, true)?;
        sized(&self.project, 3, 3, false)?;
        tagged(&self.required_date, &["J:", "N:", "E:"])?;
        tagged(&self.routing, &["RI:", "NAME:"])
    }
}
impl CasualtyReceipt {
    pub(crate) fn validate_semantics(&self) -> Result<(), ValidationError> {
        sized(&self.parts_sequence, 3, 3, true)?;
        tagged(&self.number, &["R:", "S:"])?;
        sized(
            &self.number[2..],
            if self.number.starts_with("R:") {
                16
            } else {
                17
            },
            if self.number.starts_with("R:") {
                16
            } else {
                17
            },
            false,
        )?;
        sized(&self.received_date, 7, 7, true)?;
        sized(&self.quantity, 1, 5, true)?;
        sized(&self.satisfaction_code, 1, 1, false)?;
        sized(&self.satisfaction_designator, 1, 1, false)
    }
}
impl CasualtyCorrection {
    pub(crate) fn validate_semantics(&self) -> Result<(), ValidationError> {
        sized(&self.hours_between_failures, 1, 5, true)?;
        sized(&self.usage_code, 1, 1, false)?;
        sized(&self.hours_repair, 1, 5, true)?;
        sized(&self.hours_waiting_parts, 1, 5, true)
    }
}
impl CasualtyNarrative {
    pub(crate) fn validate_semantics(&self) -> Result<(), ValidationError> {
        Ok(())
    }
}

impl CasualtySearch {
    pub(crate) fn validate_semantics(&self) -> Result<(), ValidationError> {
        Ok(())
    }
}
