//! The chat side: commands and buttons. Only the listed users are answered; everyone else gets their own Telegram id (so the owner can list it) and
//! nothing else. Text is built from the typed answers of `service.rs`; sending goes through `Outbox`, so every handler is testable without Telegram.

use crate::domain::{Bill, CaseView, Company, Hearing};
use crate::format::{court_word, day_head, esc};
use crate::translit::to_latin as lat;
use crate::error::AppResult;
use crate::state::Shared;
use serde_json::{json, Value};
use std::sync::Arc;

const HELP: &str = "<b>Sud tizimi boti</b>\n\
Telegramdagi shifrlangan zaxiradan qidiradi. Sud saytlariga kirmaydi: maʼlumot oxirgi zaxira vaqtidagidek.\n\n\
<b>Qidirish</b>\n\
Shunchaki yozing: ish raqami (<code>2-1004-2603/8020</code>), kvitansiya raqami, STIR yoki kompaniya nomi.\n\n\
<b>Buyruqlar</b>\n\
/hearings [kun] [STIR]: yaqin majlislar (14 kun)\n\
/stats [STIR]: sonlar, kompaniyalar va ishlar\n\
/company STIR: kompaniya\n\
/case raqam: ish maʼlumoti\n\
/bill raqam: kvitansiya\n\
/find matn: qidirish\n\
/app: qidiruv oynasi (Mini App)\n\
/settings: eslatma sozlamalari\n\
/status: zaxira holati\n\n\
<b>Eslatmalar</b>\n\
Ertalab yaqin kunlardagi majlislar, kechqurun ertangi majlislar oʻzi yuboriladi (majlis boʻlmasa, xabar kelmaydi). Vaqtini, kunlar sonini va kompaniyalarni /settings da har kim oʻzi tanlaydi.";

pub fn authorized(sh: &Shared, user: i64) -> bool {
    sh.cfg.allowed.contains(&user)
}

