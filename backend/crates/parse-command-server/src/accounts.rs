//! Read-only native account metadata used by shared workflow authorization.
pub use crate::private::token_hash as digest;
use crate::{Error, Result};
use parse_command_state::Store;
use serde::Serialize;
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub role: String,
    pub active: bool,
    pub created_at: String,
    pub last_login_at: Option<String>,
    pub previous_login_at: Option<String>,
    pub station_assignment: Option<crate::station::Assignment>,
    #[serde(skip)]
    pub station_revision: u64,
}
impl User {
    pub fn permissions(&self) -> Vec<&'static str> {
        if !self.active {
            return vec![];
        }
        match self.role.as_str() {
            "admin" => vec!["schedule:read", "draft:write", "users:manage"],
            "viewer" => vec!["schedule:read", "draft:write"],
            _ => vec![],
        }
    }
    pub fn require(&self, permission: &str) -> Result<()> {
        if self.permissions().contains(&permission) {
            Ok(())
        } else {
            Err(Error::new(
                "permission_denied",
                "Your account does not have permission for this action",
            ))
        }
    }
}

pub async fn account(store: &Store, owner: &str) -> Result<User> {
    let doc = store
        .get("user", owner)
        .await?
        .ok_or_else(|| Error::new("not_found", "Account not found"))?;
    let p = &doc.record.payload;
    Ok(User {
        id: owner.into(),
        username: crate::private::text(p, "username").into(),
        display_name: p["displayName"]
            .as_str()
            .unwrap_or(crate::private::text(p, "username"))
            .into(),
        email: crate::private::text(p, "email").into(),
        role: doc.record.category,
        active: p["enabled"] == true,
        created_at: crate::private::text(p, "created_at").into(),
        last_login_at: p["last_login"].as_str().map(str::to_owned),
        previous_login_at: p["previous_login"].as_str().map(str::to_owned),
        station_assignment: serde_json::from_value(p["stationAssignment"].clone())
            .map_err(|_| Error::unavailable())?,
        station_revision: p["stationRevision"].as_u64().unwrap_or(0),
    })
}
pub async fn message_scope(store: &Store, owner: &str) -> Result<crate::station::MessageScope> {
    let doc = store
        .get("user", owner)
        .await?
        .ok_or_else(|| Error::new("not_found", "Account not found"))?;
    let value = &doc.record.payload["accountSettings"]["messageScope"];
    if value.is_null() {
        return Ok(Default::default());
    }
    serde_json::from_value(value.clone())
        .map_err(|_| Error::config("Account source scope is invalid"))
}
