//! The chat side: commands and buttons. Only the listed users are answered; everyone else gets their own Telegram id (so the owner can list it) and
//! nothing else. Text is built from the typed answers of `service.rs`; sending goes through `Outbox`, so every handler is testable without Telegram.

use crate::domain::{Bill, CaseView, Company};
use crate::error::AppResult;
use crate::state::Shared;
use serde_json::{json, Value};
use std::sync::Arc;

const HELP: &str = "Sud tizimi boti: Telegramdagi shifrlangan zaxiradan qidiradi.\n\n\
Ish raqami (2-1004-2603/8020), kvitansiya raqami yoki STIR yozing: shunchaki xabar yuborish yetarli.\n\n\
/find <matn>: qidirish\n/case <ish raqami>: ish maʼlumoti\n/bill <raqam>: kvitansiya\n/company <STIR>: kompaniya\n/app: qidiruv oynasi (Mini App)\n/status: zaxira holati";

pub fn authorized(sh: &Shared, user: i64) -> bool {
    sh.cfg.allowed.contains(&user)
}

fn fmt_int(n: i64) -> String {
    let s = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            out.push('\u{a0}');
        }
        out.push(c);
    }
    let r: String = out.chars().rev().collect();
    if n < 0 { format!("-{r}") } else { r }
}

/// `2026-11-22T17:41:29.546Z` → `22.11.2026`
fn dmy_iso(iso: &str) -> String {
    let d = iso.get(0..10).unwrap_or("");
    let p: Vec<&str> = d.split('-').collect();
    if p.len() == 3 { format!("{}.{}.{}", p[2], p[1], p[0]) } else { iso.to_string() }
}

/// epoch ms → `22.11.2026` in Uzbekistan time (UTC+5, no summer time)
pub fn dmy_ms(ms: i64) -> String {
    if ms <= 0 {
        return "-".into();
    }
    let days = (ms + 5 * 3_600_000) / 86_400_000;
    let z = days + 719_468; // civil-from-days (Howard Hinnant)
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:02}.{:02}.{}", d, m, if m <= 2 { y + 1 } else { y })
}

/// a text field, "" when missing, empty or the registry's "-"
fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().filter(|x| !x.is_empty() && *x != "-").unwrap_or("")
}

fn text(v: &Value) -> &str {
    v.as_str().filter(|x| !x.is_empty() && *x != "-").unwrap_or("")
}

/// tiyin → so'm
fn som(v: &Value) -> String {
    fmt_int(v.as_i64().unwrap_or(0) / 100)
}

pub fn hit_line(h: &Value) -> String {
    match h["kind"].as_str() {
        Some("company") => format!("🏢 STIR {} · {} toʻlov · {} ish", h["tin"].as_str().unwrap_or(""), fmt_int(h["bills"].as_i64().unwrap_or(0)), fmt_int(h["found"].as_i64().unwrap_or(0))),
        Some("bill") => format!("🧾 {} · {}{}", h["key"].as_str().unwrap_or(""), h["year"], if s(h, "caseNumber").is_empty() { String::new() } else { format!(" · ish {}", h["caseNumber"].as_str().unwrap_or("")) }),
        _ => format!("⚖️ {} · {} · 20{}", h["key"].as_str().unwrap_or(""), h["court"].as_str().unwrap_or(""), h["year"]),
    }
}

pub fn hit_button(h: &Value) -> Value {
    let key = h["key"].as_str().unwrap_or("");
    let (label, data) = match h["kind"].as_str() {
        Some("company") => (format!("🏢 {}", h["tin"].as_str().unwrap_or("")), format!("k:{}", h["tin"].as_str().unwrap_or(""))),
        Some("bill") => (format!("🧾 {key}"), format!("b:{key}")),
        _ => (format!("⚖️ {key}"), format!("c:{key}")),
    };
    json!([{ "text": label, "callback_data": data }])
}

