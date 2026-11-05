//! Additive companion facts only. The existing crypto activities are never rewritten.
use super::*;

#[derive(Default)]
pub(super) struct Collector<'a> {
    periods: Vec<(Period, &'a RecordView<'a>, bool)>,
    period_records: usize,
    checks: Vec<(Activity, &'a RecordView<'a>)>,
}
impl<'a> Collector<'a> {
    pub fn record(&mut self, record: &RecordView<'_>, scope: &Scope, profile: Profile) {
        if profile == Profile::Baseline && record.set_id == "PERIOD" && scope.segment.is_none() {
            self.period_records += 1;
        }
    }
    pub fn observe(&mut self, fact: &Fact, record: &'a RecordView<'a>, profile: Profile) {
        if profile != Profile::Baseline {
            return;
        }
        match fact {
            Fact::Period(period) if period.scope.is_none() => {
                // Do not turn the approved receipt-year default into a recurrence anchor.
                // Both bounds must come from complete source tokens (or an explicit UFN).
                let start = record
                    .fields
                    .first()
                    .and_then(|f| time::parse(&f.normalized()).ok());
                let end = record
                    .fields
                    .get(1)
                    .and_then(|f| time::parse(&f.normalized()).ok());
                let explicit = start
                    .as_ref()
                    .is_some_and(|v| v.at.is_some() && v.at == period.start_at)
                    && end.as_ref().is_some_and(|v| {
                        (v.at.is_some() && v.at == period.end_at)
                            || (v.status == Some(TimeStatus::OpenEnded)
                                && period.end_status == Some(TimeStatus::OpenEnded))
                    });
                self.periods.push((period.clone(), record, explicit));
            }
            Fact::Activity(activity)
                if activity.kind == "crypto_changeover"
                    && activity.time.as_ref().is_some_and(|v| v.ends_with('Z')) =>
            {
                self.checks.push(((**activity).clone(), record));
            }
            _ => {}
        }
    }
    pub fn emit(
        self,
        output: &mut dyn ParseSink,
        budget: &WorkBudget<'_>,
    ) -> Result<(), ParseFailure> {
        // Multiple message-wide periods are ambiguous here; do not choose precedence.
        // Source-less, partial-date and receipt-year-derived periods leave old facts unresolved.
        if self.period_records != 1 || self.periods.len() != 1 || !self.periods[0].2 {
            return Ok(());
        }
        let (period, period_record, _) = &self.periods[0];
        for (index, (activity, record)) in self.checks.into_iter().enumerate() {
            budget.checkpoint(1)?;
            let clock = activity
                .time
                .as_deref()
                .ok_or_else(|| bad("recurrence_clock"))?;
            let hour: u8 = clock[..2].parse().map_err(|_| bad("recurrence_clock"))?;
            let minute: u8 = clock[3..5].parse().map_err(|_| bad("recurrence_clock"))?;
            let id = format!("r{}", index + 1);
            let value = Recurrence {
                id: id.clone(),
                kind: activity.kind.clone(),
                activity_id: Some(activity.id.clone()),
                rule: format!("FREQ=DAILY;BYHOUR={hour};BYMINUTE={minute}"),
                dtstart: period.start_at.clone(),
                until: period.end_at.clone(),
                count: None,
                exdates: Vec::new(),
                scope: activity.scope.clone(),
                status: RecurrenceStatus::Inferred,
            };
            output.audit(audit(record, Some(id), Profile::Baseline,
                "optask.crypto.recurrence.v1", "S1 p.1678, FF0315/005 p.4323; explicit source message period",
                json!({"activity_id":activity.id,"period_id":period.id,
                    "daily_recurrence_evidence":true,"anchor_basis":"explicit_source_period",
                    "period_record_sequence":period_record.sequence,
                    "period_span":{"start_byte":period_record.span.start,"end_byte":period_record.span.end,"representation":"decoded_utf8_body"},
                    "rule":value.rule})))?;
            output.recurrence(value)?;
        }
        Ok(())
    }
}
