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
