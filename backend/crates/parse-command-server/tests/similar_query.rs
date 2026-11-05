use parse_command_server::api::{ReadRequest, similar_query};
use serde_json::json;
#[test]
fn related_query_is_bounded_plain_text_derived_from_source_and_preserves_unicode() {
    let core = json!({"subject":"Main propulsion cooling: +pump* AND (pressure)","type":"OPTASK GENERAL","activities":[{"description":"inspect coolant pumps"}]});
    let query = similar_query(
        &core,
        &format!("{} engine coolant inspection", "été压力 ".repeat(500)),
    )
    .unwrap();
    assert!(query.len() <= 240);
    assert!(query.starts_with("Main propulsion cooling"));
    assert!(query.contains("été压力"));
    assert!(query.chars().all(|c| c.is_alphanumeric() || c == ' '));
    assert_eq!(
        query
            .split_whitespace()
            .filter(|word| word.eq_ignore_ascii_case("pump"))
            .count(),
        1
    );
    assert!(similar_query(&json!({}), "").is_err());
}
#[test]
fn browser_cannot_supply_internal_station_fingerprint_or_seed_override() {
    for field in ["relevanceFingerprint", "excludeMessageId", "similarTo"] {
        let mut input = json!({"key":"some-key"});
        input[field] = json!("forged");
        assert!(serde_json::from_value::<ReadRequest>(input).is_err());
    }
}
