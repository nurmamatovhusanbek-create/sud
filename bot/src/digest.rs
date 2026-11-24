//! The morning message: once a day, shortly after 08:00 in Uzbekistan, every allowed person gets the hearings of the next seven days (today and
//! tomorrow first). The bot never scrapes: the dates are as fresh as the last backup, and the message says so.

use crate::chat::fmt_hearing_block;
use crate::date::{add_days, secs_of_day, today};
use crate::state::{now, Shared};
use std::{sync::Arc, time::Duration};

/// seconds after midnight (Uzbekistan) at which the message goes out, and how long after that it still may (a restart in the window sends it once)
const SEND_AT: i64 = 8 * 3600;
const WINDOW: i64 = 3600;

/// the day (yyyymmdd) a message is due for, or None. `last` = the day it was last sent for.
pub fn due(now_secs: i64, last: u32) -> Option<u32> {
    let s = secs_of_day(now_secs);
    let day = today(now_secs);
    (s >= SEND_AT && s < SEND_AT + WINDOW && day != last).then_some(day)
}

/// the most hearings listed in the message itself (each takes three or four lines, so about a dozen fit; the rest is one tap away in the Mini App)
const LISTED: usize = 12;

/// The text of the message (Telegram HTML), or None when there is nothing to say (no hearing in the next seven days: silence, not «nothing»).
/// `hearings` is the whole week; the message gives the count and how many fall today and tomorrow, lists the first few and says how many more there are.
pub fn text(hearings: &[crate::domain::Hearing], today: u32, backup_at: Option<&str>) -> Option<String> {
    if hearings.is_empty() {
        return None;
    }
    let tomorrow = add_days(today, 1);
    let n_today = hearings.iter().filter(|h| h.day == today).count();
    let n_tomorrow = hearings.iter().filter(|h| h.day == tomorrow).count();
    let mut out = format!("📋 <b>Yaqin majlislar</b>\nKeyingi 7 kun: <b>{} ta</b>", hearings.len());
    out.push_str(&format!("\nBugun: <b>{n_today}</b> · ertaga: <b>{n_tomorrow}</b>\n\n"));
    out.push_str(&fmt_hearing_block(&hearings[..hearings.len().min(LISTED)], today));
    if hearings.len() > LISTED {
        out.push_str(&format!("\n… va yana <b>{}</b> ta: pastdagi tugma bilan hammasini oching.\n", hearings.len() - LISTED));
    }
    if let Some(at) = backup_at.filter(|a| a.len() >= 10) {
        out.push_str(&format!("\n<i>Maʼlumot {} holatiga (zaxira).</i>", crate::chat::dmy_iso(at)));
    }
    Some(out)
}

pub async fn run(sh: Arc<Shared>) {
    let mut last = 0u32;
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
        let n = now();
        let Some(day) = due(n, last) else { continue };
        let info = sh.info().await;
        if !info.ready {
            continue; // the backup is not read yet: try again next minute (inside the window)
        }
        last = day;
        let list = match sh.hearings(day, add_days(day, 6)).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[bot] ertalabki xabar: {}", e.message());
                continue;
            }
        };
        let Some(body) = text(&list, day, info.backup_at.as_deref()) else { continue };
        let button = sh.cfg.public_url.as_ref().map(|u| serde_json::json!({ "inline_keyboard": [[{ "text": "Majlislar Mini Appʼda", "web_app": { "url": format!("{u}/app?tab=hearings") } }]] }));
        for user in &sh.cfg.allowed {
            sh.outbox.send_html(*user, &body, button.clone()).await;
        }
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
        assert_eq!(due(eight - 60, 0), None); // 07:59
        assert_eq!(due(eight, 0), Some(20_261_123));
        assert_eq!(due(eight + 1800, 0), Some(20_261_123));
        assert_eq!(due(eight, 20_261_123), None); // already sent today
        assert_eq!(due(eight + 3600, 0), None); // the window is over: a restart at noon sends nothing
        assert_eq!(due(eight + 86_400, 20_261_123), Some(20_261_124));
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
        println!("{}", text(&[a, b, c], 20_261_124, Some("2026-11-24T05:30:00.000Z")).unwrap());
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
