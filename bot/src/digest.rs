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

/// the most hearings listed in the message itself (a hundred do not fit in one Telegram message; the rest is one tap away in the Mini App)
const LISTED: usize = 25;

/// The text of the message, or None when there is nothing to say (no hearing in the next seven days: silence, not «nothing»). `hearings` is the whole
/// week; the message lists the first few and says how many more there are.
pub fn text(hearings: &[crate::domain::Hearing], today: u32, backup_at: Option<&str>) -> Option<String> {
    if hearings.is_empty() {
        return None;
    }
    let mut out = format!("📅 Yaqin majlislar (7 kun): {} ta\n\n", hearings.len());
    out.push_str(&fmt_hearing_block(&hearings[..hearings.len().min(LISTED)], today));
    if hearings.len() > LISTED {
        out.push_str(&format!("\n… va yana {} ta: pastdagi tugma bilan hammasini oching.", hearings.len() - LISTED));
    }
    if let Some(at) = backup_at.filter(|a| a.len() >= 10) {
        out.push_str(&format!("\nMaʼlumot {} holatiga (zaxira).", crate::chat::dmy_iso(at)));
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
        let button = sh.cfg.public_url.as_ref().map(|u| serde_json::json!({ "inline_keyboard": [[{ "text": "Majlislar Mini App'da", "web_app": { "url": format!("{u}/app?tab=hearings") } }]] }));
        for user in &sh.cfg.allowed {
            sh.outbox.send(*user, &body, button.clone()).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Hearing;

    fn h(day: u32, time: &str, num: &str) -> Hearing {
        Hearing { tin: "1".into(), case_number: num.into(), court: "civil".into(), day, time: time.into(), stage: "first".into(), status: "Тайинлаш".into(), plaintiff: "Универсал МЧЖ".into(), defendant: "ANOR МЧЖ".into(), role: "", counterparty: String::new() }
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
        assert!(t.starts_with("📅 Yaqin majlislar (7 kun): 120 ta"));
        assert!(t.contains("… va yana 95 ta") && t.len() < 4096, "{}", t.len());
        assert_eq!(t.matches("⏰").count(), 25);
    }

    #[test]
    fn today_and_tomorrow_are_named_and_the_text_is_latin() {
        let t = text(&[h(20_261_123, "10:00", "2-1004-2503/1"), h(20_261_124, "09:30", "2-1004-2503/2"), h(20_261_127, "14:00", "2-1004-2503/3")], 20_261_123, Some("2026-11-22T10:00:00.000Z")).unwrap();
        assert!(t.contains("Bugun") && t.contains("Ertaga") && t.contains("27.11.2026"));
        assert!(t.contains("10:00") && t.contains("2-1004-2503/1") && t.contains("Universal MChJ") && !t.contains("МЧЖ"));
        assert!(t.contains("22.11.2026 holatiga"));
    }
}
