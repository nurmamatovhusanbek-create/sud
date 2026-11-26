//! The Mini App's JSON API. Every handler takes `AuthUser` and answers `{ ok: true, … }` or an `AppError`.

use super::{AuthUser, Sh};
use crate::error::{AppError, AppResult};
use axum::{extract::Query, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

type Q = Query<HashMap<String, String>>;

fn get<'a>(q: &'a HashMap<String, String>, k: &str) -> &'a str {
    q.get(k).map(|s| s.as_str()).unwrap_or("")
}

/// a number from the query, defaulted and capped (a page of a hundred rows at most)
fn num(q: &HashMap<String, String>, k: &str, default: usize, max: usize) -> usize {
    q.get(k).and_then(|v| v.parse::<usize>().ok()).unwrap_or(default).min(max)
}

fn tin(q: &HashMap<String, String>) -> AppResult<String> {
    let t = get(q, "tin");
    if t.len() == 9 && t.chars().all(|c| c.is_ascii_digit()) {
        Ok(t.to_string())
    } else {
        Err(AppError::BadRequest("STIR 9 ta raqamdan iborat boʻlishi kerak".into()))
    }
}

pub async fn companies(_u: AuthUser, sh: Sh) -> Json<Value> {
    Json(json!({ "ok": true, "companies": sh.companies().await, "info": sh.info().await }))
}

pub async fn overview(_u: AuthUser, sh: Sh, Query(q): Q) -> AppResult<Json<Value>> {
    Ok(Json(json!({ "ok": true, "overview": sh.overview(&tin(&q)?).await? })))
}

pub async fn search(_u: AuthUser, sh: Sh, Query(q): Q) -> Json<Value> {
    Json(json!({ "ok": true, "hits": sh.search(get(&q, "q"), 30).await, "info": sh.info().await }))
}

pub async fn case(_u: AuthUser, sh: Sh, Query(q): Q) -> AppResult<Json<Value>> {
    Ok(Json(json!({ "ok": true, "case": sh.case_view(get(&q, "num")).await? })))
}

pub async fn bill(_u: AuthUser, sh: Sh, Query(q): Q) -> AppResult<Json<Value>> {
    Ok(Json(json!({ "ok": true, "bill": sh.bill_view(get(&q, "num")).await? })))
}

pub async fn company(_u: AuthUser, sh: Sh, Query(q): Q) -> AppResult<Json<Value>> {
    let c = sh.company(&tin(&q)?).await.ok_or_else(|| AppError::NotFound("Bunday kompaniya zaxirada yoʻq".into()))?;
    Ok(Json(json!({ "ok": true, "company": c })))
}

pub async fn company_cases(_u: AuthUser, sh: Sh, Query(q): Q) -> AppResult<Json<Value>> {
    let page = sh.company_cases(&tin(&q)?, get(&q, "q"), get(&q, "court"), num(&q, "offset", 0, 1_000_000), num(&q, "limit", 30, 100)).await;
    Ok(Json(json!({ "ok": true, "cases": page })))
}

pub async fn company_bills(_u: AuthUser, sh: Sh, Query(q): Q) -> AppResult<Json<Value>> {
    let page = sh.company_bills(&tin(&q)?, num(&q, "year", 0, 3000) as u32, get(&q, "q"), num(&q, "offset", 0, 1_000_000), num(&q, "limit", 30, 100)).await?;
    Ok(Json(json!({ "ok": true, "bills": page })))
}

/// A page of the hearings of the next `days` days (default 14, at most 90; today included): `tin` narrows to one company, `q` to a case or a party,
/// `offset`/`limit` page the rows (30 by default, at most 100). The answer also carries the company cards and the counts behind the range chips.
pub async fn hearings(_u: AuthUser, sh: Sh, Query(q): Q) -> AppResult<Json<Value>> {
    let days = num(&q, "days", 14, crate::service::MAX_HEARING_DAYS as usize) as u32;
    let tin = get(&q, "tin");
    if !tin.is_empty() && !(tin.len() == 9 && tin.chars().all(|c| c.is_ascii_digit())) {
        return Err(AppError::BadRequest("STIR 9 ta raqamdan iborat boʻlishi kerak".into()));
    }
    let today = crate::date::today(crate::state::now());
    let page = sh.hearing_page(today, days, tin, get(&q, "q"), num(&q, "offset", 0, 100_000), num(&q, "limit", 30, 100)).await?;
    Ok(Json(json!({ "ok": true, "page": page })))
}

