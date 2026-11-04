use parse_command_parser_api::*;
fn limits() -> ScanLimits {
    ScanLimits {
        max_source_bytes: 8192,
        max_records: 32,
        max_set_bytes: 4096,
        max_fields_per_record: 64,
        max_total_fields: 256,
    }
}

#[test]
fn free_text_keeps_urls_slashes_unicode_and_uppercase_continuations() {
    let body = "MSGID/REFERENCE//\nGENTEXT/TOPIC/HTTPS://example.invalid/a/b\nUPPERCASE text é / continuation//\nAMPN/one/two//";
    let parsed = scan(body, limits()).unwrap();
    assert_eq!(parsed.records.len(), 3);
    let field = &parsed.records[1].fields[1];
    assert_eq!(
        field.raw(),
        "HTTPS://example.invalid/a/b\nUPPERCASE text é / continuation"
    );
    assert_eq!(field.span.slice(body).unwrap(), field.raw());
    assert_eq!(parsed.records[2].fields.len(), 1);
    assert_eq!(parsed.records[2].fields[0].raw(), "one/two");
}
#[test]
fn field_groups_wrapping_placeholders_and_truncation_are_preserved() {
    let p = scan(
        "MSGID/REFERENCE//\nGROUP/alpha/-\n/bravo//\nGROUP/charlie//",
        limits(),
    )
    .unwrap();
    assert_eq!(p.records[1].fields.len(), 3);
    assert_eq!(p.records[1].fields[1].normalized(), "-");
    assert_eq!(p.records[2].fields.len(), 1);
    assert!(p.diagnostics.is_empty());
}
#[test]
fn columnar_header_and_rows_stay_separate() {
    let p = scan(
        "MSGID/REFERENCE//\n1TABLE\n/NAME /VALUE\n/A    /1\n/B    /-\n//",
        limits(),
    )
    .unwrap();
    let t = &p.records[1];
    assert_eq!(t.kind, SetKind::Columnar);
    assert_eq!(t.fields[0].raw(), "NAME ");
    assert_eq!(t.rows.len(), 2);
    assert_eq!(t.rows[1].fields[1].raw(), "-");
}
#[test]
fn adjacent_sets_preserved_with_diagnostic() {
    let p = scan("MSGID/REFERENCE//TASK/one//", limits()).unwrap();
    assert_eq!(p.records.len(), 2);
    assert_eq!(p.diagnostics.len(), 1);
}
#[test]
fn malformed_and_multiple_messages_return_typed_errors() {
    for source in [
        "MSGID/REFERENCE/",
        "GENTEXT/TOPIC/text//",
        "MSGID//",
        "MSGID/REFERENCE//\nMSGID/SECOND//",
        "MSGID/REFERENCE//\nGENTEXT/ONLYSUBJECT//",
        "MSGID/REFERENCE//\nBAD/one/\n/",
        "MSGID/REFERENCE//\nBAD/one//garbage",
    ] {
        assert!(scan(source, limits()).is_err(), "accepted malformed input");
    }
}
#[test]
fn source_record_field_and_set_budgets_have_boundaries() {
    let source = "MSGID/REFERENCE//\nTASK/one/two//";
    let mut l = limits();
    l.max_source_bytes = source.len();
    assert!(scan(source, l).is_ok());
    l.max_source_bytes -= 1;
    assert_eq!(scan(source, l).unwrap_err().kind, ErrorKind::ResourceLimit);
    let mut l = limits();
    l.max_records = 1;
    assert!(scan(source, l).is_err());
    let mut l = limits();
    l.max_fields_per_record = 1;
    assert!(scan(source, l).is_err());
    let mut l = limits();
    l.max_total_fields = 2;
    assert!(scan(source, l).is_err());
    let mut l = limits();
    l.max_set_bytes = 3;
    assert!(scan(source, l).is_err());
}
#[test]
fn subject_normalization_is_header_only() {
    assert_eq!(
        display_subject(Some(" SUBJ: heading: SUBJ: interior ")),
        Some("heading: SUBJ: interior")
    );
    assert_eq!(display_subject(Some("heading")), Some("heading"));
    assert_eq!(display_subject(Some("SUBJ:  ")), None);
    assert_eq!(display_subject(None), None);
}
#[test]
fn invalid_spans_fail_without_utf8_panics() {
    assert!(Span { start: 1, end: 2 }.slice("é").is_err());
    assert!(Span { start: 4, end: 1 }.slice("text").is_err());
}
#[test]
fn bounded_arbitrary_text_never_panics_and_successful_spans_are_valid() {
    let alphabet = ['A', 'B', '1', '/', '\n', ':', 'é', ' ', '-', '\r'];
    let mut state = 7u64;
    for _ in 0..1500 {
        let mut s = String::new();
        for _ in 0..96 {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
            s.push(alphabet[(state as usize) % alphabet.len()]);
        }
        if let Ok(value) = scan(&s, limits()) {
            for record in value.records {
                assert!(record.span.slice(&s).is_ok());
            }
        }
    }
}
