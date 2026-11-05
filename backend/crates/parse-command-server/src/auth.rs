//! Native OIDC sessions. Provider tokens stay encrypted in the hidden state index.
use crate::{
    Error, Result,
    api::{Identity, role_identity, session_token},
    private::{now, random_token, text, token_hash},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305, XNonce,
    aead::{Aead, Payload},
};
use openidconnect::{self as oidc, OAuth2TokenResponse as _, TokenResponse as _, core::*};
use parse_command_state::{Record, Store, epoch};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{io::Read, sync::Arc, time::Duration};
#[derive(Clone)]
pub struct Config {
    pub mode: String,
    pub public_url: String,
    pub issuer: String,
    pub client_id: String,
    pub client_secret: String,
    pub ca: Option<Vec<u8>>,
    pub key: Option<[u8; 32]>,
    pub admin_group: String,
    pub viewer_group: String,
}
fn required(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| Error::config(format!("{name} is required")))
}
fn secret_file(name: &str, max: u64) -> Result<Vec<u8>> {
    let path = required(name)?;
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(max + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max {
        return Err(Error::config("Secret file exceeds bound"));
    }
    Ok(bytes)
}
impl Config {
    pub fn load() -> Result<Self> {
        let mode = required("PARSE_COMMAND_AUTH_MODE")?;
        if !matches!(mode.as_str(), "local_demo" | "oidc") {
            return Err(Error::config(
                "Authentication mode must be local_demo or oidc",
            ));
        }
        let public_url = std::env::var("PARSE_COMMAND_PUBLIC_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8080".into());
        let origin =
            reqwest::Url::parse(&public_url).map_err(|_| Error::config("Invalid public URL"))?;
        if origin.host_str().is_none()
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
            || !origin.username().is_empty()
            || origin.password().is_some()
            || !matches!(origin.scheme(), "http" | "https")
        {
            return Err(Error::config("Public URL must be an origin"));
        }
        let mut c = Self {
            mode,
            public_url: public_url.trim_end_matches('/').into(),
            issuer: String::new(),
            client_id: String::new(),
            client_secret: String::new(),
            ca: None,
            key: None,
            admin_group: std::env::var("PARSE_COMMAND_ADMIN_GROUP")
                .unwrap_or_else(|_| "/Parse Command/Admin".into()),
            viewer_group: std::env::var("PARSE_COMMAND_VIEWER_GROUP")
                .unwrap_or_else(|_| "/Parse Command/Viewer".into()),
        };
        if c.mode == "oidc" {
            if origin.scheme() != "https" {
                return Err(Error::config("OIDC requires an HTTPS public URL"));
            }
            c.issuer = required("PARSE_COMMAND_OIDC_ISSUER")?
                .trim_end_matches('/')
                .into();
            let issuer =
                reqwest::Url::parse(&c.issuer).map_err(|_| Error::config("Invalid issuer"))?;
            if issuer.scheme() != "https"
                || issuer.host_str().is_none()
                || !issuer.username().is_empty()
                || issuer.password().is_some()
                || issuer.query().is_some()
                || issuer.fragment().is_some()
            {
                return Err(Error::config("OIDC issuer requires HTTPS"));
            }
            c.client_id = required("PARSE_COMMAND_OIDC_CLIENT_ID")?;
            c.client_secret =
                String::from_utf8(secret_file("PARSE_COMMAND_OIDC_CLIENT_SECRET_FILE", 8192)?)
                    .map_err(|_| Error::config("Invalid client secret"))?
                    .trim()
                    .into();
            if c.client_secret.is_empty() {
                return Err(Error::config("Empty client secret"));
            }
            let key = secret_file("PARSE_COMMAND_SESSION_KEY_FILE", 32)?;
            c.key = Some(
                key.try_into()
                    .map_err(|_| Error::config("Session key must contain exactly 32 bytes"))?,
            );
            if std::env::var_os("PARSE_COMMAND_IDP_CA_FILE").is_some() {
                c.ca = Some(secret_file("PARSE_COMMAND_IDP_CA_FILE", 262144)?);
            }
        }
        if c.admin_group.is_empty() || c.viewer_group.is_empty() || c.admin_group == c.viewer_group
        {
            return Err(Error::config(
                "Distinct Admin and Viewer groups are required",
            ));
        }
        Ok(c)
    }
    pub fn origin(&self, origin: Option<&str>) -> Result<()> {
        if origin.is_some_and(|o| o != self.public_url) {
            return Err(Error::new(
                "permission_denied",
                "Cross-origin request rejected",
            ));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
struct Groups {
    #[serde(default)]
    groups: Vec<String>,
}
impl oidc::AdditionalClaims for Groups {}
#[derive(Clone, Debug, Deserialize, Serialize)]
struct Extra {
    #[serde(default)]
    refresh_expires_in: Option<u64>,
}
impl oidc::ExtraTokenFields for Extra {}
type Token = oidc::StandardTokenResponse<
    oidc::IdTokenFields<
        Groups,
        Extra,
        CoreGenderClaim,
        CoreJweContentEncryptionAlgorithm,
        CoreJwsSigningAlgorithm,
    >,
    CoreTokenType,
>;
type Client = oidc::Client<
    Groups,
    CoreAuthDisplay,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJsonWebKey,
    CoreAuthPrompt,
    oidc::StandardErrorResponse<CoreErrorResponseType>,
    Token,
    CoreTokenIntrospectionResponse,
    CoreRevocableToken,
    CoreRevocationErrorResponse,
    oidc::EndpointSet,
    oidc::EndpointNotSet,
    oidc::EndpointNotSet,
    oidc::EndpointNotSet,
    oidc::EndpointMaybeSet,
    oidc::EndpointMaybeSet,
>;
#[derive(Clone)]
pub struct Auth {
    pub config: Config,
    store: Store,
    http: reqwest::Client,
    limit: Arc<tokio::sync::Semaphore>,
    refresh: Arc<tokio::sync::Mutex<()>>,
}
fn denied() -> Error {
    Error::new("unauthenticated", "Sign in to Parse Command")
}
impl Auth {
    pub fn new(config: Config, store: Store) -> Result<Self> {
        let mut client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(8))
            .pool_max_idle_per_host(2);
        if let Some(ca) = &config.ca {
            client = client.add_root_certificate(
                reqwest::Certificate::from_pem(ca).map_err(|_| Error::config("Invalid IdP CA"))?,
            );
        }
        Ok(Self {
            config,
            store,
            http: client.build().map_err(|_| Error::unavailable())?,
            limit: Arc::new(tokio::sync::Semaphore::new(2)),
            refresh: Arc::new(tokio::sync::Mutex::new(())),
        })
    }
    async fn http(
        &self,
        request: oidc::HttpRequest,
    ) -> std::result::Result<oidc::HttpResponse, std::io::Error> {
        let error = || std::io::Error::other("OIDC endpoint unavailable");
        let url = reqwest::Url::parse(&request.uri().to_string()).map_err(|_| error())?;
        let issuer = reqwest::Url::parse(&self.config.issuer).map_err(|_| error())?;
        if url.origin() != issuer.origin() || !url.username().is_empty() || url.password().is_some()
        {
            return Err(error());
        }
        let mut response = self
            .http
            .request(request.method().clone(), url)
            .headers(request.headers().clone())
            .body(request.body().clone())
            .send()
            .await
            .map_err(|_| error())?;
        let mut result = oidc::http::Response::builder().status(response.status());
        for (k, v) in response.headers() {
            result = result.header(k, v);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| error())? {
            if bytes.len() + chunk.len() > 1_048_576 {
                return Err(error());
            }
            bytes.extend_from_slice(&chunk);
        }
        result.body(bytes).map_err(|_| error())
    }
    async fn client(&self) -> Result<Client> {
        let metadata = CoreProviderMetadata::discover_async(
            oidc::IssuerUrl::new(self.config.issuer.clone())
                .map_err(|_| Error::config("Invalid issuer"))?,
            self,
        )
        .await
        .map_err(|_| Error::new("unavailable", "Identity provider unavailable"))?;
        // The browser redirect is also constrained, not only back-channel requests.
        let issuer = reqwest::Url::parse(&self.config.issuer).map_err(|_| Error::unavailable())?;
        if metadata.authorization_endpoint().url().origin() != issuer.origin() {
            return Err(Error::config(
                "Authorization endpoint is outside the configured issuer origin",
            ));
        }
        Ok(Client::from_provider_metadata(
            metadata,
            oidc::ClientId::new(self.config.client_id.clone()),
            Some(oidc::ClientSecret::new(self.config.client_secret.clone())),
        )
        .set_redirect_uri(
            oidc::RedirectUrl::new(format!("{}/auth/callback", self.config.public_url))
                .map_err(|_| Error::unavailable())?,
        ))
    }
    fn encrypt(&self, key: &str, value: &Value) -> Result<String> {
        let secret = self.config.key.as_ref().ok_or_else(Error::unavailable)?;
        let cipher = XChaCha20Poly1305::new(secret.into());
        let mut nonce = [0u8; 24];
        std::fs::File::open("/dev/urandom")?.read_exact(&mut nonce)?;
        let bytes = serde_json::to_vec(value).map_err(|_| Error::unavailable())?;
        let ciphertext = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &bytes,
                    aad: key.as_bytes(),
                },
            )
            .map_err(|_| Error::unavailable())?;
        let mut combined = nonce.to_vec();
        combined.extend(ciphertext);
        Ok(URL_SAFE_NO_PAD.encode(combined))
    }
    fn decrypt(&self, key: &str, value: &str) -> Result<Value> {
        let bytes = URL_SAFE_NO_PAD.decode(value).map_err(|_| denied())?;
        if bytes.len() < 40 || bytes.len() > 131072 {
            return Err(denied());
        }
        let cipher = XChaCha20Poly1305::new(
            self.config
                .key
                .as_ref()
                .ok_or_else(Error::unavailable)?
                .into(),
        );
        let clear = cipher
            .decrypt(
                XNonce::from_slice(&bytes[..24]),
                Payload {
                    msg: &bytes[24..],
                    aad: key.as_bytes(),
                },
            )
            .map_err(|_| denied())?;
        serde_json::from_slice(&clear).map_err(|_| denied())
    }
    pub async fn begin(&self, return_to: &str) -> Result<(String, String)> {
        if self.config.mode != "oidc" {
            return Err(Error::config("OIDC is disabled"));
        }
        let _permit = self
            .limit
            .try_acquire()
            .map_err(|_| Error::new("resource_exhausted", "Sign-in busy; retry"))?;
        let client = self.client().await?;
        let (challenge, verifier) = oidc::PkceCodeChallenge::new_random_sha256();
        let (url, state, nonce) = client
            .authorize_url(
                oidc::AuthenticationFlow::<CoreResponseType>::AuthorizationCode,
                oidc::CsrfToken::new_random,
                oidc::Nonce::new_random,
            )
            .add_scope(oidc::Scope::new("profile".into()))
            .add_scope(oidc::Scope::new("email".into()))
            .set_pkce_challenge(challenge)
            .url();
        let binding = random_token()?;
        let key = token_hash(state.secret());
        let expires = epoch() + 300;
        self.store
            .reserve("oidc_transactions", &key, expires, 128)
            .await?;
        let sealed=self.encrypt(&key,&json!({"binding":token_hash(&binding),"nonce":nonce.secret(),"verifier":verifier.secret(),"return":return_path(return_to)}))?;
        let mut row = Record::new("oidc_transaction", &key, json!({"sealed":sealed}));
        row.expires = expires;
        row.state = "pending".into();
        self.store.put(&row, None).await?;
        Ok((url.to_string(), binding))
    }
    pub async fn callback(
        &self,
        state: &str,
        code: &str,
        binding: &str,
    ) -> Result<(String, String)> {
        if self.config.mode != "oidc"
            || state.len() > 512
            || code.len() > 8192
            || binding.len() != 64
        {
            return Err(denied());
        }
        let _permit = self
            .limit
            .try_acquire()
            .map_err(|_| Error::new("resource_exhausted", "Sign-in busy; retry"))?;
        let key = token_hash(state);
        let doc = self
            .store
            .get("oidc_transaction", &key)
            .await?
            .ok_or_else(denied)?;
        if doc.record.expires <= epoch() || doc.record.state != "pending" {
            return Err(denied());
        }
        let transaction = self.decrypt(&key, text(&doc.record.payload, "sealed"))?;
        if transaction["binding"] != token_hash(binding) {
            return Err(denied());
        }
        let mut used = doc.record.clone();
        used.state = "consumed".into();
        self.store
            .put(&used, Some(&doc))
            .await
            .map_err(|_| denied())?;
        let client = self.client().await?;
        let token = client
            .exchange_code(oidc::AuthorizationCode::new(code.into()))
            .map_err(|_| denied())?
            .set_pkce_verifier(oidc::PkceCodeVerifier::new(
                text(&transaction, "verifier").into(),
            ))
            .request_async(self)
            .await
            .map_err(|_| denied())?;
        let session = random_token()?;
        let key = token_hash(&session);
        let row = self
            .session_record(
                &client,
                &token,
                &key,
                text(&transaction, "nonce"),
                None,
                false,
            )
            .await?;
        self.store
            .reserve(
                "oidc_sessions",
                &key,
                if row.expires == 0 {
                    i64::MAX
                } else {
                    row.expires
                },
                4096,
            )
            .await?;
        self.store.put(&row, None).await?;
        Ok((session, return_path(text(&transaction, "return")).into()))
    }
    async fn session_record(
        &self,
        client: &Client,
        token: &Token,
        key: &str,
        nonce: &str,
        previous: Option<&Record>,
        refresh: bool,
    ) -> Result<Record> {
        let id_token = token.id_token().ok_or_else(denied)?;
        let verifier = client.id_token_verifier();
        let claims = if refresh {
            id_token.claims(&verifier, |returned: Option<&oidc::Nonce>| {
                if returned.is_some_and(|n| n.secret() != nonce) {
                    Err("Nonce mismatch".into())
                } else {
                    Ok(())
                }
            })
        } else {
            id_token.claims(&verifier, &oidc::Nonce::new(nonce.into()))
        }
        .map_err(|_| denied())?;
        if claims
            .authorized_party()
            .is_some_and(|p| p.as_str() != self.config.client_id)
            || claims.audiences().len() > 1 && claims.authorized_party().is_none()
        {
            return Err(denied());
        }
        if let Some(expected) = claims.access_token_hash() {
            let actual = oidc::AccessTokenHash::from_token(
                token.access_token(),
                id_token.signing_alg().map_err(|_| denied())?,
                id_token.signing_key(&verifier).map_err(|_| denied())?,
            )
            .map_err(|_| denied())?;
            if expected != &actual {
                return Err(denied());
            }
        }
        let groups = &claims.additional_claims().groups;
        let role = role_for_groups(groups, &self.config.admin_group, &self.config.viewer_group)?;
        let owner = format!(
            "oidc:{}",
            token_hash(&format!(
                "{}\0{}",
                self.config.issuer,
                claims.subject().as_str()
            ))
        );
        if previous.is_some_and(|p| p.owner != owner) {
            return Err(denied());
        }
        let username = claims
            .preferred_username()
            .map(|v| v.as_str())
            .unwrap_or("Watchstander");
        let email = claims.email().map(|v| v.as_str()).unwrap_or("");
        if username.len() > 256
            || email.len() > 512
            || groups.len() > 128
            || groups.iter().any(|g| g.len() > 512)
        {
            return Err(denied());
        }
        let user = self
            .store
            .update("user", &owner, |old| {
                let mut row = old.cloned().unwrap_or_else(|| {
                    Record::new(
                        "user",
                        &owner,
                        json!({"enabled":true,"epoch":0,"created_at":now(),"timezone":"UTC"}),
                    )
                });
                if row.payload["enabled"] != true
                    || previous.is_some_and(|p| p.payload["user_epoch"] != row.payload["epoch"])
                {
                    return Err(parse_command_state::Error("access_revoked"));
                }
                row.owner = owner.clone();
                row.category = role.into();
                row.payload["username"] = json!(username);
                row.payload["email"] = json!(email);
                row.payload["groups"] = json!(groups);
                row.payload["issuer"] = json!(self.config.issuer);
                row.payload["subject"] = json!(claims.subject().as_str());
                if !refresh {
                    row.payload["last_login"] = json!(now());
                }
                Ok(row)
            })
            .await
            .map_err(|e| {
                if e.0 == "access_revoked" {
                    denied()
                } else {
                    e.into()
                }
            })?;
        let seconds = token.expires_in().ok_or_else(denied)?.as_secs();
        if seconds == 0 || seconds > i64::MAX as u64 {
            return Err(denied());
        }
        let valid_until = claims
            .expiration()
            .timestamp()
            .min(epoch().checked_add(seconds as i64).ok_or_else(denied)?);
        let refresh_token = if let Some(t) = token.refresh_token() {
            Some(t.secret().to_owned())
        } else if let Some(old) = previous {
            self.decrypt(key, text(&old.payload, "tokens"))?["refresh"]
                .as_str()
                .map(str::to_owned)
        } else {
            None
        };
        let refresh_seconds = token.extra_fields().extra_fields().refresh_expires_in;
        let expires = if refresh_token.is_none() {
            valid_until
        } else {
            match refresh_seconds {
                Some(0) => 0,
                Some(s) => epoch()
                    .checked_add(i64::try_from(s).map_err(|_| denied())?)
                    .ok_or_else(denied)?,
                None => previous.map(|p| p.expires).unwrap_or(valid_until),
            }
        };
        let encrypted = self.encrypt(
            key,
            &json!({"refresh":refresh_token,"id_token":id_token.to_string()}),
        )?;
        // The pinned Since last watch boundary survives token refresh.
        let pin = match previous.map(|p| &p.payload[crate::watch::PIN]) {
            Some(pin) if pin.is_object() => pin.clone(),
            _ => crate::watch::session_pin(&self.store, &owner).await?,
        };
        let mut row = Record::new(
            "oidc_session",
            key,
            json!({"username":username,"email":email,"role":role,"groups":groups,"nonce":nonce,"valid_until":valid_until,"tokens":encrypted,"user_epoch":user.record.payload["epoch"],"watch_since":pin}),
        );
        row.owner = owner;
        row.expires = expires;
        Ok(row)
    }
    pub async fn identity(&self, cookie: Option<&str>) -> Result<Identity> {
        let token = cookie
            .and_then(session_token)
            .filter(|v| v.len() == 64)
            .ok_or_else(denied)?;
        let doc = self
            .store
            .get("oidc_session", &token_hash(token))
            .await?
            .ok_or_else(denied)?;
        self.active(&doc.record).await?;
        if doc.record.payload["valid_until"].as_i64().unwrap_or(0) <= epoch() {
            return Err(denied());
        }
        Ok(Identity {
            username: text(&doc.record.payload, "username").into(),
            email: text(&doc.record.payload, "email").into(),
            groups: serde_json::from_value(doc.record.payload["groups"].clone())
                .map_err(|_| denied())?,
            role: text(&doc.record.payload, "role").into(),
            owner: doc.record.owner,
        })
    }
    async fn active(&self, row: &Record) -> Result<()> {
        if row.expires != 0 && row.expires <= epoch() {
            return Err(denied());
        }
        let user = self
            .store
            .get("user", &row.owner)
            .await?
            .ok_or_else(denied)?;
        if user.record.payload["enabled"] != true
            || user.record.payload["epoch"] != row.payload["user_epoch"]
        {
            return Err(denied());
        }
        Ok(())
    }
    pub async fn renew(&self, cookie: Option<&str>) -> Result<()> {
        let token = cookie
            .and_then(session_token)
            .filter(|v| v.len() == 64)
            .ok_or_else(denied)?;
        let key = token_hash(token);
        let _lock = self.refresh.lock().await;
        let doc = self
            .store
            .get("oidc_session", &key)
            .await?
            .ok_or_else(denied)?;
        self.active(&doc.record).await?;
        if doc.record.payload["valid_until"].as_i64().unwrap_or(0) > epoch() + 10 {
            return Ok(());
        }
        let sealed = self.decrypt(&key, text(&doc.record.payload, "tokens"))?;
        let refresh = sealed["refresh"].as_str().ok_or_else(denied)?;
        let client = self.client().await?;
        let token = client
            .exchange_refresh_token(&oidc::RefreshToken::new(refresh.into()))
            .map_err(|_| denied())?
            .request_async(self)
            .await
            .map_err(|_| denied())?;
        let row = self
            .session_record(
                &client,
                &token,
                &key,
                text(&doc.record.payload, "nonce"),
                Some(&doc.record),
                true,
            )
            .await?;
        self.active(&row).await?;
        self.store
            .reserve(
                "oidc_sessions",
                &key,
                if row.expires == 0 {
                    i64::MAX
                } else {
                    row.expires
                },
                4096,
            )
            .await?;
        self.store.put(&row, Some(&doc)).await?;
        Ok(())
    }
    pub async fn logout(&self, cookie: Option<&str>) -> Result<()> {
        if let Some(token) = cookie.and_then(session_token) {
            let key = token_hash(token);
            if let Some(doc) = self.store.get("oidc_session", &key).await? {
                self.store.delete(&doc).await?;
            }
            self.store.release("oidc_sessions", &key).await?;
        }
        Ok(())
    }
    pub async fn deadlines(&self, cookie: Option<&str>) -> Result<(i64, Option<i64>)> {
        let token = cookie.and_then(session_token).ok_or_else(denied)?;
        let doc = self
            .store
            .get("oidc_session", &token_hash(token))
            .await?
            .ok_or_else(denied)?;
        self.active(&doc.record).await?;
        Ok((
            doc.record.payload["valid_until"].as_i64().unwrap_or(0),
            (doc.record.expires != 0).then_some(doc.record.expires),
        ))
    }
}
pub fn role_for_groups(groups: &[String], admin: &str, viewer: &str) -> Result<&'static str> {
    if groups.iter().any(|g| g == admin) {
        Ok("admin")
    } else if groups.iter().any(|g| g == viewer) {
        Ok("viewer")
    } else {
        Err(Error::new(
            "permission_denied",
            "Account is not approved for Parse Command",
        ))
    }
}
pub fn return_path(value: &str) -> &str {
    if value.starts_with('/')
        && !value.starts_with("//")
        && !value.contains(['\\', '\r', '\n', '\0'])
    {
        value
    } else {
        "/calendar"
    }
}
pub fn demo_identity(role: &str) -> Result<Identity> {
    role_identity(role)
}

