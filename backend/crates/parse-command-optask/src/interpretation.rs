use super::*;
use profile::arity;

pub(super) fn extract(
    r: &RecordView<'_>,
    kind: &str,
    p: Profile,
    scope: &Scope,
) -> Result<Option<Extraction>, ParseFailure> {
    let result = match r.set_id {
        "PERIOD" => period(r, scope)?,
        "POC" => contact(r, scope, "POC")?,
        "POCLINK" | "MULCDUTY" if kind == "OPTASK LINK" && p == Profile::Examples => {
            contact(r, scope, r.set_id)?
        }
        "FREQPLAN" if kind == "OPTASK COMMS" && p == Profile::Examples => frequency_plan(r)?,
        "COMPLAN" | "COMCHECK" | "COMGUARD" if kind == "OPTASK COMMS" && p == Profile::Examples => {
            communications(r)?
        }
        "CRYPTDAT" | "VOICRYPT" if kind == "OPTASK LINK" => crypto(r, p, scope)?,
        "IVCCN" | "DALKFREQ" | "AUTOCAT" if kind == "OPTASK LINK" => link_frequencies(r, p, scope)?,
        "AEWEMPL" | "FORCEMAR" if kind == "OPTASK AAW" && p == Profile::Examples => {
            explicit_frequencies(r, scope)?
        }
        "COMMS" if matches!(kind, "OPTASK MCM" | "OPTASK MINING") => {
            explicit_frequencies(r, scope)?
        }
        "CVYORG" if kind == "OPTASK MCM" => explicit_frequencies(r, scope)?,
        "ESMTASK" if kind == "OPTASK EW" && p == Profile::Examples => task(r, kind, scope)?,
        "TASMISSN" | "SUBMISSN" if kind == "OPTASK ASW" && p == Profile::Examples => {
            task(r, kind, scope)?
        }
        "MTASK" if kind == "OPTASK MCM" && p == Profile::Examples => task(r, kind, scope)?,
        "IDP" if kind == "OPTASK IM" && p == Profile::Examples => report(r)?,
        "RASKED" if kind == "OPTASK RAS" => rendezvous(r, p)?,
        _ => return Ok(None),
    };
    Ok(Some(result))
}
fn period(r: &RecordView<'_>, scope: &Scope) -> Result<Extraction, ParseFailure> {
    arity(r, 2, 3)?;
    let start = period_time(&field(r, 1)?)?;
    let endraw = field(r, 2)?;
    let qualified = matches!(
        endraw.as_ref(),
        "AFTER" | "ASOF" | "ASAPAFT" | "ASAPNLT" | "BEFORE" | "NET" | "NLT"
    );
    if (r.fields.len() == 3) != qualified {
        return Err(bad("period_qualifier_layout"));
    }
    let end = if qualified {
        time::TimeValue {
            at: None,
            clock: None,
            label: Some(endraw.into_owned()),
            status: Some(TimeStatus::Unresolved),
        }
    } else {
        period_time(&endraw)?
    };
    let qualifier = if qualified {
        Some(period_time(&field(r, 3)?)?)
    } else {
        None
    };
    let mut value = Period {
        id: "v1".into(),
        scope: scope.segment.clone(),
        start_at: start.at,
        start_time: start.clock,
        start_label: start.label,
        start_status: start.status,
        end_at: end.at,
        end_time: end.clock,
        end_label: end.label,
        end_status: end.status,
        qualifier_at: None,
        qualifier_time: None,
        qualifier_label: None,
        qualifier_status: None,
    };
    if let Some(q) = qualifier {
        value.qualifier_at = q.at;
        value.qualifier_time = q.clock;
        value.qualifier_label = q.label;
        value.qualifier_status = q.status;
    }
    Ok(Extraction::new(
        vec![Fact::Period(value)],
        "optask.period.v1",
        "S1 pp.2449-2450; S3 pp.243-263",
    ))
}
fn period_time(raw: &str) -> Result<time::TimeValue, ParseFailure> {
    if !matches!(raw, "-" | "UFN") && !matches!(raw.len(), 7 | 8 | 10 | 11 | 14) {
        return Err(bad("period_time_layout"));
    }
    time::parse(raw)
}
fn contact(r: &RecordView<'_>, scope: &Scope, layout: &str) -> Result<Extraction, ParseFailure> {
    arity(r, 5, usize::MAX)?;
    let (name, position, unit, location, role, channels) = match layout {
        "POCLINK" => (3, 4, 2, None, Some(1), 5),
        "MULCDUTY" => (2, 3, 1, None, Some(4), 5),
        _ => (1, 2, 3, Some(4), None, 5),
    };
    let mut value = Contact {
        id: "c1".into(),
        name: field(r, name)?.into_owned(),
        position: field(r, position)?.into_owned(),
        unit: untag(&field(r, unit)?).into(),
        channels: Vec::new(),
        role: role
            .map(|i| field(r, i).map(|s| s.into_owned()))
            .transpose()?,
        location: location
            .map(|i| field(r, i).map(|s| present(&s)))
            .transpose()?
            .flatten(),
        scope: scope.segment.clone(),
    };
    for f in &r.fields[channels - 1..] {
        let value_field = f.normalized();
        if value_field == "-" {
            continue;
        }
        let (channel, address) = value_field
            .split_once(':')
            .ok_or(bad("contact_channel_descriptor"))?;
        if !matches!(
            channel,
            "TEL"
                | "SECTEL"
                | "TELTAC"
                | "SECTAC"
                | "FRQ"
                | "FRQDES"
                | "FREQ"
                | "EMAIL"
                | "DSN"
                | "CHAT"
        ) || address.is_empty()
        {
            return Err(bad("contact_channel_descriptor"));
        }
        value.channels.push(ContactChannel {
            kind: channel.into(),
            value: address.into(),
        });
    }
    Ok(Extraction::new(
        vec![Fact::Contact(value)],
        "optask.contact.v1",
        "S1 pp.2497-2498; S3 pp.247,251-255,257,259",
    ))
}
fn frequency_plan(r: &RecordView<'_>) -> Result<Extraction, ParseFailure> {
    arity(r, 6, usize::MAX)?;
    if (r.fields.len() - 2) % 4 != 0 {
        return Err(bad("frequency_plan_group"));
    }
    let mut facts = Vec::new();
    for group in r.fields[2..].chunks_exact(4) {
        let mut f = frequency::fact(&group[1].normalized())?;
        f.plan = present(&field(r, 1)?);
        f.designator = present(&field(r, 2)?);
        f.channel = present(&group[0].normalized());
        f.emission = present(&group[2].normalized());
        f.usage = present(&group[3].normalized());
        facts.push(Fact::Frequency(f));
    }
    Ok(Extraction::new(
        facts,
        "optask.frequency_plan.v1",
        "S3 p.246",
    ))
}
fn communications(r: &RecordView<'_>) -> Result<Extraction, ParseFailure> {
    let mut a = match r.set_id {
        "COMPLAN" => activity("communications_plan_window")?,
        "COMCHECK" => activity("communications_check")?,
        _ => activity("communications_guard_window")?,
    };
    match r.set_id {
        "COMPLAN" => {
            arity(r, 4, usize::MAX)?;
            a.plan = present(&field(r, 1)?);
            a.variant = present(&field(r, 2)?);
            time::parse(&field(r, 3)?)?.apply_activity(&mut a, "start");
            time::parse(&field(r, 4)?)?.apply_activity(&mut a, "end");
            a.circuits = r.fields[4..]
                .iter()
                .map(|f| f.normalized().into_owned())
                .collect();
        }
        "COMCHECK" => {
            arity(r, 3, usize::MAX)?;
            time::parse(&field(r, 1)?)?.apply_activity(&mut a, "at");
            a.participants = present(&field(r, 2)?).into_iter().collect();
            a.coordination = present(&field(r, 3)?);
            a.circuits = r.fields[3..]
                .iter()
                .map(|f| f.normalized().into_owned())
                .collect();
        }
        _ => {
            arity(r, 5, usize::MAX)?;
            a.line = present(&field(r, 1)?);
            a.mode = present(&field(r, 2)?);
            a.material = present(&field(r, 3)?);
            time::parse(&field(r, 4)?)?.apply_activity(&mut a, "start");
            time::parse(&field(r, 5)?)?.apply_activity(&mut a, "end");
            a.participants = unique_participants(&r.fields[5..]);
        }
    }
    Ok(Extraction::new(
        vec![Fact::Activity(Box::new(a))],
        "optask.communications_schedule.v1",
        "S3 p.246",
    ))
}
fn crypto(r: &RecordView<'_>, p: Profile, scope: &Scope) -> Result<Extraction, ParseFailure> {
    let mut facts = Vec::new();
    if r.set_id == "VOICRYPT" {
        if p != Profile::Examples {
            return Err(bad("crypto_layout"));
        }
        arity(r, 2, 2)?;
        let mut a = activity("crypto_changeover")?;
        a.material = present(&field(r, 1)?);
        a.scope = scope.fact();
        crypto_time(&field(r, 2)?)?.apply_activity(&mut a, "at");
        facts.push(Fact::Activity(Box::new(a)));
    } else if p == Profile::Examples {
        arity(r, 3, 3)?;
        let mut a = activity("crypto_changeover")?;
        a.equipment = present(&field(r, 1)?);
        a.material = present(&field(r, 2)?);
        a.scope = scope.fact();
        crypto_time(&field(r, 3)?)?.apply_activity(&mut a, "at");
        facts.push(Fact::Activity(Box::new(a)));
    } else {
        arity(r, 4, usize::MAX)?;
        // The repeated baseline group is equipment, key material, daily shift time.
        // Omitted trailing time is preserved without manufacturing a changeover event.
        let groups = &r.fields[2..];
        if groups.len() % 3 == 1 {
            return Err(bad("crypto_group"));
        }
        for group in groups.chunks(3) {
            if group.len() < 3 {
                continue;
            }
            let mut a = activity("crypto_changeover")?;
            a.equipment = present(&group[0].normalized());
            a.material = present(&group[1].normalized());
            a.scope = scope.fact();
            crypto_time(&group[2].normalized())?.apply_activity(&mut a, "at");
            facts.push(Fact::Activity(Box::new(a)));
        }
    }
    Ok(Extraction::new(
        facts,
        "optask.crypto.v1",
        "S1 p.1678, FF0315/005 p.4323; S3 pp.254-258",
    ))
}
fn crypto_time(raw: &str) -> Result<time::TimeValue, ParseFailure> {
    if raw != "-" && raw.len() != 5 {
        return Err(bad("crypto_time_layout"));
    }
    time::parse(raw)
}
fn link_frequencies(
    r: &RecordView<'_>,
    p: Profile,
    scope: &Scope,
) -> Result<Extraction, ParseFailure> {
    let positions: Vec<usize> = match (r.set_id, p) {
        ("DALKFREQ", Profile::Baseline) => {
            arity(r, 3, 6)?;
            vec![3]
        }
        ("DALKFREQ", Profile::Examples) => {
            arity(r, 5, 7)?;
            vec![3]
        }
        ("IVCCN", Profile::Baseline) => {
            arity(r, 4, usize::MAX)?;
            (4..=r.fields.len()).collect()
        }
        ("IVCCN", Profile::Examples) => {
            arity(r, 4, 7)?;
            vec![3]
        }
        ("AUTOCAT", Profile::Examples) => {
            arity(r, 3, 6)?;
            vec![2, 3]
        }
        _ => return Err(bad("link_frequency_layout")),
    };
    let mut facts = Vec::new();
    for position in positions {
        let raw = field(r, position)?;
        let value = if r.set_id == "DALKFREQ" {
            raw.strip_prefix("ASGN:").unwrap_or(&raw)
        } else {
            let allowed = if r.set_id == "AUTOCAT" {
                &["TFREQ:", "RFREQ:"][..]
            } else {
                &["ASGN:"][..]
            };
            let Some(value) = allowed.iter().find_map(|prefix| raw.strip_prefix(prefix)) else {
                continue;
            };
            value
        };
        let mut f = frequency::fact(value)?;
        f.scope = scope.fact();
        facts.push(Fact::Frequency(f));
    }
    Ok(Extraction::new(
        facts,
        "optask.link_frequency.v1",
        "S1 pp.1689,2062; S3 pp.254-256",
    ))
}
fn explicit_frequencies(r: &RecordView<'_>, scope: &Scope) -> Result<Extraction, ParseFailure> {
    let positions: Vec<usize> = match r.set_id {
        "AEWEMPL" => {
            arity(r, 7, 7)?;
            vec![4, 6]
        }
        "FORCEMAR" => {
            arity(r, 6, 7)?;
            vec![3, 5]
        }
        "CVYORG" => {
            arity(r, 5, usize::MAX)?;
            (5..=r.fields.len()).collect()
        }
        "COMMS" => {
            arity(r, 3, usize::MAX)?;
            if (r.fields.len() - 2) % 3 != 0 {
                return Err(bad("comms_frequency_group"));
            }
            (3..=r.fields.len()).step_by(3).collect()
        }
        _ => return Err(bad("frequency_layout")),
    };
    let mut facts = Vec::new();
    for position in positions {
        let raw = field(r, position)?;
        let value = raw.strip_prefix("FREQ:").unwrap_or(&raw);
        let mut f = frequency::fact(value)?;
        f.scope = scope.fact();
        facts.push(Fact::Frequency(f));
    }
    Ok(Extraction::new(
        facts,
        "optask.explicit_frequency.v1",
        "S1 FF0566 p.4949; S3 pp.243,260-261",
    ))
}
fn unique_participants(fields: &[FieldView<'_>]) -> Vec<String> {
    let mut result = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for f in fields {
        if let Some(value) = present(untag(&f.normalized())) {
            if seen.insert(value.clone()) {
                result.push(value);
            }
        }
    }
    result
}
fn task(r: &RecordView<'_>, kind: &str, scope: &Scope) -> Result<Extraction, ParseFailure> {
    arity(r, 2, usize::MAX)?;
    let mut a = activity("tasking")?;
    a.task_type = Some(r.set_id.into());
    a.description = Some(
        r.fields
            .iter()
            .map(|f| f.normalized())
            .collect::<Vec<_>>()
            .join(" / "),
    );
    a.scope = scope.fact();
    let participant = match r.set_id {
        "TASMISSN" => 2,
        "SUBMISSN" | "ESMTASK" => 1,
        "MTASK" => 2,
        _ => return Err(bad("task_layout")),
    };
    a.participants = present(untag(&field(r, participant)?))
        .into_iter()
        .collect();
    let mut facts = vec![Fact::Activity(Box::new(a))];
    if kind == "OPTASK EW" && r.fields.len() >= 3 {
        if let Some(value) = field(r, 3)?.strip_prefix("FREQLIM:") {
            let mut f = frequency::fact(value)?;
            f.scope = scope.fact();
            facts.push(Fact::Frequency(f));
        }
    }
    Ok(Extraction::new(
        facts,
        "optask.explicit_task.v1",
        "S3 pp.244-245,250,260",
    ))
}
fn report(r: &RecordView<'_>) -> Result<Extraction, ParseFailure> {
    arity(r, 5, usize::MAX)?;
    let mut a = activity("reporting_requirement")?;
    a.report = present(&field(r, 1)?);
    a.responsible_party = present(&field(r, 2)?);
    time::parse(&field(r, 3)?)?.apply_activity(&mut a, "as_of");
    time::parse(&field(r, 4)?)?.apply_activity(&mut a, "deadline");
    a.delivery = r.fields[4..]
        .iter()
        .map(|f| f.normalized().into_owned())
        .collect();
    Ok(Extraction::new(
        vec![Fact::Activity(Box::new(a))],
        "optask.reporting_requirement.v1",
        "S3 p.252",
    ))
}
fn rendezvous(r: &RecordView<'_>, p: Profile) -> Result<Extraction, ParseFailure> {
    arity(r, 2, 4)?;
    let raw = field(r, 1)?;
    if p == Profile::Baseline && !matches!(raw.len(), 8 | 11) {
        return Err(bad("verified_rendezvous_required"));
    }
    let mut a = activity("replenishment_rendezvous")?;
    time::parse(&raw)?.apply_activity(&mut a, "at");
    a.position = present(&field(r, 2)?);
    a.course = r.fields.get(2).and_then(|f| present(&f.normalized()));
    a.policy = r.fields.get(3).and_then(|f| present(&f.normalized()));
    Ok(Extraction::new(
        vec![Fact::Activity(Box::new(a))],
        "optask.rendezvous.v1",
        "S1 p.2572; S3 p.263",
    ))
}
