//! Application write boundary. Session resolution stays owned by App::headers_identity.
use crate::{Error, Result, api::{App, Identity}};
use axum::http::HeaderMap;

/// Call for every new settings/roster mutation; persist the returned username as actor.
/// The future user-lifecycle implementation replaces session resolution, not this check.
pub fn require_admin(app: &App, headers: &HeaderMap) -> Result<Identity> {
    admin(app.headers_identity(headers)?)
}
fn admin(identity: Identity) -> Result<Identity> {
    if identity.role != "platform_admin" || identity.username.is_empty() {
        return Err(Error::new("permission_denied", "Platform administrator permission is required"));
    }
    Ok(identity)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn role_check_returns_the_server_identity_not_a_client_actor() {
        assert_eq!(admin(crate::api::role_identity("user").unwrap()).err().unwrap().code, "permission_denied");
        let actor = admin(crate::api::role_identity("platform_admin").unwrap()).unwrap();
        assert_eq!(actor.username, "dev-admin");
        let mut disabled = actor;
        disabled.role = "disabled".into();
        assert!(admin(disabled).is_err());
    }
}