impl<'c> oidc::AsyncHttpClient<'c> for Auth {
    type Error = std::io::Error;
    type Future = std::pin::Pin<
        Box<
            dyn std::future::Future<Output = std::result::Result<oidc::HttpResponse, Self::Error>>
                + Send
                + 'c,
        >,
    >;
    fn call(&'c self, request: oidc::HttpRequest) -> Self::Future {
        Box::pin(self.http(request))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oidc::PrivateSigningKey as _;
    fn config() -> Config {
        Config {
            mode: "oidc".into(),
            public_url: "https://parse-command.uds.dev".into(),
            issuer: "https://sso.uds.dev/realms/uds".into(),
            client_id: "parse-command".into(),
            client_secret: "test-only".into(),
            ca: None,
            key: Some([7; 32]),
            admin_group: "/Parse Command/Admin".into(),
            viewer_group: "/Parse Command/Viewer".into(),
        }
    }
    #[test]
    fn approval_groups_origin_and_local_returns_fail_closed() {
        let c = config();
        assert_eq!(
            role_for_groups(
                &[c.viewer_group.clone(), c.admin_group.clone()],
                &c.admin_group,
                &c.viewer_group
            )
            .unwrap(),
            "admin"
        );
        assert!(role_for_groups(&["admin".into()], &c.admin_group, &c.viewer_group).is_err());
        assert!(role_for_groups(&[], &c.admin_group, &c.viewer_group).is_err());
        assert!(c.origin(Some("https://other.test")).is_err());
        assert!(c.origin(Some(&c.public_url)).is_ok());
        for bad in [
            "//external.test",
            "https://external.test",
            "/\\external.test",
            "/\r\nLocation: x",
        ] {
            assert_eq!(return_path(bad), "/calendar");
        }
        assert_eq!(return_path("/messages?q=hello"), "/messages?q=hello");
    }
    #[tokio::test]
    async fn encrypted_tokens_are_bound_to_the_record_and_detect_tampering() {
        let a = Auth::new(
            config(),
            Store::new("http://127.0.0.1:9", ".parse-command-test-auth").unwrap(),
        )
        .unwrap();
        let value = json!({"refresh":"test-token"});
        let sealed = a.encrypt("one", &value).unwrap();
        assert!(!sealed.contains("test-token"));
        assert_eq!(a.decrypt("one", &sealed).unwrap(), value);
        assert!(a.decrypt("other", &sealed).is_err());
        let mut bytes = URL_SAFE_NO_PAD.decode(sealed).unwrap();
        bytes[25] ^= 1;
        assert!(a.decrypt("one", &URL_SAFE_NO_PAD.encode(bytes)).is_err());
    }
    #[tokio::test]
    #[ignore = "requires isolated OpenSearch test indices"]
    async fn oidc_validates_signed_claims_stable_ownership_and_callback_replay() {
        let endpoint = std::env::var("PARSE_COMMAND_TEST_OPENSEARCH_URL").unwrap();
        let index = format!(".parse-command-test-oidc-{}", random_token().unwrap());
        let store = Store::new(&endpoint, &index).unwrap();
        store.provision().await.unwrap();
        let c = config();
        let auth = Auth::new(c.clone(), store.clone()).unwrap();
        // Deterministic, test-only Ed25519 seeds. Exercise asymmetric JWKS
        // verification, including at_hash, without an external identity provider.
        let signing_key = |seed: u8| {
            let mut der = vec![
                0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22,
                0x04, 0x20,
            ];
            der.extend([seed; 32]);
            let pem = format!(
                "-----BEGIN PRIVATE KEY-----\n{}\n-----END PRIVATE KEY-----",
                base64::engine::general_purpose::STANDARD.encode(der)
            );
            CoreEdDsaPrivateSigningKey::from_ed25519_pem(&pem, None).unwrap()
        };
        let good_key = signing_key(5);
        let wrong_key = signing_key(6);
        let metadata = CoreProviderMetadata::new(
            oidc::IssuerUrl::new(c.issuer.clone()).unwrap(),
            oidc::AuthUrl::new(format!("{}/auth", c.issuer)).unwrap(),
            oidc::JsonWebKeySetUrl::new(format!("{}/keys", c.issuer)).unwrap(),
            vec![oidc::ResponseTypes::new(vec![CoreResponseType::Code])],
            vec![CoreSubjectIdentifierType::Public],
            vec![CoreJwsSigningAlgorithm::EdDsa],
            oidc::EmptyAdditionalProviderMetadata {},
        )
        .set_jwks(CoreJsonWebKeySet::new(vec![good_key.as_verification_key()]));
        let client: Client = Client::from_provider_metadata(
            metadata,
            oidc::ClientId::new(c.client_id.clone()),
            Some(oidc::ClientSecret::new(c.client_secret.clone())),
        );
        let claims = json!({"iss":c.issuer,"sub":"stable-subject","aud":[c.client_id],"exp":epoch()+120,"iat":epoch(),"nonce":"nonce","groups":[c.viewer_group],"preferred_username":"first-name","email":"same@example.invalid"});
        let signed = |claims: Value, key: &CoreEdDsaPrivateSigningKey| -> Token {
            let access = oidc::AccessToken::new("test-access".into());
            let id = oidc::IdToken::new(
                serde_json::from_value::<oidc::IdTokenClaims<Groups, CoreGenderClaim>>(claims)
                    .unwrap(),
                key,
                CoreJwsSigningAlgorithm::EdDsa,
                Some(&access),
                None,
            )
            .unwrap();
            let mut token = Token::new(
                access,
                CoreTokenType::Bearer,
                oidc::IdTokenFields::new(
                    Some(id),
                    Extra {
                        refresh_expires_in: Some(300),
                    },
                ),
            );
            token.set_expires_in(Some(&Duration::from_secs(120)));
            token.set_refresh_token(Some(oidc::RefreshToken::new("test-refresh".into())));
            token
        };
        let first = auth
            .session_record(
                &client,
                &signed(claims.clone(), &good_key),
                "session-key",
                "nonce",
                None,
                false,
            )
            .await
            .unwrap();
        // The access token expires before the IdP permits session renewal.
        // Present both deadlines without treating token refresh as a new login.
        let session_cookie = random_token().unwrap();
        let cookie = format!("parse_command_session={session_cookie}");
        let mut saved = first.clone();
        saved.key = token_hash(&session_cookie);
        store.put(&saved, None).await.unwrap();
        let (access_until, session_until) = auth.deadlines(Some(&cookie)).await.unwrap();
        assert_eq!(access_until, first.payload["valid_until"].as_i64().unwrap());
        assert_eq!(session_until, Some(first.expires));
        assert!(session_until.unwrap() > access_until);
        for (field, value) in [
            ("iss", json!("https://other.invalid")),
            ("aud", json!(["other-client"])),
            ("exp", json!(epoch() - 60)),
            ("nonce", json!("other-nonce")),
            ("groups", json!([])),
            ("azp", json!("other-client")),
            ("aud", json!([c.client_id, "extra"])),
        ] {
            let mut bad = claims.clone();
            bad[field] = value;
            assert!(
                auth.session_record(
                    &client,
                    &signed(bad, &good_key),
                    "session-key",
                    "nonce",
                    None,
                    false
                )
                .await
                .is_err(),
                "accepted invalid {field}"
            );
        }
        assert!(
            auth.session_record(
                &client,
                &signed(claims.clone(), &wrong_key),
                "session-key",
                "nonce",
                None,
                false
            )
            .await
            .is_err()
        );
        let mut wrong_access = signed(claims.clone(), &good_key);
        wrong_access.set_access_token(oidc::AccessToken::new("different-access".into()));
        assert!(
            auth.session_record(&client, &wrong_access, "session-key", "nonce", None, false)
                .await
                .is_err()
        );
        let mut renamed = claims.clone();
        renamed["preferred_username"] = json!("renamed");
        let renamed = auth
            .session_record(
                &client,
                &signed(renamed, &good_key),
                "session-key",
                "nonce",
                Some(&first),
                true,
            )
            .await
            .unwrap();
        assert_eq!(renamed.owner, first.owner);
        let mut different = claims.clone();
        different["sub"] = json!("another-subject");
        assert!(
            auth.session_record(
                &client,
                &signed(different, &good_key),
                "session-key",
                "nonce",
                Some(&first),
                true
            )
            .await
            .is_err()
        );
        let state = "test-state";
        let key = token_hash(state);
        let binding = random_token().unwrap();
        let sealed=auth.encrypt(&key,&json!({"binding":token_hash(&binding),"nonce":"nonce","verifier":"verifier","return":"/calendar"})).unwrap();
        let mut transaction = Record::new("oidc_transaction", &key, json!({"sealed":sealed}));
        transaction.state = "pending".into();
        transaction.expires = epoch() + 120;
        store.put(&transaction, None).await.unwrap();
        assert!(
            auth.callback(state, "code", &random_token().unwrap())
                .await
                .is_err()
        );
        assert_eq!(
            store
                .get("oidc_transaction", &key)
                .await
                .unwrap()
                .unwrap()
                .record
                .state,
            "pending"
        );
        store
            .update("oidc_transaction", &key, |old| {
                let mut row = old.unwrap().clone();
                row.state = "consumed".into();
                Ok(row)
            })
            .await
            .unwrap();
        assert!(auth.callback(state, "code", &binding).await.is_err());
        store
            .request(reqwest::Method::DELETE, &format!("/{index}"), None)
            .await
            .unwrap();
    }
}
