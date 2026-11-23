//! The chat side: commands and buttons. Only the listed users are answered; everyone else gets their own Telegram id (so the owner can list it) and
//! nothing else. Text is built from the typed answers of `service.rs`; sending goes through `Outbox`, so every handler is testable without Telegram.

use crate::domain::{Bill, CaseView, Company, Hearing};
use crate::translit::to_latin as lat;
use crate::error::AppResult;
use crate::state::Shared;
use serde_json::{json, Value};
use std::sync::Arc;

const HELP: &str = "Sud tizimi boti: Telegramdagi shifrlangan zaxiradan qidiradi.\n\n\
Ish raqami (2-1004-2603/8020), kvitansiya raqami yoki STIR yozing: shunchaki xabar yuborish yetarli.\n\n\
/find <matn>: qidirish\n/hearings [kun] [STIR]: yaqin majlislar (14 kun)\n/case <ish raqami>: ish maʼlumoti\n/bill <raqam>: kvitansiya\n/company <STIR>: kompaniya\n/app: qidiruv oynasi (Mini App)\n/status: zaxira holati";

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
pub fn dmy_iso(iso: &str) -> String {
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

/// hearings grouped by day: «Bugun», «Ertaga», then the date; one line per hearing
pub fn fmt_hearing_block(list: &[Hearing], today: u32) -> String {
    let mut out = String::new();
    let mut day = 0;
    for h in list {
        if h.day != day {
            day = h.day;
            let date = crate::date::dmy(day);
            let head = if day == today { format!("Bugun, {date}") } else if day == crate::date::add_days(today, 1) { format!("Ertaga, {date}") } else { date };
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&format!("{head}\n"));
        }
        // when the company's side is known: «Javobgar · qarshi tomon: X»; otherwise both parties as they are
        let sides = if h.role.is_empty() { [lat(&h.plaintiff), lat(&h.defendant)].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" — ") } else { format!("{} · qarshi tomon: {}", role_word(h.role), lat(&h.counterparty)) };
        out.push_str(&format!("⏰ {} · {}{}\n", if h.time.is_empty() { "—" } else { &h.time }, h.case_number, if sides.is_empty() { String::new() } else { format!("\n    {sides}") }));
    }
    out
}

/// the company's side in words
pub fn role_word(role: &str) -> &'static str {
    match role {
        "plaintiff" => "Daʼvogar",
        "defendant" => "Javobgar",
        _ => "",
    }
}

