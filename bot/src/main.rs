//! Sud tizimi bot: a standalone server that reads the encrypted backup the app keeps in the operator's own Telegram channel, keeps the locator
//! (every case and bill number) in memory and answers in chat and in a Telegram Mini App. It never scrapes any site and never writes to the channel.

mod auth;
mod bot;
mod config;
mod crypto;
mod index;
mod store;
mod tg;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc, time::Duration};
use store::Shared;

const APP_HTML: &str = include_str!("../static/app.html");

type Sh = State<Arc<Shared>>;

fn err(code: StatusCode, msg: &str) -> Response {
    (code, Json(json!({ "ok": false, "error": msg }))).into_response()
}

/// the Mini App's calls carry Telegram's signed `initData`; only listed users pass
fn user_of(sh: &Shared, h: &HeaderMap) -> Result<i64, Response> {
    let init = h.get("x-init-data").and_then(|v| v.to_str().ok()).unwrap_or("");
    match auth::validate_init_data(init, &sh.cfg.token, store::now(), 24 * 3600) {
        Some(id) if bot::authorized(sh, id) => Ok(id),
        Some(_) => Err(err(StatusCode::FORBIDDEN, "Ruxsat yoʻq")),
        None => Err(err(StatusCode::UNAUTHORIZED, "Telegram ichida oching")),
    }
}

async fn health(State(sh): Sh) -> Json<Value> {
    Json(sh.info().await)
}

async fn app_page() -> Html<&'static str> {
    Html(APP_HTML)
}

async fn webhook(State(sh): Sh, Path(secret): Path<String>, headers: HeaderMap, Json(update): Json<Value>) -> StatusCode {
    let header_ok = headers.get("x-telegram-bot-api-secret-token").and_then(|v| v.to_str().ok()) == Some(sh.cfg.webhook_secret.as_str());
    if secret != sh.cfg.webhook_secret || !header_ok {
        return StatusCode::NOT_FOUND;
    }
    tokio::spawn(bot::handle_update(sh.clone(), update));
    StatusCode::OK
}

async fn api_search(State(sh): Sh, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if let Err(r) = user_of(&sh, &headers) {
        return r;
    }
    let hits = sh.search(q.get("q").map(|s| s.as_str()).unwrap_or(""), 30).await;
    Json(json!({ "ok": true, "hits": hits, "info": sh.info().await })).into_response()
}

async fn api_case(State(sh): Sh, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if let Err(r) = user_of(&sh, &headers) {
        return r;
    }
    match sh.case_detail(q.get("num").map(|s| s.as_str()).unwrap_or("")).await {
        Ok(c) => Json(json!({ "ok": true, "case": c })).into_response(),
        Err(e) => err(StatusCode::NOT_FOUND, &e),
    }
}

async fn api_bill(State(sh): Sh, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if let Err(r) = user_of(&sh, &headers) {
        return r;
    }
    match sh.bill_detail(q.get("num").map(|s| s.as_str()).unwrap_or("")).await {
        Ok(b) => Json(json!({ "ok": true, "bill": b })).into_response(),
        Err(e) => err(StatusCode::NOT_FOUND, &e),
    }
}

async fn api_companies(State(sh): Sh, headers: HeaderMap) -> Response {
    if let Err(r) = user_of(&sh, &headers) {
        return r;
    }
    Json(json!({ "ok": true, "companies": sh.companies().await, "info": sh.info().await })).into_response()
}

async fn api_company(State(sh): Sh, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if let Err(r) = user_of(&sh, &headers) {
        return r;
    }
    match sh.company(q.get("tin").map(|s| s.as_str()).unwrap_or("")).await {
        Some(c) => Json(json!({ "ok": true, "company": c })).into_response(),
        None => err(StatusCode::NOT_FOUND, "Bunday kompaniya zaxirada yoʻq"),
    }
}