fn order_query(q: &HashMap<String, String>) -> crate::orders::Query {
    crate::orders::Query {
        q: get(q, "q").to_string(),
        court: get(q, "court").to_lowercase(),
        result: get(q, "result").to_string(),
        saved: match get(q, "saved") {
            "1" => Some(true),
            "0" => Some(false),
            _ => None,
        },
        year: q.get("year").and_then(|y| y.parse::<u32>().ok()).filter(|y| *y < 100),
        instance: get(q, "instance").to_lowercase(),
        cases: None,
    }
}

/// The court orders (the app's backup): `case=<number>` one case with all its instances and, when it has none, when the app checked it; `tin=<STIR>` a company's
/// orders; otherwise the filtered, paged list for the Qarorlar tab (`q`, `court`, `result`, `saved=1|0`, `year=26`, `offset`, `limit`, 30 by default, at most 100).
pub async fn orders(_u: AuthUser, sh: Sh, Query(q): Q) -> AppResult<Json<Value>> {
    let case = get(&q, "case");
    if !case.is_empty() {
        let n = crate::orders::norm(case);
        let rows = sh.orders_of_case(&n).await?;
        let check = if rows.is_empty() { sh.order_check_of(&n).await } else { None };
        return Ok(Json(json!({ "ok": true, "orders": { "total": rows.len(), "rows": rows.iter().map(crate::orders::to_json).collect::<Vec<_>>(), "check": check } })));
    }
    // `tin=<STIR>` narrows the filtered page to that company's cases (every other filter, the counts and the company cards still apply)
    let t = if get(&q, "tin").is_empty() { String::new() } else { tin(&q)? };
    let page = sh.orders_page(&order_query(&q), &t, num(&q, "offset", 0, 100_000), num(&q, "limit", 30, 100)).await?;
    Ok(Json(json!({ "ok": true, "orders": page })))
}

fn pdf_id_of(body: &Value) -> AppResult<String> {
    let id = body["pdfId"].as_str().unwrap_or("");
    if crate::orders::is_pdf_id(id) {
        Ok(id.to_string())
    } else {
        Err(AppError::BadRequest("Qaror identifikatori notoʻgʻri".into()))
    }
}

/// «Botga yuborish»: the bot sends that order's PDF to the person's own chat (the Mini App cannot open a PDF reliably inside Telegram's web view)
pub async fn orders_send(u: AuthUser, sh: Sh, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let id = pdf_id_of(&body)?;
    crate::chat::deliver_order(&sh, u.0, &id).await.map_err(|m| AppError::Upstream(if m.is_empty() { "Qaror yuborilmadi".into() } else { m }))?;
    Ok(Json(json!({ "ok": true })))
}

/// «Yuklash»: ask the app to download an order that was found but never downloaded (the same queue as the chat button). The answer says what became of the request
pub async fn orders_download(u: AuthUser, sh: Sh, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    use crate::link::Queued;
    let id = pdf_id_of(&body)?;
    let (asked, o) = sh.request_order_download(&id, u.0).await?;
    if o.saved {
        return Ok(Json(json!({ "ok": true, "status": "saved", "message": "Qaror allaqachon yuklangan: «Botga yuborish» ni bosing." })));
    }
    let status = match &asked {
        Queued::New => "queued",
        Queued::Joined => "joined",
        Queued::NotLinked => "not_linked",
        Queued::Full => "full",
        Queued::TooMany => "too_many",
        Queued::Recent(_) => "recent",
    };
    let message = crate::format::plain(&crate::chat::queued_text(asked, &format!("Qaror {} · {}", o.case, crate::orders::instance_word(&o.instance)), "yuklangan"));
    Ok(Json(json!({ "ok": true, "status": status, "message": message })))
}