pub fn hit_line(h: &Value) -> String {
    match h["kind"].as_str() {
        Some("company") => format!("🏢 {}STIR {} · {} toʻlov · {} ish", match h["name"].as_str().filter(|n| !n.is_empty()) { Some(n) => format!("{} · ", lat(n)), None => String::new() }, h["tin"].as_str().unwrap_or(""), fmt_int(h["bills"].as_i64().unwrap_or(0)), fmt_int(h["found"].as_i64().unwrap_or(0))),
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
    if !c.role.is_empty() {
        out.push_str(&format!("{}: {} · qarshi tomon: {}\n", if c.company_name.is_empty() { "Tomon".to_string() } else { c.company_name.clone() }, role_word(c.role), c.counterparty));
    }
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
    lat(&out)
}

pub fn bill_text(b: &Bill) -> String {
    lat(&format!(
        "🧾 Kvitansiya {}\nHolati: {}\nTuri: {}\nSud: {}\nSumma: {} · toʻlangan: {}\nBerilgan: {}\n{}{}STIR: {}",
        text(&b.number),
        text(&b.status),
        text(&b.cat),
        text(&b.court),
        som(&b.amount),
        som(&b.paid),
        dmy_ms(b.issued.as_i64().unwrap_or(0)),
        if text(&b.case_number).is_empty() { String::new() } else { format!("Ish: {}\n", text(&b.case_number)) },
        if text(&b.payer).is_empty() { String::new() } else { format!("Toʻlovchi: {}\n", text(&b.payer)) },
        text(&b.tin)
    ))
}

pub fn company_text(c: &Company) -> String {
    lat(&format!("🏢 {}STIR {}\nToʻlovlar: {}\nTopilgan ishlar: {}\nBirinchi yuklash: {}\nMaʼlumot holati: {}", if c.name.is_empty() { String::new() } else { format!("{}\n", c.name) }, c.tin, fmt_int(c.bills as i64), fmt_int(c.found as i64), dmy_ms(c.first_at), dmy_ms(c.refreshed_at)))
}

/// a button that opens the Mini App straight on this item (`/app?case=…`)
fn app_button(sh: &Shared, param: &str, key: &str) -> Option<Value> {
    let base = sh.cfg.public_url.as_ref()?;
    let q: String = form_urlencoded::Serializer::new(String::new()).append_pair(param, key).finish();
    Some(json!({ "inline_keyboard": [[{ "text": "Mini App'da ochish", "web_app": { "url": format!("{base}/app?{q}") } }]] }))
}

/// at most this many hearings in one message (Telegram refuses a text over 4096 characters: a hundred rows do not fit)
const CHAT_PAGE: usize = 20;

/// the longest text a message may carry, with room to spare
const CHAT_MAX: usize = 3900;

/// cut a text at a line break below `max` bytes, and say it was cut
fn clip(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut cut = max;
    while !s.is_char_boundary(cut) {
        cut -= 1;
    }
    let head = &s[..cut];
    format!("{}\n…", head.rsplit_once('\n').map(|(h, _)| h).unwrap_or(head))
}

/// One page of the hearings: the rows, a «next» button while there are more, and a button that opens the same list in the Mini App.
async fn hearings_reply(sh: &Arc<Shared>, chat: i64, days: u32, tin: &str, offset: usize) {
    let today = crate::date::today(crate::state::now());
    let days = days.clamp(1, crate::service::MAX_HEARING_DAYS);
    let page = match sh.hearing_page(today, days, tin, "", offset, CHAT_PAGE).await {
        Ok(p) => p,
        Err(e) => return sh.outbox.send(chat, &e.message(), None).await,
    };
    if page.total == 0 {
        let scope = if tin.is_empty() { String::new() } else { format!(" (STIR {tin})") };
        return sh.outbox.send(chat, &format!("Yaqin {days} kunda majlis yoʻq{scope} (zaxira maʼlumotiga koʻra)."), None).await;
    }
    let shown_to = offset + page.rows.len();
    let scope = if tin.is_empty() { String::new() } else { format!(", STIR {tin}") };
    let head = format!("📅 Yaqin majlislar ({days} kun{scope}): {} ta · {}–{shown_to}\n\n", page.total, offset + 1);
    let body = clip(&format!("{head}{}", fmt_hearing_block(&page.rows, today)), CHAT_MAX);
    let mut keys: Vec<Value> = Vec::new();
    if shown_to < page.total {
        keys.push(json!([{ "text": format!("Keyingi {} ›", (page.total - shown_to).min(CHAT_PAGE)), "callback_data": format!("h:{days}:{tin}:{shown_to}") }]));
    }
    if let Some(base) = sh.cfg.public_url.as_ref() {
        keys.push(json!([{ "text": "Hammasi Mini App'da", "web_app": { "url": format!("{base}/app?tab=hearings") } }]));
    }
    sh.outbox.send(chat, &body, if keys.is_empty() { None } else { Some(json!({ "inline_keyboard": keys })) }).await;
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
        let data = cb["data"].as_str().unwrap_or("");
        // «h:<days>:<tin>:<offset>»: the next page of the hearings list
        if let Some(rest) = data.strip_prefix("h:") {
            let p: Vec<&str> = rest.split(':').collect();
            if let [days, tin, offset] = p[..] {
                hearings_reply(&sh, chat, days.parse().unwrap_or(14), tin, offset.parse().unwrap_or(0)).await;
            }
            return;
        }
        if let Some((w, k)) = data.split_once(':') {
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
            let mirror = if info.channel > 0 { "\nEslatma: asosiy kanal ishlamayapti, zaxira kanaldan oʻqilmoqda.".to_string() } else { String::new() };
            let degraded = if info.failures > 0 { format!("\nOxirgi {} ta yangilash muvaffaqiyatsiz: eski zaxiradan javob beryapman.", info.failures) } else { String::new() };
            sh.outbox.send(chat, &format!("Zaxira: {}\nYozuvlar: {} · kompaniyalar: {}{degraded}{mirror}", dmy_iso(info.backup_at.as_deref().unwrap_or("")), fmt_int(info.indexed as i64), info.companies), None).await;
        }
        "/app" => match &sh.cfg.public_url {
            Some(u) => sh.outbox.send(chat, "Qidiruv oynasini oching:", Some(json!({ "inline_keyboard": [[{ "text": "Qidiruv", "web_app": { "url": format!("{u}/app") } }]] }))).await,
            None => sh.outbox.send(chat, "Mini App manzili sozlanmagan (PUBLIC_URL).", None).await,
        },
        "/hearings" => {
            // «/hearings», «/hearings 30», «/hearings 207275139», «/hearings 30 207275139»
            let (mut days, mut tin) = (14u32, String::new());
            for t in arg.split_whitespace() {
                if t.len() == 9 && t.chars().all(|c| c.is_ascii_digit()) {
                    tin = t.to_string();
                } else if let Ok(n) = t.parse::<u32>() {
                    days = n.clamp(1, crate::service::MAX_HEARING_DAYS);
                }
            }
            hearings_reply(&sh, chat, days, &tin, 0).await;
        }
        "/case" => show(&sh, chat, "c", arg).await,
        "/bill" => show(&sh, chat, "b", arg).await,
        "/company" => show(&sh, chat, "k", arg).await,
        "/find" => search_reply(&sh, chat, arg).await,
        _ if body.starts_with('/') => sh.outbox.send(chat, HELP, None).await,
        _ => search_reply(&sh, chat, body).await,
    }
}