pub fn fmt_int(n: i64) -> String {
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

/// one hearing, in three short lines: time and case, whose it is, and the other side
fn hearing_entry(h: &Hearing) -> String {
    let time = if h.time.is_empty() { "vaqti nomaʼlum".to_string() } else { h.time.clone() };
    let stage = match h.stage.as_str() {
        "appeal" => " · apellyatsiya",
        "cassation" => " · kassatsiya",
        "inspection" => " · taftish",
        _ => "",
    };
    let court = court_word(&h.court).to_lowercase();
    let mut out = format!("🕙 <b>{}</b> · <code>{}</code>{}{}\n", esc(&time), esc(&h.case_number), if court.is_empty() { String::new() } else { format!(" · {court}") }, stage);
    let who = lat(&h.company);
    if !h.role.is_empty() {
        // the company's side is known: «Javobgar» and the other party
        out.push_str(&format!("<b>{}</b> · {}\n", if who.is_empty() { "Kompaniya".to_string() } else { esc(&who) }, role_word(h.role).to_lowercase()));
        if !h.counterparty.is_empty() {
            out.push_str(&format!("↔ {}\n", esc(&lat(&h.counterparty))));
        }
    } else {
        if !who.is_empty() {
            out.push_str(&format!("<b>{}</b>\n", esc(&who)));
        }
        for (label, v) in [("Daʼvogar", &h.plaintiff), ("Javobgar", &h.defendant)] {
            let t = lat(v);
            if !t.is_empty() {
                out.push_str(&format!("{label}: {}\n", esc(&t)));
            }
        }
    }
    out
}

/// hearings grouped by day (a bold heading: «Bugun · 24.11.2026 · seshanba»), each one as `hearing_entry`, a blank line between them
pub fn fmt_hearing_block(list: &[Hearing], today: u32) -> String {
    let mut out = String::new();
    let mut day = 0;
    for h in list {
        if h.day != day {
            day = h.day;
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&format!("📅 <b>{}</b>\n", esc(&day_head(day, today))));
        } else {
            out.push('\n');
        }
        out.push_str(&hearing_entry(h));
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

/// «<b>Label:</b> value», when there is a value
fn labelled(label: &str, v: &str) -> String {
    if v.is_empty() { String::new() } else { format!("<b>{label}:</b> {}\n", esc(&lat(v))) }
}

pub fn case_text(c: &CaseView) -> String {
    let mut out = format!("⚖️ <b>Ish</b> <code>{}</code>\n", esc(&c.num));
    if !c.role.is_empty() {
        out.push_str(&format!("<b>{}</b> · {}\n↔ {}\n", if c.company_name.is_empty() { "Tomon".to_string() } else { esc(&lat(&c.company_name)) }, role_word(c.role).to_lowercase(), esc(&lat(&c.counterparty))));
    }
    out.push('\n');
    let g = &c.detail["general"];
    if g.is_object() {
        for (label, k) in [("Holati", "caseStatus"), ("Turi", "caseType"), ("Sud", "court"), ("Sudya", "judge"), ("Daʼvogar", "plaintiff"), ("Javobgar", "defendant"), ("Daʼvo summasi", "claimAmount"), ("Ariza sanasi", "applicationDate")] {
            out.push_str(&labelled(label, s(g, k)));
        }
    } else if c.row.is_object() {
        for (label, k) in [("Holati", "caseStatus"), ("Turi", "caseType"), ("Sud", "courtName"), ("Sudya", "judge"), ("Daʼvogar", "plaintiff"), ("Javobgar", "defendant"), ("Daʼvo summasi", "claimAmount"), ("Ariza sanasi", "dateFiled"), ("Natija", "result")] {
            out.push_str(&labelled(label, s(&c.row, k)));
        }
    } else {
        out.push_str("<i>Batafsil maʼlumot zaxirada yoʻq (faqat kvitansiyalar orqali maʼlum).</i>\n");
    }
    for (title, key) in [("1-instansiya", "firstInstance"), ("Apellyatsiya", "appellate"), ("Kassatsiya", "cassation"), ("Taftish", "inspection")] {
        let ins = &c.detail[key];
        if !ins.is_object() {
            continue;
        }
        out.push_str(&format!("\n<b>{title}</b>\n"));
        if let Some(hs) = ins["hearings"].as_array() {
            for h in hs.iter().take(4) {
                out.push_str(&format!("📅 {} {} · {}\n", esc(s(h, "date")), esc(s(h, "time")), esc(&lat(s(h, "status")))));
            }
            if hs.len() > 4 {
                out.push_str(&format!("… yana {} ta majlis\n", hs.len() - 4));
            }
        }
        let d = &ins["decision"];
        if d.is_object() {
            out.push_str(&format!("⚖️ <b>Qaror</b> {}: {}\n", esc(s(d, "date")), esc(&lat(s(d, "text")))));
        }
    }
    if !c.bills.is_empty() {
        out.push_str("\n<b>Kvitansiyalar</b>\n");
        for b in &c.bills {
            out.push_str(&format!("🧾 <code>{}</code> · {} · {} soʻm\n", esc(text(&b.number)), esc(&lat(text(&b.cat))), som(&b.amount)));
        }
    }
    out.push_str(&format!("\n<i>STIR {} · {}</i>", esc(&c.tin), esc(&c.court)));
    out
}

pub fn bill_text(b: &Bill) -> String {
    let mut out = format!("🧾 <b>Kvitansiya</b> <code>{}</code>\n\n", esc(text(&b.number)));
    out.push_str(&labelled("Holati", text(&b.status)));
    out.push_str(&labelled("Turi", text(&b.cat)));
    out.push_str(&labelled("Sud", text(&b.court)));
    out.push_str(&format!("<b>Summa:</b> {} soʻm · <b>toʻlangan:</b> {} soʻm\n", som(&b.amount), som(&b.paid)));
    out.push_str(&labelled("Berilgan", &dmy_ms(b.issued.as_i64().unwrap_or(0))));
    if !text(&b.case_number).is_empty() {
        out.push_str(&format!("<b>Ish:</b> <code>{}</code>\n", esc(text(&b.case_number))));
    }
    out.push_str(&labelled("Toʻlovchi", text(&b.payer)));
    out.push_str(&format!("\n<i>STIR {}</i>", esc(text(&b.tin))));
    out
}

pub fn company_text(c: &Company) -> String {
    let mut out = format!("🏢 <b>{}</b>\n<code>STIR {}</code>\n\n", if c.name.is_empty() { "Nomi zaxirada yoʻq".to_string() } else { esc(&lat(&c.name)) }, esc(&c.tin));
    out.push_str(&format!("<b>Sud roʻyxatidagi ishlar:</b> {}\n", fmt_int(c.listed as i64)));
    out.push_str(&format!("<b>Toʻlovlar orqali topilgan ishlar:</b> {}\n", fmt_int(c.found as i64)));
    out.push_str(&format!("<b>Ish raqamli toʻlovlar:</b> {}\n", fmt_int(c.bills as i64)));
    out.push_str(&format!("\n<i>Birinchi yuklash {} · maʼlumot {} holatiga</i>", dmy_ms(c.first_at), dmy_ms(c.refreshed_at)));
    out
}

/// «/stats»: all companies in a few lines, or one company's courts and years
pub fn stats_text(rows: &[crate::domain::Overview]) -> String {
    let mut out = format!("📊 <b>Umumiy sonlar</b>\nKompaniyalar: <b>{}</b>\n", rows.len());
    for o in rows {
        out.push_str(&format!("\n🏢 <b>{}</b>\n<code>{}</code> · ishlar <b>{}</b> · toʻlovlar {}\n", if o.company.name.is_empty() { "Nomi yoʻq".to_string() } else { esc(&lat(&o.company.name)) }, esc(&o.company.tin), fmt_int(o.cases as i64), fmt_int(o.company.bills as i64)));
    }
    out
}

pub fn overview_text(o: &crate::domain::Overview) -> String {
    let c = &o.company;
    let mut out = format!("📊 <b>{}</b>\n<code>STIR {}</code>\n\n", if c.name.is_empty() { "Nomi zaxirada yoʻq".to_string() } else { esc(&lat(&c.name)) }, esc(&c.tin));
    out.push_str(&format!("<b>Ishlar:</b> {}\n<b>Ish raqamli toʻlovlar:</b> {}\n", fmt_int(o.cases as i64), fmt_int(c.bills as i64)));
    let courts: Vec<String> = o.courts.iter().map(|(k, n)| format!("{} {}", { let w = court_word(k); if w.is_empty() { k.as_str() } else { w } }, fmt_int(*n as i64))).collect();
    if !courts.is_empty() {
        out.push_str(&format!("\n<b>Sudlar boʻyicha:</b> {}\n", esc(&courts.join(" · "))));
    }
    let years: Vec<&crate::domain::YearCount> = o.by_year.iter().rev().take(8).collect();
    if !years.is_empty() {
        out.push_str("\n<b>Yillar boʻyicha</b> (ariza yili)\n");
        for y in years {
            out.push_str(&format!("{} · {} ish · {} toʻlov\n", y.year, fmt_int(y.cases as i64), fmt_int(y.bills as i64)));
        }
    }
    out.push_str(&format!("\n<i>Maʼlumot {} holatiga</i>", dmy_ms(c.refreshed_at)));
    out
}

/// a button that opens the Mini App straight on this item (`/app?case=…`)
fn app_button(sh: &Shared, param: &str, key: &str) -> Option<Value> {
    let base = sh.cfg.public_url.as_ref()?;
    let q: String = form_urlencoded::Serializer::new(String::new()).append_pair(param, key).finish();
    Some(json!({ "inline_keyboard": [[{ "text": "Mini Appʼda ochish", "web_app": { "url": format!("{base}/app?{q}") } }]] }))
}

/// at most this many hearings in one message (Telegram refuses a text over 4096 characters: a hundred rows do not fit)
const CHAT_PAGE: usize = 10;

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

/// like `clip`, for HTML: cut at a line break below `max` bytes (every tag of this bot's messages opens and closes on one line, so a line break is
/// always a safe place) and say it was cut
fn clip_html(s: &str, max: usize) -> String {
    clip(s, max)
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
    let head = format!("📋 <b>Yaqin majlislar</b> · {days} kun{}\n<b>{}</b> ta · {}–{shown_to}\n\n", esc(&scope), page.total, offset + 1);
    let body = clip_html(&format!("{head}{}", fmt_hearing_block(&page.rows, today)), CHAT_MAX);
    let mut keys: Vec<Value> = Vec::new();
    if shown_to < page.total {
        keys.push(json!([{ "text": format!("Keyingi {} ›", (page.total - shown_to).min(CHAT_PAGE)), "callback_data": format!("h:{days}:{tin}:{shown_to}") }]));
    }
    if let Some(base) = sh.cfg.public_url.as_ref() {
        keys.push(json!([{ "text": "Hammasi Mini Appʼda", "web_app": { "url": format!("{base}/app?tab=hearings") } }]));
    }
    sh.outbox.send_html(chat, &body, if keys.is_empty() { None } else { Some(json!({ "inline_keyboard": keys })) }).await;
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
        Ok(t) => sh.outbox.send_html(chat, &clip_html(&t, CHAT_MAX), app_button(sh, param, key)).await,
        Err(e) => sh.outbox.send(chat, &e.message(), None).await,
    }
}

/// the companies a person can choose for the reminders: (STIR, name)
async fn company_names(sh: &Arc<Shared>) -> Vec<(String, String)> {
    sh.companies().await.into_iter().map(|c| (c.tin, c.name)).collect()
}

/// «/settings»: a NEW settings message (so it is the newest pinned one), pinned in the person's chat: it is both the screen and where the settings are kept
async fn settings_reply(sh: &Arc<Shared>, chat: i64, user: i64) {
    let p = sh.prefs_of(user).await;
    let companies = company_names(sh).await;
    let Some(id) = sh.outbox.send_html_id(chat, &p.text(&companies), Some(p.keyboard(&companies))).await else { return };
    sh.outbox.pin(chat, id).await;
    sh.remember_prefs(user, p, Some(id));
}

/// a button of the settings screen: `rest` is what follows «s:» in the callback data
async fn settings_press(sh: &Arc<Shared>, user: i64, chat: i64, msg_id: i64, rest: &str) {
    let mut p = sh.prefs_of(user).await;
    let companies = company_names(sh).await;
    let all: Vec<String> = companies.iter().map(|(t, _)| t.clone()).collect();
    if !p.apply(rest, &all) {
        return;
    }
    let (text, keys) = (p.text(&companies), p.keyboard(&companies));
    let pinned = sh.settings_msg(user);
    sh.remember_prefs(user, p, if pinned.is_none() { Some(msg_id) } else { None });
    sh.outbox.edit_html(chat, msg_id, &text, Some(keys.clone())).await;
    match pinned {
        // the screen that was pressed is an older one: the pinned screen (where the settings are read back from) is brought up to date too
        Some(id) if id != msg_id => sh.outbox.edit_html(chat, id, &text, Some(keys)).await,
        Some(_) => {}
        None => sh.outbox.pin(chat, msg_id).await,
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
        // «s:…»: a button of the settings screen
        if let Some(rest) = data.strip_prefix("s:") {
            if rest != "noop" {
                settings_press(&sh, uid, chat, cb["message"]["message_id"].as_i64().unwrap_or(0), rest).await;
            }
            return;
        }
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
        sh.outbox.send_html(chat, HELP, None).await;
        return;
    }
    let info = sh.info().await;
    if !info.ready {
        sh.outbox.send(chat, &format!("Zaxira hali yuklanmoqda…{}", info.error.map(|e| format!("\n{e}")).unwrap_or_default()), None).await;
        return;
    }
    match cmd {
        "/status" => {
            let mirror = if info.channel > 0 { "\n⚠️ Asosiy kanal ishlamayapti: zaxira kanaldan oʻqilmoqda.".to_string() } else { String::new() };
            let degraded = if info.failures > 0 { format!("\n⚠️ Oxirgi {} ta yangilash muvaffaqiyatsiz: eski zaxiradan javob beryapman.", info.failures) } else { String::new() };
            sh.outbox.send_html(chat, &format!("🗄 <b>Zaxira holati</b>\n<b>Oxirgi zaxira:</b> {}\n<b>Yozuvlar:</b> {}\n<b>Kompaniyalar:</b> {}{degraded}{mirror}", dmy_iso(info.backup_at.as_deref().unwrap_or("")), fmt_int(info.indexed as i64), info.companies), None).await;
        }
        "/settings" | "/reminders" => settings_reply(&sh, chat, uid).await,
        "/stats" => {
            let tin: String = arg.chars().filter(|c| c.is_ascii_digit()).collect();
            if tin.len() == 9 {
                match sh.overview(&tin).await {
                    Ok(o) => sh.outbox.send_html(chat, &clip_html(&overview_text(&o), CHAT_MAX), app_button(&sh, "company", &tin)).await,
                    Err(e) => sh.outbox.send(chat, &e.message(), None).await,
                }
            } else {
                let mut rows = Vec::new();
                for c in sh.companies().await {
                    if let Ok(o) = sh.overview(&c.tin).await {
                        rows.push(o);
                    }
                }
                sh.outbox.send_html(chat, &clip_html(&stats_text(&rows), CHAT_MAX), None).await;
            }
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
        _ if body.starts_with('/') => sh.outbox.send_html(chat, HELP, None).await,
        _ => search_reply(&sh, chat, body).await,
    }
}
