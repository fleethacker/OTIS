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
impl Config {
    pub fn load(path: &std::path::Path) -> Result<Self> {
        let get = |key: &str, default: &str| std::env::var(key).unwrap_or_else(|_| default.into());
        let auth = crate::auth::Config::load()?;
        let profile = get("PARSE_COMMAND_DEPLOYMENT_PROFILE", "local");
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
        let intake = parse_command_intake::config::Config::load(path)
            .map_err(|_| Error::config("invalid intake configuration"))?;
        validate_deployment_profile(
            &profile,
            &auth.mode,
            &get("PARSE_COMMAND_SEARCH_SECURITY_POLICY", ""),
            intake.transport,
            &search,
            &intake.opensearch_url,
        )?;
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

fn validate_deployment_profile(
    profile: &str,
    auth_mode: &str,
    search_policy: &str,
    mail_transport: parse_command_intake::config::Transport,
    search: &str,
    custody_search: &str,
) -> Result<()> {
    use parse_command_intake::config::Transport;
    match profile {
        "local" => Ok(()),
        "uds" => {
            if auth_mode != "oidc" || search_policy != "uds_mesh_mtls" {
                return Err(Error::config(
                    "UDS requires native OIDC and explicit uds_mesh_mtls search security policy",
                ));
            }
            if !matches!(mail_transport, Transport::Tls) {
                return Err(Error::config("UDS deployment requires verified IMAP TLS"));
            }
            if search.trim_end_matches('/') != custody_search.trim_end_matches('/') {
                return Err(Error::config(
                    "UDS custody and application must use the same search endpoint",
                ));
            }
            Ok(())
        }
        _ => Err(Error::config("deployment profile must be local or uds")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use parse_command_intake::config::Transport;

    #[test]
    fn uds_requires_native_identity_mesh_and_verified_mail_transport() {
        let endpoint = "http://opensearch:9200";
        assert!(
            validate_deployment_profile(
                "uds",
                "oidc",
                "uds_mesh_mtls",
                Transport::Tls,
                endpoint,
                endpoint
            )
            .is_ok()
        );
        for (auth, policy, mail) in [
            ("local_demo", "uds_mesh_mtls", Transport::Tls),
            ("oidc", "", Transport::Tls),
            ("oidc", "local_demo", Transport::Tls),
            ("oidc", "uds_mesh_mtls", Transport::PlaintextDemo),
        ] {
            assert!(
                validate_deployment_profile("uds", auth, policy, mail, endpoint, endpoint).is_err()
            );
        }
        // The writer lease and custody mutations must not target different stores.
        assert!(
            validate_deployment_profile(
                "uds",
                "oidc",
                "uds_mesh_mtls",
                Transport::Tls,
                endpoint,
                "http://127.0.0.1:9200"
            )
            .is_err()
        );
        assert!(
            validate_deployment_profile(
                "uds",
                "oidc",
                "uds_mesh_mtls",
                Transport::Tls,
                endpoint,
                "http://opensearch:9200/"
            )
            .is_ok()
        );
    }

    #[test]
    fn unknown_profile_fails_and_local_oidc_retains_compose_compatibility() {
        let endpoint = "http://opensearch:9200";
        assert!(
            validate_deployment_profile(
                "unknown",
                "oidc",
                "uds_mesh_mtls",
                Transport::Tls,
                endpoint,
                endpoint
            )
            .is_err()
        );
        for auth in ["local_demo", "oidc"] {
            assert!(
                validate_deployment_profile(
                    "local",
                    auth,
                    "",
                    Transport::PlaintextDemo,
                    endpoint,
                    endpoint
                )
                .is_ok()
            );
        }
    }
}