pub fn case_text(c: &CaseView) -> String {
    let mut out = format!("⚖️ Ish {}\n", c.num);
    let mut line = |label: &str, v: &str| {
        if !v.is_empty() {
            out.push_str(&format!("{label}: {v}\n"));
        }
    };
    let g = &c.detail["general"];
    if g.is_object() {
        for (label, k) in [("Holati", "caseStatus"), ("Turi", "caseType"), ("Sud", "court"), ("Sudya", "judge"), ("Daʼvogar", "plaintiff"), ("Javobgar", "defendant"), ("Daʼvo summasi", "claimAmount"), ("Ariza sanasi", "applicationDate")] {
            line(label, s(g, k));
        }
    } else if c.row.is_object() {
        for (label, k) in [("Holati", "caseStatus"), ("Turi", "caseType"), ("Sud", "courtName"), ("Sudya", "judge"), ("Daʼvogar", "plaintiff"), ("Javobgar", "defendant"), ("Daʼvo summasi", "claimAmount"), ("Ariza sanasi", "dateFiled"), ("Natija", "result")] {
            line(label, s(&c.row, k));
        }
    } else {
        out.push_str("Batafsil maʼlumot zaxirada yoʻq (faqat kvitansiyalar orqali maʼlum).\n");
    }
    for (title, key) in [("1-instansiya", "firstInstance"), ("Apellyatsiya", "appellate"), ("Kassatsiya", "cassation"), ("Taftish", "inspection")] {
        let ins = &c.detail[key];
        if !ins.is_object() {
            continue;
        }
        out.push_str(&format!("\n— {title}\n"));
        if let Some(hs) = ins["hearings"].as_array() {
            for h in hs.iter().take(4) {
                out.push_str(&format!("📅 {} {} · {}\n", s(h, "date"), s(h, "time"), s(h, "status")));
            }
            if hs.len() > 4 {
                out.push_str(&format!("… yana {} ta majlis\n", hs.len() - 4));
            }
        }
        let d = &ins["decision"];
        if d.is_object() {
            out.push_str(&format!("⚖️ Qaror {}: {}\n", s(d, "date"), s(d, "text")));
        }
    }
    out.push_str(&format!("\nSTIR: {} · {}\n", c.tin, c.court));
    for b in &c.bills {
        out.push_str(&format!("🧾 {} · {} · {}\n", text(&b.number), text(&b.cat), som(&b.amount)));
    }
    out
}

pub fn bill_text(b: &Bill) -> String {
    format!(
        "🧾 Kvitansiya {}\nHolati: {}\nTuri: {}\nSud: {}\nSumma: {} · toʻlangan: {}\nBerilgan: {}\n{}STIR: {}",
        text(&b.number),
        text(&b.status),
        text(&b.cat),
        text(&b.court),
        som(&b.amount),
        som(&b.paid),
        dmy_ms(b.issued.as_i64().unwrap_or(0)),
        if text(&b.case_number).is_empty() { String::new() } else { format!("Ish: {}\n", text(&b.case_number)) },
        text(&b.tin)
    )
}

pub fn company_text(c: &Company) -> String {
    format!("🏢 STIR {}\nToʻlovlar: {}\nTopilgan ishlar: {}\nBirinchi yuklash: {}\nMaʼlumot holati: {}", c.tin, fmt_int(c.bills as i64), fmt_int(c.found as i64), dmy_ms(c.first_at), dmy_ms(c.refreshed_at))
}

/// a button that opens the Mini App straight on this item (`/app?case=…`)
fn app_button(sh: &Shared, param: &str, key: &str) -> Option<Value> {
    let base = sh.cfg.public_url.as_ref()?;
    let q: String = form_urlencoded::Serializer::new(String::new()).append_pair(param, key).finish();
    Some(json!({ "inline_keyboard": [[{ "text": "Mini App'da ochish", "web_app": { "url": format!("{base}/app?{q}") } }]] }))
}

async fn search_reply(sh: &Arc<Shared>, chat: i64, q: &str) {
    let hits = sh.search(q, 8).await;
    if hits.is_empty() {
        sh.outbox.send(chat, "Topilmadi. Ish raqami (2-1004-2603), kvitansiya raqami (6+ raqam) yoki STIR (3+ raqam) yozing.", None).await;
        return;
    }
    let body = hits.iter().map(hit_line).collect::<Vec<_>>().join("\n");
    let kb: Vec<Value> = hits.iter().map(hit_button).collect();
    sh.outbox.send(chat, &body, Some(json!({ "inline_keyboard": kb }))).await;
}

