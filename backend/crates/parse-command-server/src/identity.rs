//! UDS Authservice handles browser login; every application request also verifies its JWT.
//! No remote JWKS fetch, header identity fallback, or demo-session fallback in this mode.
use crate::{Error, Result, api::Identity};
use axum::http::HeaderMap;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};

#[derive(Clone)]
pub struct Oidc {
    key: DecodingKey,
    validation: Validation,
    pub origin: String,
    admin_group: String,
    allowed_groups: Vec<String>,
}
#[derive(Clone, Deserialize)]
struct Claims {
    iss: String,
    sub: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    groups: Vec<String>,
}
impl Oidc {
    pub fn load(
        key_path: &Path,
        issuer: &str,
        audience: &str,
        origin: &str,
        admin_group: &str,
        allowed_groups: &[String],
    ) -> Result<Self> {
        if allowed_groups.is_empty()
            || allowed_groups.len() > 32
            || allowed_groups
                .iter()
                .any(|group| !group.starts_with('/') || group.len() > 256)
        {
            return Err(Error::config("OIDC requires 1..32 allowed group paths"));
        }
        for value in [issuer, origin] {
            let url = reqwest::Url::parse(value).map_err(|_| Error::config("invalid OIDC URL"))?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(Error::config(
                    "OIDC URLs require HTTPS without credentials, query or fragment",
                ));
            }
        }
        let url =
            reqwest::Url::parse(origin).map_err(|_| Error::config("invalid public origin"))?;
        if url.path() != "/"
            || origin.ends_with('/')
            || audience.is_empty()
            || audience.len() > 256
            || admin_group.is_empty()
        {
            return Err(Error::config(
                "invalid OIDC audience, origin or admin group",
            ));
        }
        let mut bytes = Vec::new();
        std::fs::File::open(key_path)?
            .take(16385)
            .read_to_end(&mut bytes)?;
        if bytes.len() > 16384 {
            return Err(Error::config("OIDC key size"));
        }
        let key = DecodingKey::from_rsa_pem(&bytes)
            .map_err(|_| Error::config("OIDC RSA public key is invalid"))?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[issuer]);
        validation.set_audience(&[audience]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.validate_nbf = true;
        validation.leeway = 5;
        Ok(Self {
            key,
            validation,
            origin: origin.into(),
            admin_group: admin_group.into(),
            allowed_groups: allowed_groups.to_vec(),
        })
    }
    pub fn identity(&self, headers: &HeaderMap) -> Result<Identity> {
        let denied = || Error::new("unauthenticated", "A valid UDS identity is required");
        if headers
            .get("origin")
            .is_some_and(|v| v.to_str().ok() != Some(self.origin.as_str()))
        {
            return Err(denied());
        }
        let bearer = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|v| !v.is_empty() && v.len() <= 16384)
            .ok_or_else(denied)?;
        let claims = decode::<Claims>(bearer, &self.key, &self.validation)
            .map_err(|_| denied())?
            .claims;
        if claims.sub.is_empty()
            || claims.sub.len() > 256
            || claims.email.len() > 320
            || claims.groups.len() > 128
            || claims.groups.iter().any(|s| s.len() > 256)
            || !claims
                .groups
                .iter()
                .any(|group| self.allowed_groups.contains(group))
        {
            return Err(denied());
        }
        // Private drafts use an issuer-scoped stable subject; display names/email can change.
        let username = format!(
            "oidc:{:x}",
            Sha256::digest(format!("{}\0{}", claims.iss, claims.sub).as_bytes())
        );
        let role = if claims.groups.contains(&self.admin_group) {
            "platform_admin"
        } else {
            "user"
        };
        Ok(Identity {
            username,
            email: claims.email,
            groups: claims.groups,
            role: role.into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Oidc, serde_json::Value) {
        // Only a public key and pre-signed synthetic tokens are stored; no signing key.
        let value: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/oidc.json")).unwrap();
        let path = std::env::temp_dir().join(format!(
            "parse-command-oidc-public-{}.pem",
            std::process::id()
        ));
        std::fs::write(&path, value["public_key"].as_str().unwrap()).unwrap();
        let oidc = Oidc::load(
            &path,
            "https://sso.uds.dev/realms/uds",
            "parse-command",
            "https://parse-command.uds.dev",
            "/Parse Command/Admin",
            &["/Parse Command/Admin".into()],
        )
        .unwrap();
        std::fs::remove_file(path).unwrap();
        (oidc, value)
    }
    #[test]
    fn verified_subject_owns_private_state_and_invalid_tokens_fail_closed() {
        let (oidc, value) = fixture();
        let headers = |name: &str| {
            let mut h = HeaderMap::new();
            h.insert(
                "authorization",
                format!("Bearer {}", value["tokens"][name].as_str().unwrap())
                    .parse()
                    .unwrap(),
            );
            h
        };
        let alice = oidc.identity(&headers("valid")).unwrap();
        assert_eq!(alice.role, "platform_admin");
        let mut denied_group = oidc.clone();
        denied_group.allowed_groups = vec!["/Unrelated/Users".into()];
        assert!(denied_group.identity(&headers("valid")).is_err());
        assert_eq!(
            alice.username,
            oidc.identity(&headers("renamed")).unwrap().username
        );
        assert_ne!(
            alice.username,
            oidc.identity(&headers("other_subject")).unwrap().username
        );
        for name in [
            "wrong_issuer",
            "wrong_audience",
            "expired",
            "not_yet_valid",
            "missing_exp",
        ] {
            assert!(oidc.identity(&headers(name)).is_err(), "{name}");
        }
        let mut h = headers("valid");
        h.insert("origin", "https://attacker.invalid".parse().unwrap());
        assert!(oidc.identity(&h).is_err());
        h.clear();
        h.insert(
            "cookie",
            "parse_command_session=pretend-admin".parse().unwrap(),
        );
        h.insert("x-auth-request-user", "admin".parse().unwrap());
        assert!(oidc.identity(&h).is_err());
        let mut token = value["tokens"]["valid"]
            .as_str()
            .unwrap()
            .to_owned()
            .into_bytes();
        let n = token.len() - 20;
        token[n] = if token[n] == b'A' { b'B' } else { b'A' };
        h.insert(
            "authorization",
            format!("Bearer {}", String::from_utf8(token).unwrap())
                .parse()
                .unwrap(),
        );
        assert!(oidc.identity(&h).is_err());
    }
}
