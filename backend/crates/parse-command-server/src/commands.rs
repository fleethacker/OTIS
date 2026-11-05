//! Read-only synthetic roster; this is not operational command-assignment authority.
use crate::{Error, Result, api::App};
use axum::{Json, extract::State, http::HeaderMap};
use parse_command_intake::demo::{Catalog, CONFIG_SOURCE};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Request {}

pub async fn list(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(_request): Json<Request>,
) -> Result<Json<Value>> {
    app.headers_identity(&headers)?;
    let catalog = Catalog::load().map_err(|_| Error::config("Synthetic roster configuration is invalid"))?;
    // Compile-time bounded (<=32 commands). No search request, source body or roster write.
    Ok(Json(json!({
        "commands": catalog.commands,
        "source": CONFIG_SOURCE,
        "version": catalog.version,
        "provenance": catalog.provenance,
        "assignmentEnabled": app.config.intake.demo_fixture_assignments,
    })))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn read_contract_rejects_write_or_identity_fields() {
        assert!(serde_json::from_str::<Request>("{}").is_ok());
        assert!(serde_json::from_str::<Request>(r#"{"actor":"dev-admin"}"#).is_err());
        assert!(serde_json::from_str::<Request>(r#"{"commands":[]}"#).is_err());
    }
}
