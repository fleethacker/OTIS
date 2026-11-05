use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
#[derive(Debug, Clone)]
pub struct Error {
    pub code: &'static str,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, Error>;
impl Error {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_argument", message)
    }
    pub fn config(message: impl Into<String>) -> Self {
        Self::new("failed_precondition", message)
    }
    pub fn unavailable() -> Self {
        Self::new(
            "unavailable",
            "Source is unavailable; previous results are not a fresh read",
        )
    }
    pub fn rpc(self) -> connectrpc::ConnectError {
        match self.code {
            "invalid_argument" => connectrpc::ConnectError::invalid_argument(self.message),
            "unauthenticated" => connectrpc::ConnectError::unauthenticated(self.message),
            "permission_denied" => connectrpc::ConnectError::permission_denied(self.message),
            "not_found" => connectrpc::ConnectError::not_found(self.message),
            "failed_precondition" => connectrpc::ConnectError::failed_precondition(self.message),
            "resource_exhausted" => connectrpc::ConnectError::resource_exhausted(self.message),
            _ => connectrpc::ConnectError::unavailable(self.message),
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for Error {}
impl From<rusqlite::Error> for Error {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("unavailable", "Private storage is unavailable")
    }
}
impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::new("unavailable", "Local storage is unavailable")
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let status = match self.code {
            "invalid_argument" => StatusCode::BAD_REQUEST,
            "unauthenticated" => StatusCode::UNAUTHORIZED,
            "permission_denied" => StatusCode::FORBIDDEN,
            "not_found" => StatusCode::NOT_FOUND,
            "resource_exhausted" => StatusCode::TOO_MANY_REQUESTS,
            "failed_precondition" => StatusCode::PRECONDITION_FAILED,
            _ => StatusCode::SERVICE_UNAVAILABLE,
        };
        (
            status,
            [("Cache-Control", "no-store")],
            Json(json!({"code":self.code,"message":self.message})),
        )
            .into_response()
    }
}
