//! The chat side: commands and buttons. Only the listed users are answered; everyone else gets their own Telegram id (so the owner can list it) and nothing else.

use crate::store::Shared;
use serde_json::{json, Value};
use std::sync::Arc;

const HELP: &str = "Sud tizimi boti: Telegramdagi shifrlangan zaxiradan qidiradi.\n\n\
Ish raqami (2-1004-2603/8020), kvitansiya raqami yoki STIR yozing: shunchaki xabar yuborish yetarli.\n\n\
/find <matn>: qidirish\n/case <ish raqami>: ish maʼlumoti\n/bill <raqam>: kvitansiya\n/company <STIR>: kompaniya\n/app: qidiruv oynasi (Mini App)\n/status: zaxira holati";

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

/// `2026-11-22T17:41:29.546Z` or epoch ms → `22.11.2026`
fn dmy_iso(iso: &str) -> String {
    let d = iso.get(0..10).unwrap_or("");
    let p: Vec<&str> = d.split('-').collect();
    if p.len() == 3 { format!("{}.{}.{}", p[2], p[1], p[0]) } else { iso.to_string() }
}

fn dmy_ms(ms: i64) -> String {
    if ms <= 0 {
        return "-".into();
    }
    let days = (ms + 5 * 3_600_000) / 86_400_000; // Uzbekistan time (UTC+5, no summer time)
    // civil-from-days (Howard Hinnant)
    let z = days + 719_468;
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

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().filter(|x| !x.is_empty() && *x != "-").unwrap_or("")
}

pub fn hit_line(h: &Value) -> String {
    match h["kind"].as_str() {
        Some("company") => format!("🏢 STIR {} · {} toʻlov · {} ish", h["tin"].as_str().unwrap_or(""), fmt_int(h["bills"].as_i64().unwrap_or(0)), fmt_int(h["found"].as_i64().unwrap_or(0))),
        Some("bill") => format!("🧾 {} · {}{}", h["key"].as_str().unwrap_or(""), h["year"], if s(h, "caseNumber").is_empty() { String::new() } else { format!(" · ish {}", h["caseNumber"].as_str().unwrap_or("")) }),
        _ => format!("⚖️ {} · {} · 20{}", h["key"].as_str().unwrap_or(""), h["court"].as_str().unwrap_or(""), h["year"]),
    }
}

fn hit_button(h: &Value) -> Value {
    let (label, data) = match h["kind"].as_str() {
        Some("company") => (format!("🏢 {}", h["tin"].as_str().unwrap_or("")), format!("k:{}", h["tin"].as_str().unwrap_or(""))),
        Some("bill") => (format!("🧾 {}", h["key"].as_str().unwrap_or("")), format!("b:{}", h["key"].as_str().unwrap_or(""))),
        _ => (format!("⚖️ {}", h["key"].as_str().unwrap_or("")), format!("c:{}", h["key"].as_str().unwrap_or(""))),
    };
    json!([{ "text": label, "callback_data": data }])
}

