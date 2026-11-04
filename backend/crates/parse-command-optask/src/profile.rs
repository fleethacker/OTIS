use parse_command_parser_api::*;

pub const TYPES: &[&str] = &[
    "OPTASK AAW",
    "OPTASK ASUW",
    "OPTASK ASW",
    "OPTASK COMMS",
    "OPTASK COP-CTP",
    "OPTASK EW",
    "OPTASK GENERAL",
    "OPTASK IM",
    "OPTASK LINK",
    "OPTASK LINK ID SUPP",
    "OPTASK MCM",
    "OPTASK MINING",
    "OPTASK NUC",
    "OPTASK RAS",
];
pub const BASELINE: &str = "usmtf-2003-subset-v1";
pub const EXAMPLES: &str = "observed-optask-extensions-v1";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Profile {
    Baseline,
    Examples,
}
impl Profile {
    pub fn name(self) -> &'static str {
        match self {
            Self::Baseline => BASELINE,
            Self::Examples => EXAMPLES,
        }
    }
    pub fn inferential(self) -> bool {
        self == Self::Examples
    }
}
pub(crate) fn field<'a>(
    r: &'a RecordView<'_>,
    position: usize,
) -> Result<std::borrow::Cow<'a, str>, ParseFailure> {
    r.fields
        .get(position.saturating_sub(1))
        .map(FieldView::normalized)
        .ok_or(ParseFailure::new(ErrorKind::MalformedInput, "missing_field").at(r.span.start))
}
pub(crate) fn arity(r: &RecordView<'_>, min: usize, max: usize) -> Result<(), ParseFailure> {
    if !(min..=max).contains(&r.fields.len()) || !r.rows.is_empty() {
        return Err(ParseFailure::new(ErrorKind::MalformedInput, "record_layout").at(r.span.start));
    }
    Ok(())
}
pub(crate) fn select(input: &MessageView<'_>) -> Option<Profile> {
    if !TYPES.contains(&input.message_type) {
        return None;
    }
    let r = input.records.iter().find(|r| r.set_id == "MSGID")?;
    let second = field(r, 2).ok()?;
    if second == "MIL-STD-6040(SERIES)" {
        let version = match input.message_type {
            "OPTASK AAW" => "B.1.01.13",
            "OPTASK COP-CTP" => "B.1.01.03",
            "OPTASK LINK" => "B.1.02.04",
            _ => "B.1.01.12",
        };
        return (arity(r, 10, 11).is_ok() && field(r, 3).ok()?.as_ref() == version)
            .then_some(Profile::Examples);
    }
    // No fallback from a standard-bearing, unknown edition into old positional rules.
    if second.starts_with("MIL-STD") {
        return None;
    }
    (matches!(
        input.message_type,
        "OPTASK LINK" | "OPTASK MCM" | "OPTASK MINING" | "OPTASK NUC" | "OPTASK RAS"
    ) && arity(r, 2, 6).is_ok())
    .then_some(Profile::Baseline)
}