fn num(q: &HashMap<String, String>, k: &str, default: usize, max: usize) -> usize {
    q.get(k).and_then(|v| v.parse::<usize>().ok()).unwrap_or(default).min(max)
}

async fn api_company_cases(State(sh): Sh, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if let Err(r) = user_of(&sh, &headers) {
        return r;
    }
    let get = |k: &str| q.get(k).map(|s| s.as_str()).unwrap_or("").to_string();
    Json(json!({ "ok": true, "cases": sh.company_cases(&get("tin"), &get("q"), &get("court"), num(&q, "offset", 0, 1_000_000), num(&q, "limit", 30, 100)).await })).into_response()
}

async fn api_company_bills(State(sh): Sh, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if let Err(r) = user_of(&sh, &headers) {
        return r;
    }
    let get = |k: &str| q.get(k).map(|s| s.as_str()).unwrap_or("").to_string();
    match sh.company_bills(&get("tin"), num(&q, "year", 0, 3000) as u32, &get("q"), num(&q, "offset", 0, 1_000_000), num(&q, "limit", 30, 100)).await {
        Ok(b) => Json(json!({ "ok": true, "bills": b })).into_response(),
        Err(e) => err(StatusCode::NOT_FOUND, &e),
    }
}

/// boot and then keep the locator fresh: a cheap check of the pinned manifest every few minutes, a download only when a new backup was made
async fn keep_synced(sh: Arc<Shared>) {
    let mut first = true;
    loop {
        match sh.sync().await {
            Ok(msg) => {
                if first || msg != "oʻzgarmagan" {
                    println!("[bot] sinxronlandi: {msg}");
                }
                first = false;
            }
            Err(e) => {
                eprintln!("[bot] sinxronlash xatosi: {e}");
                sh.st.write().await.error = Some(e);
            }
        }
        tokio::time::sleep(Duration::from_secs(sh.cfg.refresh_secs)).await;
    }
}

async fn register_webhook(sh: Arc<Shared>) {
    let Some(base) = sh.cfg.public_url.clone() else {
        println!("[bot] PUBLIC_URL yoʻq: webhook oʻrnatilmadi");
        return;
    };
    for attempt in 1..=5u64 {
        match sh.tg.set_webhook(&format!("{base}/tg/{}", sh.cfg.webhook_secret), &sh.cfg.webhook_secret).await {
            Ok(()) => {
                let _ = sh.tg.set_menu_button(&format!("{base}/app")).await;
                println!("[bot] webhook oʻrnatildi: {base}/tg/…");
                return;
            }
            Err(e) => {
                eprintln!("[bot] webhook xatosi: {e}");
                tokio::time::sleep(Duration::from_secs(3 * attempt)).await;
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let cfg = match config::Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[bot] sozlama xatosi: {e}");
            std::process::exit(2);
        }
    };
    let port = cfg.port;
    let set_webhook = cfg.set_webhook;
    if cfg.allowed.is_empty() {
        println!("[bot] ALLOWED_USER_IDS boʻsh: hamma ruxsatsiz hisoblanadi (bot oʻz ID sini yozib beradi)");
    }
    let sh = Shared::new(cfg);

    // the port opens at once (the host's health check); the backup is read in the background
    tokio::spawn(keep_synced(sh.clone()));
    if set_webhook {
        tokio::spawn(register_webhook(sh.clone()));
    }

    let app = Router::new()
        .route("/health", get(health))
        .route("/app", get(app_page))
        .route("/tg/{secret}", post(webhook))
        .route("/api/search", get(api_search))
        .route("/api/case", get(api_case))
        .route("/api/bill", get(api_bill))
        .route("/api/companies", get(api_companies))
        .route("/api/company", get(api_company))
        .route("/api/company/cases", get(api_company_cases))
        .route("/api/company/bills", get(api_company_bills))
        .with_state(sh);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.expect("port");
    println!("[bot] tinglanmoqda: 0.0.0.0:{port}");
    axum::serve(listener, app).await.expect("server");
}
