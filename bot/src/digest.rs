//! The reminders: a MORNING message (the hearings of the next days) and an EVENING one (tomorrow's hearings), per person: each one's times, the number of
//! days and the companies come from their own settings (`prefs.rs`). A message with nothing in it is not sent: silence, not «nothing». The bot never
//! scrapes: the dates are as fresh as the last backup, and the message says so.

use crate::chat::fmt_hearing_block;
use crate::date::{add_days, secs_of_day, today};
use crate::state::{now, Shared};
use std::{collections::HashMap, sync::Arc, time::Duration};

/// how long after the chosen time a reminder still may go out (a restart inside the window sends it once)
const WINDOW: i64 = 3600;

/// the day (yyyymmdd) a reminder is due for, or None. `last` = the day it was last sent for, `at` = the chosen time in seconds after midnight (Uzbekistan).
pub fn due_at(now_secs: i64, last: u32, at: i64) -> Option<u32> {
    let s = secs_of_day(now_secs);
    let day = today(now_secs);
    (s >= at && s < at + WINDOW && day != last).then_some(day)
}

/// the most hearings listed in a message itself (each takes three or four lines, so about a dozen fit; the rest is one tap away in the Mini App)
const LISTED: usize = 12;

fn footer(out: &mut String, backup_at: Option<&str>) {
    if let Some(at) = backup_at.filter(|a| a.len() >= 10) {
        out.push_str(&format!("\n<i>Maʼlumot {} holatiga (zaxira).</i>", crate::chat::dmy_iso(at)));
    }
}

/// The morning message (Telegram HTML) for the next `days` days, or None when there is nothing to say. `hearings` is the whole range; the message gives the
/// count and how many fall today and tomorrow, lists the first few and says how many more there are.
pub fn text_for(hearings: &[crate::domain::Hearing], today: u32, backup_at: Option<&str>, days: u32) -> Option<String> {
    if hearings.is_empty() {
        return None;
    }
    let tomorrow = add_days(today, 1);
    let n_today = hearings.iter().filter(|h| h.day == today).count();
    let n_tomorrow = hearings.iter().filter(|h| h.day == tomorrow).count();
    let mut out = format!("📋 <b>Yaqin majlislar</b>\nKeyingi {days} kun: <b>{} ta</b>", hearings.len());
    out.push_str(&format!("\nBugun: <b>{n_today}</b> · ertaga: <b>{n_tomorrow}</b>\n\n"));
    out.push_str(&fmt_hearing_block(&hearings[..hearings.len().min(LISTED)], today));
    if hearings.len() > LISTED {
        out.push_str(&format!("\n… va yana <b>{}</b> ta: pastdagi tugma bilan hammasini oching.\n", hearings.len() - LISTED));
    }
    footer(&mut out, backup_at);
    Some(out)
}

/// the seven-day morning message
#[cfg_attr(not(test), allow(dead_code))]
pub fn text(hearings: &[crate::domain::Hearing], today: u32, backup_at: Option<&str>) -> Option<String> {
    text_for(hearings, today, backup_at, 7)
}

/// The evening message: TOMORROW's hearings, so there is time to prepare. `hearings` are tomorrow's only. None when there are none.
pub fn evening_text(hearings: &[crate::domain::Hearing], today: u32, backup_at: Option<&str>) -> Option<String> {
    let first = hearings.first()?;
    let mut out = format!("🌙 <b>Ertangi majlislar</b>\n<b>{} ta</b> · birinchisi soat <b>{}</b>\n\n", hearings.len(), if first.time.is_empty() { "nomaʼlum".to_string() } else { first.time.clone() });
    out.push_str(&fmt_hearing_block(&hearings[..hearings.len().min(LISTED)], today));
    if hearings.len() > LISTED {
        out.push_str(&format!("\n… va yana <b>{}</b> ta: pastdagi tugma bilan hammasini oching.\n", hearings.len() - LISTED));
    }
    footer(&mut out, backup_at);
    Some(out)
}

/// who got which reminder for which day (so a person gets each once a day)
#[derive(Default)]
pub struct Sent {
    morning: HashMap<i64, u32>,
    evening: HashMap<i64, u32>,
}