fn case_text(c: &Value) -> String {
    let g = &c["detail"]["general"];
    let mut out = format!("⚖️ Ish {}\n", c["num"].as_str().unwrap_or(""));
    let mut line = |label: &str, v: &str| {
        if !v.is_empty() {
            out.push_str(&format!("{label}: {v}\n"));
        }
    };
    if g.is_object() {
        line("Holati", s(g, "caseStatus"));
        line("Turi", s(g, "caseType"));
        line("Sud", s(g, "court"));
        line("Sudya", s(g, "judge"));
        line("Daʼvogar", s(g, "plaintiff"));
        line("Javobgar", s(g, "defendant"));
        line("Daʼvo summasi", s(g, "claimAmount"));
        line("Ariza sanasi", s(g, "applicationDate"));
    } else if c["row"].is_object() {
        let r = &c["row"];
        for (label, k) in [("Holati", "caseStatus"), ("Turi", "caseType"), ("Sud", "courtName"), ("Sudya", "judge"), ("Daʼvogar", "plaintiff"), ("Javobgar", "defendant"), ("Daʼvo summasi", "claimAmount"), ("Ariza sanasi", "dateFiled"), ("Natija", "result")] {
            line(label, s(r, k));
        }
    } else {
        out.push_str("Batafsil maʼlumot zaxirada yoʻq (faqat kvitansiyalar orqali maʼlum).\n");
    }
    // the instances: hearings and the decision, in short
    for (title, key) in [("1-instansiya", "firstInstance"), ("Apellyatsiya", "appellate"), ("Kassatsiya", "cassation"), ("Taftish", "inspection")] {
        let ins = &c["detail"][key];
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
    out.push_str(&format!("\nSTIR: {} · {}\n", c["tin"].as_str().unwrap_or(""), c["court"].as_str().unwrap_or("")));
    if let Some(bs) = c["bills"].as_array() {
        for b in bs {
            out.push_str(&format!("🧾 {} · {} · {}\n", b["number"].as_str().unwrap_or(""), s(b, "cat"), fmt_int(b["amount"].as_i64().unwrap_or(0) / 100)));
        }
    }
    out
}

fn bill_text(b: &Value) -> String {
    format!(
        "🧾 Kvitansiya {}\nHolati: {}\nTuri: {}\nSud: {}\nSumma: {} · toʻlangan: {}\nBerilgan: {}\n{}STIR: {}",
        b["number"].as_str().unwrap_or(""),
        b["status"].as_str().unwrap_or(""),
        s(b, "cat"),
        s(b, "court"),
        fmt_int(b["amount"].as_i64().unwrap_or(0) / 100),
        fmt_int(b["paid"].as_i64().unwrap_or(0) / 100),
        dmy_ms(b["issued"].as_i64().unwrap_or(0)),
        if s(b, "caseNumber").is_empty() { String::new() } else { format!("Ish: {}\n", b["caseNumber"].as_str().unwrap_or("")) },
        b["tin"].as_str().unwrap_or("")
    )
}

fn company_text(c: &Value) -> String {
    format!(
        "🏢 STIR {}\nToʻlovlar: {}\nTopilgan ishlar: {}\nBirinchi yuklash: {}\nMaʼlumot holati: {}",
        c["tin"].as_str().unwrap_or(""),
        fmt_int(c["bills"].as_i64().unwrap_or(0)),
        fmt_int(c["found"].as_i64().unwrap_or(0)),
        dmy_ms(c["firstAt"].as_i64().unwrap_or(0)),
        dmy_ms(c["refreshedAt"].as_i64().unwrap_or(0))
    )
}

async fn search_reply(sh: &Arc<Shared>, chat: i64, q: &str) {
    let hits = sh.search(q, 8).await;
    if hits.is_empty() {
        sh.tg.send(chat, "Topilmadi. Ish raqami (2-1004-2603), kvitansiya raqami (6+ raqam) yoki STIR (3+ raqam) yozing.", None).await;
        return;
    }
    let text = hits.iter().map(hit_line).collect::<Vec<_>>().join("\n");
    let kb: Vec<Value> = hits.iter().map(hit_button).collect();
    sh.tg.send(chat, &text, Some(json!({ "inline_keyboard": kb }))).await;
}

/// a button that opens the Mini App straight on this item (`/app?case=…`)
fn app_button(sh: &Shared, param: &str, key: &str) -> Option<Value> {
    let base = sh.cfg.public_url.as_ref()?;
    let q: String = form_urlencoded::Serializer::new(String::new()).append_pair(param, key).finish();
    Some(json!({ "inline_keyboard": [[{ "text": "Mini App'da ochish", "web_app": { "url": format!("{base}/app?{q}") } }]] }))
}

async fn show(sh: &Arc<Shared>, chat: i64, what: &str, key: &str) {
    let (r, param): (Result<String, String>, &str) = match what {
        "c" => (sh.case_detail(key).await.map(|c| case_text(&c)), "case"),
        "b" => (sh.bill_detail(key).await.map(|b| bill_text(&b)), "bill"),
        _ => (sh.company(key).await.map(|c| company_text(&c)).ok_or_else(|| "Bunday kompaniya zaxirada yoʻq".to_string()), "company"),
    };
    let markup = if r.is_ok() { app_button(sh, param, key) } else { None };
    sh.tg.send(chat, &r.unwrap_or_else(|e| e), markup).await;
}

pub fn authorized(sh: &Shared, user: i64) -> bool {
    sh.cfg.allowed.contains(&user)
}

pub async fn handle_update(sh: Arc<Shared>, u: Value) {
    if let Some(cb) = u.get("callback_query") {
        let uid = cb["from"]["id"].as_i64().unwrap_or(0);
        let chat = cb["message"]["chat"]["id"].as_i64().unwrap_or(uid);
        sh.tg.answer_callback(cb["id"].as_str().unwrap_or("")).await;
        if !authorized(&sh, uid) {
            return;
        }
        let data = cb["data"].as_str().unwrap_or("");
        if let Some((w, k)) = data.split_once(':') {
            show(&sh, chat, w, k).await;
        }
        return;
    }
    let Some(m) = u.get("message") else { return };
    let uid = m["from"]["id"].as_i64().unwrap_or(0);
    let chat = m["chat"]["id"].as_i64().unwrap_or(uid);
    let text = m["text"].as_str().unwrap_or("").trim();
    if text.is_empty() {
        return;
    }
    if !authorized(&sh, uid) {
        eprintln!("[bot] ruxsatsiz urinish: id={uid}");
        sh.tg.send(chat, &format!("Ruxsat yoʻq. Sizning Telegram ID: {uid}\n\nBot egasi bu raqamni ALLOWED_USER_IDS ga qoʻshishi kerak."), None).await;
        return;
    }
    if !sh.st.read().await.ready {
        let err = sh.st.read().await.error.clone();
        sh.tg.send(chat, &format!("Zaxira hali yuklanmoqda…{}", err.map(|e| format!("\n{e}")).unwrap_or_default()), None).await;
        return;
    }
    let (cmd, arg) = match text.split_once(char::is_whitespace) {
        Some((c, a)) => (c, a.trim()),
        None => (text, ""),
    };
    let cmd = cmd.split('@').next().unwrap_or(cmd);
    match cmd {
        "/start" | "/help" => sh.tg.send(chat, HELP, None).await,
        "/status" => {
            let i = sh.info().await;
            sh.tg.send(chat, &format!("Zaxira: {}\nYozuvlar: {} · kompaniyalar: {}", dmy_iso(i["backupAt"].as_str().unwrap_or("")), fmt_int(i["indexed"].as_i64().unwrap_or(0)), i["companies"]), None).await;
        }
        "/app" => match &sh.cfg.public_url {
            Some(u) => sh.tg.send(chat, "Qidiruv oynasini oching:", Some(json!({ "inline_keyboard": [[{ "text": "Qidiruv", "web_app": { "url": format!("{u}/app") } }]] }))).await,
            None => sh.tg.send(chat, "Mini App manzili sozlanmagan (PUBLIC_URL).", None).await,
        },
        "/case" => show(&sh, chat, "c", arg).await,
        "/bill" => show(&sh, chat, "b", arg).await,
        "/company" => show(&sh, chat, "k", arg).await,
        "/find" => search_reply(&sh, chat, arg).await,
        _ if text.starts_with('/') => sh.tg.send(chat, HELP, None).await,
        _ => search_reply(&sh, chat, text).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_and_numbers() {
        assert_eq!(dmy_ms(1_774_827_370_376), "30.03.2026");
        assert_eq!(dmy_ms(0), "-");
        assert_eq!(dmy_iso("2026-11-22T17:41:29.546Z"), "22.11.2026");
        assert_eq!(fmt_int(139087), "139\u{a0}087");
        assert_eq!(fmt_int(5), "5");
    }

    #[test]
    fn a_case_with_a_stored_detail_reads_well() {
        let c = json!({ "num": "2-1004-2403/1", "court": "civil", "tin": "207324986", "bills": [{ "number": "1", "cat": "Почта", "amount": 206000000i64 }],
            "detail": { "general": { "caseStatus": "Якунланган", "plaintiff": "A", "defendant": "-", "court": "Court" } } });
        let t = case_text(&c);
        assert!(t.contains("Holati: Якунланган") && t.contains("Daʼvogar: A") && t.contains("2\u{a0}060\u{a0}000"));
        assert!(!t.contains("Javobgar")); // "-" is not shown
    }

    #[test]
    fn hits_have_a_line_and_a_button() {
        let h = json!({ "kind": "case", "key": "2-1503-2503/5802", "court": "civil", "year": 25, "tin": "1" });
        assert_eq!(hit_line(&h), "⚖️ 2-1503-2503/5802 · civil · 2025");
        assert_eq!(hit_button(&h)[0]["callback_data"], "c:2-1503-2503/5802");
    }
}
