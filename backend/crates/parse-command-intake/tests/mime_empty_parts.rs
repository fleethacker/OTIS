use parse_command_intake::{config::MimeLimits, mime};

fn rejects_empty_part(newline: &str, nested: bool) {
    let limits = MimeLimits {
        max_depth: 4,
        max_parts: 8,
        max_header_bytes: 1024,
        max_headers: 16,
        max_decoded_bytes: 1024,
    };
    let empty = format!(
        "Content-Type: multipart/mixed; boundary=INNER{newline}{newline}\
         --INNER{newline}--INNER--{newline}"
    );
    let raw = if nested {
        format!(
            "Content-Type: multipart/mixed; boundary=OUTER{newline}{newline}\
             --OUTER{newline}{empty}{newline}--OUTER--{newline}"
        )
    } else {
        empty
    };
    assert_eq!(
        mime::decode(raw.as_bytes(), limits)
            .err()
            .map(|error| error.0),
        Some("mime_empty_part")
    );
}

#[test]
fn empty_part_with_crlf_is_rejected() {
    rejects_empty_part("\r\n", false);
}

#[test]
fn empty_part_with_lf_is_rejected() {
    rejects_empty_part("\n", false);
}

#[test]
fn nested_empty_part_with_crlf_is_rejected() {
    rejects_empty_part("\r\n", true);
}

#[test]
fn nested_empty_part_with_lf_is_rejected() {
    rejects_empty_part("\n", true);
}