/// One look at the clock: send what is due to whom. `n` = now in epoch seconds (a parameter, so a test can set the time).
pub async fn tick(sh: &Arc<Shared>, n: i64, sent: &mut Sent) {
    let info = sh.info().await;
    if !info.ready {
        return; // the backup is not read yet: try again next minute (inside the window)
    }
    let button = sh.cfg.public_url.as_ref().map(|u| serde_json::json!({ "inline_keyboard": [[{ "text": "Majlislar Mini Appʼda", "web_app": { "url": format!("{u}/app?tab=hearings") } }]] }));
    for user in &sh.cfg.allowed {
        let p = sh.prefs_of(*user).await;
        if let Some(d) = p.morning.and_then(|m| due_at(n, sent.morning.get(user).copied().unwrap_or(0), i64::from(m) * 60)) {
            sent.morning.insert(*user, d);
            match sh.hearings(d, add_days(d, i64::from(p.days) - 1)).await {
                Ok(l) => {
                    let l: Vec<_> = l.into_iter().filter(|h| p.wants(&h.tin)).collect();
                    if let Some(body) = text_for(&l, d, info.backup_at.as_deref(), p.days) {
                        sh.outbox.send_html(*user, &body, button.clone()).await;
                    }
                }
                Err(e) => eprintln!("[bot] ertalabki xabar: {}", e.message()),
            }
        }
        if let Some(d) = p.evening.and_then(|m| due_at(n, sent.evening.get(user).copied().unwrap_or(0), i64::from(m) * 60)) {
            sent.evening.insert(*user, d);
            let tomorrow = add_days(d, 1);
            match sh.hearings(tomorrow, tomorrow).await {
                Ok(l) => {
                    let l: Vec<_> = l.into_iter().filter(|h| p.wants(&h.tin)).collect();
                    if let Some(body) = evening_text(&l, d, info.backup_at.as_deref()) {
                        sh.outbox.send_html(*user, &body, button.clone()).await;
                    }
                }
                Err(e) => eprintln!("[bot] kechki xabar: {}", e.message()),
            }
        }
    }
}

