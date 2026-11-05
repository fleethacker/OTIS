use parse_command_server::presentation::source_sets;
use serde_json::json;
#[test]
fn source_set_projection_preserves_repetition_free_text_and_columnar_cells_without_audit_metadata()
{
    let raw = "MSGID/OPTASK LINK/ÉQUIPE//\nGENTEXT/ORDERS/Keep / and HTTP://example.invalid//";
    let field = |position, value: &str| {
        let start = raw.find(value).unwrap();
        json!({"position":position,"raw_text":value,"start_byte":start,"end_byte":start+value.len()})
    };
    let audits = vec![
        json!({"kind":"parse_completed","payload":{"profile":"usmtf-2003-subset-v1","rule_id":"hidden","records":[
            {"set_id":"MSGID","sequence":0,"fields":[field(1,"OPTASK LINK"),field(2,"ÉQUIPE")],"rows":[]},
            {"set_id":"GENTEXT","fields":[field(1,"ORDERS"),field(2,"Keep / and HTTP://example.invalid")],"rows":[]},
            {"set_id":"GENTEXT","fields":[field(1,"ORDERS")],"rows":[]},
            {"set_id":"1TEST","fields":[],"rows":[{"fields":[field(1,"ÉQUIPE")]}]}
        ]}}),
    ];
    let (profile, sets) = source_sets(&audits, raw).unwrap();
    assert_eq!(profile, "usmtf-2003-subset-v1");
    assert_eq!(sets[0]["fields"][1]["value"], "ÉQUIPE");
    assert_eq!(
        sets[1]["fields"][1]["value"],
        "Keep / and HTTP://example.invalid"
    );
    assert_eq!(sets[2]["set_id"], "GENTEXT");
    assert_eq!(sets[3]["rows"][0]["fields"][0]["value"], "ÉQUIPE");
    for internal in ["rule_id", "sequence", "start_byte", "end_byte", "hidden"] {
        assert!(!sets.to_string().contains(internal));
    }
    let mut corrupt = audits.clone();
    corrupt[0]["payload"]["records"][0]["fields"][1]["raw_text"] = json!("OTHER");
    assert!(source_sets(&corrupt, raw).is_err());
    corrupt[0]["payload"]["records"][0]["fields"][1]["start_byte"] = json!(raw.len() + 1);
    assert!(source_sets(&corrupt, raw).is_err());
    assert_eq!(source_sets(&[], raw).unwrap().1, json!([]));
}
