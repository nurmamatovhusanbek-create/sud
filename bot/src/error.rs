//! One error type for everything the HTTP side can answer. Every variant has a status and a sentence for the person; the body is always
//! `{ "ok": false, "error": "…" }`, the same shape the Mini App's `api.js` reads.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug)]
pub enum AppError {
    /// no (valid) Telegram launch data
    Unauthorized,
    /// signed by Telegram, but the person is not on the list
    Forbidden,
    NotFound(String),
    BadRequest(String),
    RateLimited,
    /// Telegram or the backup could not be read
    Upstream(String),
    /// the backup has not been read yet
    #[allow(dead_code)]
    NotReady,
}

impl AppError {
    pub fn status(&self) -> StatusCode {
        match self {
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden => StatusCode::FORBIDDEN,
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            AppError::Upstream(_) => StatusCode::BAD_GATEWAY,
            AppError::NotReady => StatusCode::SERVICE_UNAVAILABLE,
        }
    }

    pub fn message(&self) -> String {
        match self {
            AppError::Unauthorized => "Telegram ichida oching".into(),
            AppError::Forbidden => "Ruxsat yoʻq".into(),
            AppError::NotFound(m) | AppError::BadRequest(m) | AppError::Upstream(m) => m.clone(),
            AppError::RateLimited => "Juda koʻp soʻrov: bir daqiqadan soʻng qayta urining".into(),
            AppError::NotReady => "Zaxira hali yuklanmoqda".into(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.status(), Json(json!({ "ok": false, "error": self.message() }))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_error_has_a_status_and_a_sentence() {
        assert_eq!(AppError::Unauthorized.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(AppError::Forbidden.status(), StatusCode::FORBIDDEN);
        assert_eq!(AppError::NotFound("x".into()).status(), StatusCode::NOT_FOUND);
        assert_eq!(AppError::RateLimited.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(AppError::NotReady.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(AppError::Unauthorized.message().contains("Telegram"));
    }
}
