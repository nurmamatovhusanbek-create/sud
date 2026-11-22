//! Telegram's webhook: the secret is in the path AND in Telegram's header; the update is handled in the background so Telegram gets its answer at once.

use super::Sh;
use crate::chat;
use axum::{extract::Path, http::{HeaderMap, StatusCode}, Json};
use serde_json::Value;

pub async fn receive(sh: Sh, Path(secret): Path<String>, headers: HeaderMap, Json(update): Json<Value>) -> StatusCode {
    let header_ok = headers.get("x-telegram-bot-api-secret-token").and_then(|v| v.to_str().ok()) == Some(sh.cfg.webhook_secret.as_str());
    if secret != sh.cfg.webhook_secret || !header_ok {
        return StatusCode::NOT_FOUND;
    }
    tokio::spawn(chat::handle_update(sh.0.clone(), update));
    StatusCode::OK
}
