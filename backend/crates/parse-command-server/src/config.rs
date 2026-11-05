use crate::{Error, Result};
use std::path::PathBuf;
#[derive(Clone)]
pub struct Config {
    pub intake: parse_command_intake::config::Config,
    pub search: String,
    pub state_index: String,
    pub auth: crate::auth::Config,
    pub tokenizer: PathBuf,
    pub tokenizer_hash: String,
    pub listen: String,
    pub auto_role: Option<String>,
    pub allow_fixtures: bool,
}
fn demo_flag(value: &str, configured: bool) -> Result<bool> {
    match value {
        "" => Ok(configured),
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(Error::config(
            "PARSE_COMMAND_WATCHDESK_DEMO must be true or false",
        )),
    }
}
fn configure_demo(intake: &mut parse_command_intake::config::Config, value: &str) -> Result<()> {
    intake.demo_fixture_assignments = demo_flag(value, intake.demo_fixture_assignments)?;
    intake
        .validate()
        .map_err(|_| Error::config("invalid intake configuration after demo override"))
}
impl Config {
    pub fn load(path: &std::path::Path) -> Result<Self> {
        crate::station::required()?;
        let get = |key: &str, default: &str| std::env::var(key).unwrap_or_else(|_| default.into());
        let auth = crate::auth::Config::load()?;
        let search = get("PARSE_COMMAND_OPENSEARCH_URL", "http://opensearch:9200");
        let url =
            reqwest::Url::parse(&search).map_err(|_| Error::config("invalid search endpoint"))?;
        if url.scheme() != "http"
            || !matches!(
                url.host_str(),
                Some("opensearch" | "127.0.0.1" | "localhost")
            )
            || url.path() != "/"
            || url.query().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(Error::config(
                "search endpoint must be the configured enclave-local demo node",
            ));
        }
        let auto = get("PARSE_COMMAND_DEMO_AUTO_ROLE", "user");
        if !matches!(
            auto.as_str(),
            "" | "user" | "platform_admin" | "admin" | "viewer"
        ) {
            return Err(Error::config("invalid demo role"));
        }
        let mut intake = parse_command_intake::config::Config::load(path)
            .map_err(|_| Error::config("invalid intake configuration"))?;
        configure_demo(&mut intake, &get("PARSE_COMMAND_WATCHDESK_DEMO", ""))?;
        Ok(Self {
            intake,
            search: search.trim_end_matches('/').into(),
            state_index: get(
                "PARSE_COMMAND_STATE_INDEX",
                parse_command_state::DEFAULT_INDEX,
            ),
            tokenizer: get(
                "PARSE_COMMAND_TOKENIZER",
                "/opt/parse-command/tokenizer.json",
            )
            .into(),
            tokenizer_hash: get(
                "PARSE_COMMAND_TOKENIZER_SHA256",
                include_str!("../../../config/tokenizer.sha256").trim(),
            ),
            listen: get("PARSE_COMMAND_LISTEN", "0.0.0.0:8081"),
            auto_role: (auth.mode == "local_demo" && !auto.is_empty()).then_some(auto),
            auth,
            allow_fixtures: get("PARSE_COMMAND_ALLOW_FIXTURES", "false") == "true",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn watchdesk_override_is_explicit_and_revalidates_intake() {
        assert!(!demo_flag("", false).unwrap());
        assert!(demo_flag("", true).unwrap());
        assert!(demo_flag("true", false).unwrap());
        assert!(!demo_flag("false", true).unwrap());
        for value in ["TRUE", "1", " true", "typo"] {
            assert!(demo_flag(value, false).is_err());
        }
        let path = std::path::Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../config/demo-compose-intake.json"
        ));
        let mut intake = parse_command_intake::config::Config::load(path).unwrap();
        configure_demo(&mut intake, "true").unwrap();
        assert!(intake.demo_fixture_assignments);
        configure_demo(&mut intake, "false").unwrap();
        assert!(!intake.demo_fixture_assignments);
        intake.source_routing = Some(parse_command_intake::config::SourceRouting {
            policy_id: "policy-v1".into(),
            command_ids: vec!["ship-a".into()],
        });
        intake.validate().unwrap();
        assert!(configure_demo(&mut intake, "true").is_err());
    }
}
