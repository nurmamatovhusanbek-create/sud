//! The two doors the operator's app calls (see `crate::link`): signed with a key derived from the bot token, body read as raw bytes so the signature covers it.

use super::Sh;
use crate::link::{pull_json, verify, SyncedBody};
use crate::state::now;
use axum::{
    body::Bytes,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

const MAX_BODY: usize = 64 * 1024;

fn signed(sh: &Sh, headers: &HeaderMap, path: &str, body: &[u8]) -> bool {
    let h = |n: &str| headers.get(n).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    body.len() <= MAX_BODY && verify(&sh.cfg.token, &h("x-sud-ts"), &h("x-sud-sig"), path, body, now())
}

fn refused() -> Response {
    // the same answer for a wrong signature, an old one and a missing one: nothing to learn from it
    (StatusCode::UNAUTHORIZED, Json(json!({ "ok": false, "error": "imzo notoʻgʻri" }))).into_response()
}

/// «the app made a backup»: the results of the requests it finished are kept, the bot is told to read now, and the people hear after it has looked
pub async fn synced(sh: Sh, headers: HeaderMap, body: Bytes) -> Response {
    if !signed(&sh, &headers, "/link/synced", &body) {
        return refused();
    }
    let parsed: SyncedBody = if body.is_empty() { SyncedBody::default() } else { match serde_json::from_slice(&body) { Ok(b) => b, Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "ok": false, "error": "soʻrov notoʻgʻri" }))).into_response() } };
    {
        let mut l = sh.link.lock().unwrap();
        let t = now();
        l.last_seen = t;
        for d in &parsed.done {
            l.finish(d.id, d.ok, &d.note, t);
        }
    }
    sh.wake.notify_one();
    Json(json!({ "ok": true })).into_response()
}

/// «anything for me to do?»: the requests nobody has taken yet; this is also how the bot knows the app is on
pub async fn pull(sh: Sh, headers: HeaderMap, body: Bytes) -> Response {
    if !signed(&sh, &headers, "/link/pull", &body) {
        return refused();
    }
    let jobs = {
        let mut l = sh.link.lock().unwrap();
        l.expire(now());
        l.pull(now())
    };
    Json(pull_json(&jobs)).into_response()
}