pub async fn run(sh: Arc<Shared>) {
    let mut sent = Sent::default();
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
        tick(&sh, now(), &mut sent).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Hearing;

    fn h(day: u32, time: &str, num: &str) -> Hearing {
        Hearing { tin: "1".into(), company: "ANOR МЧЖ".into(), case_number: num.into(), court: "civil".into(), day, time: time.into(), stage: "first".into(), status: "Тайинлаш".into(), plaintiff: "Универсал МЧЖ".into(), defendant: "ANOR МЧЖ".into(), role: "", counterparty: String::new() }
    }

    #[test]
    fn it_is_due_once_a_day_inside_the_window() {
        // 2026-11-23 03:00 UTC = 08:00 in Uzbekistan
        let eight = 1_795_402_800;
        assert_eq!(today(eight), 20_261_123);
        let at = 8 * 3600;
        assert_eq!(due_at(eight - 60, 0, at), None); // 07:59
        assert_eq!(due_at(eight, 0, at), Some(20_261_123));
        assert_eq!(due_at(eight + 1800, 0, at), Some(20_261_123));
        assert_eq!(due_at(eight, 20_261_123, at), None); // already sent today
        assert_eq!(due_at(eight + 3600, 0, at), None); // the window is over: a restart at noon sends nothing
        assert_eq!(due_at(eight + 86_400, 20_261_123, at), Some(20_261_124));
        // the evening time is the person's own: 18:30 is inside the window of 18:00 and outside that of 17:00
        assert_eq!(due_at(eight + 10 * 3600 + 1800, 0, 18 * 3600), Some(20_261_123));
        assert_eq!(due_at(eight + 10 * 3600 + 1800, 0, 17 * 3600), None);
    }

    /// `cargo test preview_the_morning_message -- --ignored --nocapture` prints a sample of the message, to look at (or to send to a chat as HTML)
    #[test]
    #[ignore]
    fn preview_the_morning_message() {
        let mut a = h(20_261_124, "10:30", "4-1001-2609/0877");
        a.company = "«ANDIJONKABEL» AKSIYADORLIK JAMIYATI".into();
        a.court = "economic".into();
        a.role = "defendant";
        a.counterparty = "«UNIVERSAL SAVDO» MChJ".into();
        let mut b = h(20_261_124, "14:00", "2-1004-2603/8020");
        b.company = "«ARTIKUL AZIYA KABEL» MChJ".into();
        b.role = "plaintiff";
        b.counterparty = "Ahmedov A. A.".into();
        let mut c = h(20_261_127, "09:00", "4-1001-2609/0415");
        c.company = "«ANDIJONKABEL» AKSIYADORLIK JAMIYATI".into();
        c.court = "economic".into();
        c.stage = "appeal".into();
        c.role = "defendant";
        c.counterparty = "«HUDUDIY ELEKTR TARMOQLARI» AJ".into();
        let tomorrow = [h(20_261_125, "09:30", "4-1001-2609/0900"), h(20_261_125, "11:00", "2-1004-2603/8020")];
        println!("{}", text(&[a, b, c], 20_261_124, Some("2026-11-24T05:30:00.000Z")).unwrap());
        println!("-----");
        println!("{}", evening_text(&tomorrow, 20_261_124, Some("2026-11-24T05:30:00.000Z")).unwrap());
    }

    #[test]
    fn nothing_to_say_is_silence() {
        assert_eq!(text(&[], 20_261_123, None), None);
    }

    #[test]
    fn a_crowded_week_lists_the_first_few_and_says_how_many_more_and_fits_a_message() {
        let list: Vec<Hearing> = (0..120).map(|i| h(20_261_123 + (i % 5) as u32, "10:00", &format!("2-1004-2503/{i}"))).collect();
        let mut sorted = list.clone();
        sorted.sort_by_key(|x| x.day);
        let t = text(&sorted, 20_261_123, None).unwrap();
        assert!(t.starts_with("📋 <b>Yaqin majlislar</b>\nKeyingi 7 kun: <b>120 ta</b>"), "{t}");
        assert!(t.contains("va yana <b>108</b> ta") && t.len() < 4096, "{}", t.len());
        assert_eq!(t.matches("🕙").count(), 12);
    }

    #[test]
    fn a_hearing_reads_in_a_few_short_lines_and_the_header_counts_today_and_tomorrow() {
        let t = text(&[h(20_261_123, "10:00", "2-1004-2503/1"), h(20_261_123, "11:00", "2-1004-2503/2"), h(20_261_124, "09:30", "2-1004-2503/3")], 20_261_123, None).unwrap();
        assert!(t.contains("Bugun: <b>2</b> · ertaga: <b>1</b>"), "{t}");
        // time and case in one line, the court in words, then the company, then the parties (the side is not known in this fixture)
        assert!(t.contains("🕙 <b>10:00</b> · <code>2-1004-2503/1</code> · fuqarolik\n<b>ANOR MChJ</b>\nDaʼvogar: Universal MChJ\nJavobgar: ANOR MChJ\n"), "{t}");
        assert!(t.contains("📅 <b>Bugun · 23.11.2026 · dushanba</b>") && t.contains("📅 <b>Ertaga · 24.11.2026 · seshanba</b>"), "{t}");
    }

    #[test]
    fn a_name_with_markup_characters_cannot_break_the_message() {
        let mut x = h(20_261_123, "10:00", "2-1004-2503/1");
        x.company = "A & B <x> МЧЖ".into();
        let t = text(&[x], 20_261_123, None).unwrap();
        assert!(t.contains("A &amp; B &lt;x&gt; MChJ"), "{t}");
        assert!(!t.contains("<x>"), "{t}");
    }

    #[test]
    fn today_and_tomorrow_are_named_and_the_text_is_latin() {
        let t = text(&[h(20_261_123, "10:00", "2-1004-2503/1"), h(20_261_124, "09:30", "2-1004-2503/2"), h(20_261_127, "14:00", "2-1004-2503/3")], 20_261_123, Some("2026-11-22T10:00:00.000Z")).unwrap();
        assert!(t.contains("Bugun") && t.contains("Ertaga") && t.contains("27.11.2026"));
        assert!(t.contains("10:00") && t.contains("2-1004-2503/1") && t.contains("Universal MChJ") && !t.contains("МЧЖ"));
        assert!(t.contains("22.11.2026 holatiga"));
    }
}
