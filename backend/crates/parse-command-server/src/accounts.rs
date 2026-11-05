//! Profile metadata shares native authentication's stable user records and ownership.
pub use crate::private::{random_token, token_hash as digest};
use crate::{
    Error, Result,
    api::App,
    station::{Assignment, AssignmentPatch},
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use parse_command_state::Store;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub timezone: String,
    pub calendar_refresh_seconds: u32,
    pub default_calendar_view: String,
    #[serde(default)]
    pub message_scope: crate::briefing::MessageScope,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            timezone: "UTC".into(),
            calendar_refresh_seconds: 30,
            default_calendar_view: "day".into(),
            message_scope: Default::default(),
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<()> {
        if self.timezone.parse::<chrono_tz::Tz>().is_err()
            || !matches!(self.calendar_refresh_seconds, 0 | 30 | 60 | 300)
            || !matches!(
                self.default_calendar_view.as_str(),
                "day" | "week" | "month"
            )
        {
            return Err(Error::invalid(
                "Choose a supported timezone, refresh interval and calendar view",
            ));
        }
        self.message_scope.validate()?;
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserUpdate {
    #[serde(default)]
    pub station_assignment: crate::station::AssignmentPatch,
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
pub async fn preferences(store: &Store, owner: &str) -> Result<Settings> {
    let doc = store
        .get("user", owner)
        .await?
        .ok_or_else(Error::unavailable)?;
    let p = &doc.record.payload;
    let mut out: Settings = if p["accountSettings"].is_object() {
        serde_json::from_value(p["accountSettings"].clone()).map_err(|_| Error::unavailable())?
    } else {
        Settings::default()
    };
    out.timezone = p["timezone"].as_str().unwrap_or("UTC").into();
    Ok(out)
}
pub async fn profile(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    let mut user = account(&app.private.state, &identity.owner).await?;
    user.role = identity.role.clone();
    let settings = preferences(&app.private.state, &identity.owner).await?;
    let window = crate::briefing::session_window(&app, &headers).await?;
    Ok(Json(
        json!({"authenticated":true,"authMode":app.config.auth.mode,"loginUrl":"/auth/login","permissions":user.permissions(),"user":user,"settings":settings,"login":window,"openBriefing":false,"stationAssignmentRequired":crate::station::required()?}),
    ))
}
pub async fn save_settings(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(settings): Json<Settings>,
) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    settings.validate()?;
    crate::responsibilities::resolve(
        &app.private.state,
        &settings.message_scope.responsibility_ids,
    )
    .await?;
    app.private
        .state
        .update("user", &identity.owner, |old| {
            let mut row = old
                .cloned()
                .ok_or(parse_command_state::Error("state_missing"))?;
            row.payload["timezone"] = json!(settings.timezone);
            row.payload["accountSettings"] = json!(settings);
            Ok(row)
        })
        .await?;
    Ok(Json(json!(settings)))
}
pub async fn users(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    crate::settings::admin(&identity)?;
    let docs = app.private.state.list("user", vec![], 1000).await?;
    let mut items = Vec::new();
    for doc in docs {
        items.push(account(&app.private.state, &doc.record.key).await?);
    }
    Ok(Json(json!({"users":items})))
}
pub async fn update_user(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(update): Json<UserUpdate>,
) -> Result<Json<Value>> {
    let identity = app.headers_identity(&headers).await?;
    crate::settings::admin(&identity)?;
    let before = account(&app.private.state, &id).await?;
    if matches!(update.station_assignment, AssignmentPatch::Keep) {
        return Ok(Json(json!({"user":before})));
    }
    let assignment = match &update.station_assignment {
        AssignmentPatch::Keep => before.station_assignment.clone(),
        AssignmentPatch::Clear => None,
        AssignmentPatch::Set(input) => {
            input.validate()?;
            crate::responsibilities::resolve(&app.private.state, &input.responsibility_ids).await?;
            Some(Assignment {
                details: input.clone(),
                revision: before.station_revision + 1,
                source: "admin".into(),
            })
        }
    };
    app.private.state.update("user",&id,|old|{
        let mut row=old.cloned().ok_or(parse_command_state::Error("state_missing"))?;
        if row.payload["stationRevision"].as_u64().unwrap_or(0)!=before.station_revision {return Err(parse_command_state::Error("state_conflict"));}
        row.payload["epoch"]=json!(row.payload["epoch"].as_u64().unwrap_or(0)+1);
        if !matches!(update.station_assignment,AssignmentPatch::Keep) {
            row.payload["stationAssignment"]=json!(assignment);
            row.payload["stationRevision"]=json!(before.station_revision+1);
        }
        let mut audit=row.payload["access_audit"].as_array().cloned().unwrap_or_default();
        audit.push(json!({"actor":identity.owner,"at":crate::private::now(),"action":"profile_updated","stationAssignment":assignment}));
        if audit.len()>100 {audit.remove(0);}
        row.payload["access_audit"]=json!(audit);
        Ok(row)
    }).await?;
    Ok(Json(json!({"user":account(&app.private.state,&id).await?})))
}
