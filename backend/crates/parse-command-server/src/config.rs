use crate::{Error, Result};
use std::path::PathBuf;
#[derive(Clone)]
pub struct Config {
    pub intake: parse_command_intake::config::Config,
    pub search: String,
    pub private: PathBuf,
    pub legacy: Option<PathBuf>,
    pub tokenizer: PathBuf,
    pub tokenizer_hash: String,
    pub listen: String,
    pub auto_role: Option<String>,
    pub allow_fixtures: bool,
}
impl Config {
    pub fn load(path: &std::path::Path) -> Result<Self> {
        let get = |key: &str, default: &str| std::env::var(key).unwrap_or_else(|_| default.into());
        if get("PARSE_COMMAND_AUTH_MODE", "disabled") != "local_demo" {
            return Err(Error::config(
                "An explicitly configured local_demo identity profile is required; operational authentication is not configured",
            ));
        }
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
        if !matches!(auto.as_str(), "" | "user" | "platform_admin") {
            return Err(Error::config("invalid demo role"));
        }
        Ok(Self {
            intake: parse_command_intake::config::Config::load(path)
                .map_err(|_| Error::config("invalid intake configuration"))?,
            search: search.trim_end_matches('/').into(),
            private: get(
                "PARSE_COMMAND_PRIVATE_DB",
                "/var/lib/parse-command-private/ui.sqlite",
            )
            .into(),
            legacy: std::env::var_os("PARSE_COMMAND_LEGACY_DB")
                .filter(|v| !v.is_empty())
                .map(PathBuf::from),
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
            auto_role: (!auto.is_empty()).then_some(auto),
            allow_fixtures: get("PARSE_COMMAND_ALLOW_FIXTURES", "false") == "true",
        })
    }
}
