//! Pure parser host foundation. Durable intake, HTTP, IMAP, indexing and batching are adapters.
use parse_command_parser_api::*;
use parse_command_types::{
    AuditEvent, Message, MessageStatus, SecurityStatus, Validate, Validated, event_id, message_id,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub struct Registry {
    parsers: Vec<Box<dyn MessageParser>>,
    by_type: BTreeMap<&'static str, Vec<usize>>,
    enabled: BTreeSet<String>,
}
pub struct SelectedParser<'a> {
    parser: &'a dyn MessageParser,
    pub descriptor: &'static ParserDescriptor,
    pub profile: &'static str,
    pub rule: &'static str,
}
fn failure(kind: ErrorKind, code: &'static str) -> ParseFailure {
    ParseFailure::new(kind, code)
}
impl Registry {
    pub fn new(
        parsers: Vec<Box<dyn MessageParser>>,
        enabled: BTreeSet<String>,
    ) -> Result<Self, ParseFailure> {
        let mut names = BTreeSet::new();
        let mut claims = BTreeSet::new();
        let mut by_type: BTreeMap<_, Vec<_>> = BTreeMap::new();
        for (index, parser) in parsers.iter().enumerate() {
            let d = parser.descriptor();
            parse_command_types::validate_revision(d.id, "parser.id")?;
            parse_command_types::validate_revision(d.version, "parser.version")?;
            if d.icd_major != parse_command_types::ICD_MAJOR {
                return Err(failure(ErrorKind::RegistryConflict, "icd_major"));
            }
            if !names.insert(d.id) {
                return Err(failure(ErrorKind::RegistryConflict, "duplicate_parser_id"));
            }
            if d.message_types.is_empty() || d.profiles.is_empty() {
                return Err(failure(ErrorKind::RegistryConflict, "empty_claims"));
            }
            let mut types = BTreeSet::new();
            let mut profiles = BTreeSet::new();
            for profile in d.profiles {
                if profile.is_empty() || !profiles.insert(*profile) {
                    return Err(failure(ErrorKind::RegistryConflict, "profile_claim"));
                }
            }
            for kind in d.message_types {
                if kind.is_empty() || kind.trim() != *kind || !types.insert(*kind) {
                    return Err(failure(ErrorKind::RegistryConflict, "message_claim"));
                }
                for profile in d.profiles {
                    if !claims.insert((*kind, *profile)) {
                        return Err(failure(ErrorKind::RegistryConflict, "overlapping_claim"));
                    }
                }
                by_type.entry(*kind).or_default().push(index);
            }
        }
        for kind in &enabled {
            if !by_type.contains_key(kind.as_str()) {
                return Err(failure(
                    ErrorKind::RegistryConflict,
                    "enabled_type_without_parser",
                ));
            }
        }
        Ok(Self {
            parsers,
            by_type,
            enabled,
        })
    }
    pub fn descriptors(&self) -> impl Iterator<Item = &'static ParserDescriptor> + '_ {
        self.parsers.iter().map(|p| p.descriptor())
    }
    pub fn select(&self, input: &MessageView<'_>) -> Result<SelectedParser<'_>, ParseFailure> {
        if !self.enabled.contains(input.message_type) {
            return Err(failure(ErrorKind::UnsupportedProfile, "type_not_enabled"));
        }
        let candidates = self
            .by_type
            .get(input.message_type)
            .ok_or(failure(ErrorKind::UnsupportedProfile, "unknown_type"))?;
        let mut selected = None;
        for index in candidates {
            let parser = self.parsers[*index].as_ref();
            let d = parser.descriptor();
            match parser.assess(input) {
                MatchOutcome::Unsupported => {}
                MatchOutcome::Ambiguous { .. } => {
                    return Err(failure(ErrorKind::AmbiguousProfile, "ambiguous_profile"));
                }
                MatchOutcome::Applicable { profile, rule } => {
                    if !d.profiles.contains(&profile) || rule.is_empty() {
                        return Err(failure(ErrorKind::InternalDefect, "undeclared_profile"));
                    }
                    if selected.is_some() {
                        return Err(failure(
                            ErrorKind::AmbiguousProfile,
                            "multiple_applicable_parsers",
                        ));
                    }
                    selected = Some(SelectedParser {
                        parser,
                        descriptor: d,
                        profile,
                        rule,
                    });
                }
            }
        }
        selected.ok_or(failure(
            ErrorKind::UnsupportedProfile,
            "no_applicable_profile",
        ))
    }
}

#[derive(Clone, Copy, Debug)]
pub struct HostLimits {
    pub scan: ScanLimits,
    pub output: OutputLimits,
    pub max_subject_bytes: usize,
}
/// Entirely in-memory result, suitable for staging atomically in a future durable outbox.
pub struct ParsedMessage {
    pub core: Validated<Message>,
    pub audit: Vec<Validated<AuditEvent>>,
}
pub struct ParserHost {
    registry: Registry,
    limits: HostLimits,
}
impl ParserHost {
    pub fn new(registry: Registry, limits: HostLimits) -> Result<Self, ParseFailure> {
        limits.scan.validate()?;
        limits.output.validate()?;
        if limits.max_subject_bytes == 0 {
            return Err(failure(ErrorKind::InvalidValue, "subject_limit"));
        }
        Ok(Self { registry, limits })
    }
    pub fn registry(&self) -> &Registry {
        &self.registry
    }
    pub fn parse(
        &self,
        input: DecodedMessage<'_>,
        context: &ParseContext<'_>,
    ) -> Result<ParsedMessage, ParseFailure> {
        context.budget.checkpoint(0)?;
        parse_command_types::validate_revision(context.revision, "revision")?;
        if input.body.len() > self.limits.scan.max_source_bytes {
            return Err(failure(ErrorKind::ResourceLimit, "source_bytes"));
        }
        if input
            .subject
            .is_some_and(|s| s.len() > self.limits.max_subject_bytes)
        {
            return Err(failure(ErrorKind::ResourceLimit, "subject_bytes"));
        }
        context.budget.checkpoint(input.body.len() as u64)?;
        let scanned = scan(input.body, self.limits.scan)?;
        let view = scanned.view(display_subject(input.subject));
        let selected = self.registry.select(&view)?;
        context.budget.checkpoint(0)?;
        let mut output = BoundedOutput::new(self.limits.output)?;
        let mut source = serde_json::Map::new();
        source.insert("source".into(),json!({"raw_text":input.body,"sha256":message_id(input.body).trim_start_matches("sha256:"),"encoding":"UTF-8","byte_length":input.body.len()}));
        output.audit(AuditEntry {
            kind: "source_preserved".into(),
            subject_id: None,
            payload: source,
        })?;
        let mut email = serde_json::Map::new();
        email.insert("decoded_subject".into(), json!(input.subject));
        email.insert("display_subject".into(), json!(view.subject));
        // The MIME/IMAP adapter must attach real receipt/header provenance before durable publication.
        output.audit(AuditEntry {
            kind: "email_metadata_normalized".into(),
            subject_id: None,
            payload: email,
        })?;
        let summary = selected.parser.parse(&view, context, &mut output)?;
        context.budget.checkpoint(0)?;
        if summary.profile != selected.profile {
            return Err(failure(
                ErrorKind::InternalDefect,
                "profile_changed_during_parse",
            ));
        }
        let mut audit_records = Vec::new();
        for record in view.records {
            context.budget.checkpoint(1)?;
            let field_value = |field: &FieldView<'_>| json!({"position":field.position,"start_byte":field.span.start,"end_byte":field.span.end,"raw_text":field.raw()});
            let fields: Vec<_> = record.fields.iter().map(field_value).collect();
            let rows:Vec<_>=record.rows.iter().map(|row|json!({"start_byte":row.span.start,"end_byte":row.span.end,"fields":row.fields.iter().map(field_value).collect::<Vec<_>>()})).collect();
            audit_records.push(json!({"sequence":record.sequence,"set_id":record.set_id,"start_byte":record.span.start,"end_byte":record.span.end,"fields":fields,"rows":rows}));
        }
        let mut payload = serde_json::Map::new();
        payload.insert("parser_id".into(), json!(selected.descriptor.id));
        payload.insert("parser_version".into(), json!(selected.descriptor.version));
        payload.insert("profile".into(), json!(selected.profile));
        payload.insert("selection_rule".into(), json!(selected.rule));
        payload.insert("records".into(), Value::Array(audit_records));
        let diagnostics: Vec<_> = scanned
            .diagnostics
            .iter()
            .map(|d| match d {
                ScanDiagnostic::SetNotOnNewLine { sequence, offset } => {
                    json!({"code":"set_not_on_new_line","sequence":sequence,"offset":offset})
                }
            })
            .collect();
        payload.insert("diagnostics".into(), json!(diagnostics));
        if !scanned.diagnostics.is_empty() {
            output.review_flag("structural_review")?;
        }
        output.audit(AuditEntry {
            kind: "parse_completed".into(),
            subject_id: None,
            payload,
        })?;
        let facts = output.finish()?;
        for (present, category) in [
            (!facts.periods.is_empty(), FactCategory::Period),
            (!facts.frequencies.is_empty(), FactCategory::Frequency),
            (!facts.activities.is_empty(), FactCategory::Activity),
            (!facts.contacts.is_empty(), FactCategory::Contact),
        ] {
            if present && !selected.descriptor.fact_categories.contains(&category) {
                return Err(failure(
                    ErrorKind::InternalDefect,
                    "undeclared_fact_category",
                ));
            }
        }
        if facts.header.message_type != view.message_type {
            return Err(failure(ErrorKind::InvalidValue, "header_type_mismatch"));
        }
        let mut security = context
            .security_override
            .cloned()
            .unwrap_or(facts.header.security);
        if context.security_override.is_none() && security.status != SecurityStatus::Conflict {
            security.status = SecurityStatus::Unvalidated;
        }
        security.validate()?;
        let expires_at = facts
            .header
            .issued_at
            .as_ref()
            .map(|t| t.add_days(365))
            .transpose()?;
        let core = Message {
            id: message_id(input.body),
            revision: context.revision.into(),
            kind: view.message_type.into(),
            originator: facts.header.originator,
            serial: facts.header.serial,
            issued_at: facts.header.issued_at,
            expires_at,
            subject: view.subject.map(str::to_owned),
            security: security.clone(),
            command_ids: context.command_ids.to_vec(),
            status: if summary.completeness == Completeness::Partial {
                MessageStatus::Partial
            } else {
                MessageStatus::NeedsReview
            },
            periods: facts.periods,
            frequencies: facts.frequencies,
            activities: facts.activities,
            contacts: facts.contacts,
            review_flags: facts.review_flags,
        };
        encoded_len(&core, self.limits.output.max_core_bytes)?;
        let core = Validated::new(core)?;
        let covered: BTreeSet<_> = facts
            .audit
            .iter()
            .filter_map(|entry| entry.subject_id.as_deref())
            .collect();
        for id in core
            .get()
            .periods
            .iter()
            .map(|f| &f.id)
            .chain(core.get().frequencies.iter().map(|f| &f.id))
            .chain(core.get().activities.iter().map(|f| &f.id))
            .chain(core.get().contacts.iter().map(|f| &f.id))
        {
            if !covered.contains(id.as_str()) {
                return Err(failure(ErrorKind::InvalidValue, "missing_fact_audit"));
            }
        }
        let mut events = Vec::new();
        let mut ids = BTreeSet::new();
        for entry in facts.audit {
            let payload = serde_json::to_string(&entry.payload)
                .map_err(|_| failure(ErrorKind::InternalDefect, "audit_serialization"))?;
            let id = event_id(&[
                &core.get().id,
                context.revision,
                &entry.kind,
                entry.subject_id.as_deref().unwrap_or(""),
                context.recorded_at.as_str(),
                &payload,
            ]);
            if !ids.insert(id.clone()) {
                return Err(failure(ErrorKind::InvalidValue, "duplicate_audit_event"));
            }
            let event = AuditEvent {
                id,
                message_id: core.get().id.clone(),
                revision: context.revision.into(),
                kind: entry.kind,
                subject_id: entry.subject_id,
                recorded_at: context.recorded_at.clone(),
                issued_at: core.get().issued_at.clone(),
                review_only: None,
                security: security.clone(),
                payload: entry.payload,
            };
            if let Some(subject) = &event.subject_id {
                let found = core.get().periods.iter().any(|f| &f.id == subject)
                    || core.get().frequencies.iter().any(|f| &f.id == subject)
                    || core.get().activities.iter().any(|f| &f.id == subject)
                    || core.get().contacts.iter().any(|f| &f.id == subject);
                if !found {
                    return Err(failure(ErrorKind::InvalidValue, "audit_subject_missing"));
                }
            }
            events.push(Validated::new(event)?);
        }
        encoded_len(&events, self.limits.output.max_audit_bytes)?;
        context.budget.checkpoint(0)?;
        Ok(ParsedMessage {
            core,
            audit: events,
        })
    }
}