async fn show(sh: &Arc<Shared>, chat: i64, what: &str, key: &str) {
    let (reply, param): (AppResult<String>, &str) = match what {
        "c" => (sh.case_view(key).await.map(|c| case_text(&c)), "case"),
        "b" => (sh.bill_view(key).await.map(|b| bill_text(&b)), "bill"),
        _ => (sh.company(key).await.map(|c| company_text(&c)).ok_or_else(|| crate::error::AppError::NotFound("Bunday kompaniya zaxirada yoʻq".into())), "company"),
    };
    match reply {
        Ok(t) => sh.outbox.send(chat, &t, app_button(sh, param, key)).await,
        Err(e) => sh.outbox.send(chat, &e.message(), None).await,
    }
}

pub async fn handle_update(sh: Arc<Shared>, u: Value) {
    if let Some(cb) = u.get("callback_query") {
        let uid = cb["from"]["id"].as_i64().unwrap_or(0);
        let chat = cb["message"]["chat"]["id"].as_i64().unwrap_or(uid);
        sh.outbox.answer_callback(cb["id"].as_str().unwrap_or("")).await;
        if !authorized(&sh, uid) || !sh.limiter.allow(uid) {
            return;
        }
        if let Some((w, k)) = cb["data"].as_str().unwrap_or("").split_once(':') {
            show(&sh, chat, w, k).await;
        }
        return;
    }
    let Some(m) = u.get("message") else { return };
    let uid = m["from"]["id"].as_i64().unwrap_or(0);
    let chat = m["chat"]["id"].as_i64().unwrap_or(uid);
    let body = m["text"].as_str().unwrap_or("").trim();
    if body.is_empty() {
        return;
    }
    if !authorized(&sh, uid) {
        eprintln!("[bot] ruxsatsiz urinish: id={uid}");
        sh.outbox.send(chat, &format!("Ruxsat yoʻq. Sizning Telegram ID: {uid}\n\nBot egasi bu raqamni ALLOWED_USER_IDS ga qoʻshishi kerak."), None).await;
        return;
    }
    if !sh.limiter.allow(uid) {
        sh.outbox.send(chat, "Juda koʻp soʻrov. Bir daqiqadan soʻng urinib koʻring.", None).await;
        return;
    }
    let (cmd, arg) = match body.split_once(char::is_whitespace) {
        Some((c, a)) => (c, a.trim()),
        None => (body, ""),
    };
    let cmd = cmd.split('@').next().unwrap_or(cmd);
    if matches!(cmd, "/start" | "/help") {
        sh.outbox.send(chat, HELP, None).await;
        return;
    }
    let info = sh.info().await;
    if !info.ready {
        sh.outbox.send(chat, &format!("Zaxira hali yuklanmoqda…{}", info.error.map(|e| format!("\n{e}")).unwrap_or_default()), None).await;
        return;
    }
    match cmd {
        "/status" => {
            let degraded = if info.failures > 0 { format!("\nOxirgi {} ta yangilash muvaffaqiyatsiz: eski zaxiradan javob beryapman.", info.failures) } else { String::new() };
            sh.outbox.send(chat, &format!("Zaxira: {}\nYozuvlar: {} · kompaniyalar: {}{degraded}", dmy_iso(info.backup_at.as_deref().unwrap_or("")), fmt_int(info.indexed as i64), info.companies), None).await;
        }
        "/app" => match &sh.cfg.public_url {
            Some(u) => sh.outbox.send(chat, "Qidiruv oynasini oching:", Some(json!({ "inline_keyboard": [[{ "text": "Qidiruv", "web_app": { "url": format!("{u}/app") } }]] }))).await,
            None => sh.outbox.send(chat, "Mini App manzili sozlanmagan (PUBLIC_URL).", None).await,
        },
        "/case" => show(&sh, chat, "c", arg).await,
        "/bill" => show(&sh, chat, "b", arg).await,
        "/company" => show(&sh, chat, "k", arg).await,
        "/find" => search_reply(&sh, chat, arg).await,
        _ if body.starts_with('/') => sh.outbox.send(chat, HELP, None).await,
        _ => search_reply(&sh, chat, body).await,
    }
}
