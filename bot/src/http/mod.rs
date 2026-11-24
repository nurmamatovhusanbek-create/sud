//! The HTTP side: a router over the shared state. Auth, rate limiting and error mapping live here once, not in every handler.

pub mod api;
pub mod assets;
pub mod link;
pub mod webhook;

use crate::auth::validate_init_data;
use crate::chat;
use crate::error::AppError;
use crate::state::{now, Shared};
use axum::{
    extract::{FromRequestParts, State},
    http::{request::Parts, StatusCode},
    routing::{get, post},
    Json, Router,
};
use std::sync::Arc;

pub type Sh = State<Arc<Shared>>;

/// A person who sent Telegram's signed launch data (`x-init-data`) and is on the list. Taking this as an argument IS the authentication: a handler
/// that does not take it is public. One call also spends one unit of the person's per-minute budget.
pub struct AuthUser(#[allow(dead_code)] pub i64);

impl FromRequestParts<Arc<Shared>> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, sh: &Arc<Shared>) -> Result<Self, AppError> {
        let init = parts.headers.get("x-init-data").and_then(|v| v.to_str().ok()).unwrap_or("");
        let id = validate_init_data(init, &sh.cfg.token, now(), 24 * 3600).ok_or(AppError::Unauthorized)?;
        if !chat::authorized(sh, id) {
            return Err(AppError::Forbidden);
        }
        if !sh.limiter.allow(id) {
            return Err(AppError::RateLimited);
        }
        Ok(AuthUser(id))
    }
}

async fn health(State(sh): Sh) -> Json<serde_json::Value> {
    Json(serde_json::to_value(sh.info().await).unwrap_or_default())
}

pub fn router(sh: Arc<Shared>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/app", get(assets::app_page))
        .route("/static/{*path}", get(assets::static_file))
        .route("/tg/{secret}", post(webhook::receive))
        .route("/link/synced", post(link::synced))
        .route("/link/pull", post(link::pull))
        .route("/api/companies", get(api::companies))
        .route("/api/overview", get(api::overview))
        .route("/api/hearings", get(api::hearings))
        .route("/api/search", get(api::search))
        .route("/api/case", get(api::case))
        .route("/api/bill", get(api::bill))
        .route("/api/company", get(api::company))
        .route("/api/company/cases", get(api::company_cases))
        .route("/api/company/bills", get(api::company_bills))
        .fallback(|| async { StatusCode::NOT_FOUND })
        .with_state(sh)
}
