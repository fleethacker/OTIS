use crate::{Error, Result};
use serde::{Deserialize, Serialize};
#[derive(Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Fields {
    outgoing: String,
    letter: String,
    #[serde(rename = "type")]
    reference_type: String,
    originator: String,
    dtg: String,
    serial: String,
    authority: String,
    family: String,
    response: String,
    context_kind: String,
    context: String,
    notes: String,
    confirmed: bool,
}
pub fn clean(value: &str) -> bool {
    value.chars().all(|c| {
        !c.is_control()
            && unicode_general_category::get_general_category(c)
                != unicode_general_category::GeneralCategory::Format
    })
}
pub fn prepare(raw: &str, generate: bool) -> Result<(String, String)> {
    if raw.len() > 16384 {
        return Err(Error::invalid("fields_json exceeds 16384 bytes"));
    }
    let f: Fields = serde_json::from_str(raw).map_err(|_| {
        Error::invalid("fields_json must be an object with unique, supported non-null fields")
    })?;
    for (name, v, max, required) in [
        ("outgoing", &f.outgoing, 30, true),
        ("letter", &f.letter, 1, true),
        ("type", &f.reference_type, 20, true),
        ("originator", &f.originator, 30, true),
        ("dtg", &f.dtg, 14, true),
        ("serial", &f.serial, 10, false),
        ("authority", &f.authority, 50, true),
        ("family", &f.family, 7, true),
        ("response", &f.response, 6, true),
        ("contextKind", &f.context_kind, 4, false),
        ("context", &f.context, 100, false),
        ("notes", &f.notes, 2000, false),
    ] {
        if v.chars().count() > max
            || !clean(v)
            || v.contains(['/', '\\', '\u{2028}', '\u{2029}'])
            || (generate && required && v.trim().is_empty())
        {
            return Err(Error::invalid(format!("{name}: invalid or missing value")));
        }
    }
    let fields = serde_json::to_string(&f).map_err(|_| Error::invalid("fields_json"))?;
    if !generate {
        return Ok((fields, String::new()));
    }
    let date = chrono::NaiveDateTime::parse_from_str(&f.dtg, "%d%H%MZ%b%Y").ok();
    let valid_date = date.is_some_and(|d| {
        d.format("%d%H%MZ%b%Y").to_string().to_uppercase() == f.dtg
            && chrono::Datelike::year(&d) > 0
    });
    if f.letter.len() != 1
        || !f.letter.as_bytes()[0].is_ascii_uppercase()
        || f.reference_type.chars().count() < 2
        || !valid_date
        || !f.confirmed
        || !matches!(
            (f.family.as_str(), f.response.as_str()),
            ("ACTAGCY", "ACK" | "WILCO" | "HAVCO" | "CANTCO")
                | ("ICVALID", "NONVAL" | "VALID" | "VALCHG")
        )
        || f.context_kind.is_empty() != f.context.is_empty()
        || !matches!(f.context_kind.as_str(), "" | "EXER" | "OPER")
    {
        return Err(Error::invalid(
            "Generation requires a real Zulu DTG, supported reference/response, context and explicit authority confirmation",
        ));
    }
    let mut lines = Vec::new();
    if !f.context_kind.is_empty() {
        lines.push(format!("{}/{}//", f.context_kind, f.context));
    }
    lines.push(format!("MSGID/AKNLDG/{}//", f.outgoing));
    lines.push(format!(
        "REF/{}/{}/{}/{}{}//",
        f.letter,
        f.reference_type,
        f.originator,
        f.dtg,
        if f.serial.is_empty() {
            String::new()
        } else {
            format!("/{}", f.serial)
        }
    ));
    lines.push(format!(
        "{}/{}/{}/{}//",
        f.family, f.authority, f.response, f.letter
    ));
    Ok((fields, lines.join("\n")))
}
