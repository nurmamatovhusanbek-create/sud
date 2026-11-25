//! Per-person reminder settings: when the morning and the evening message come, how many days the morning one covers, and which companies it is about.
//!
//! WHERE THEY ARE KEPT. The bot's host (Render's free tier) loses its disk at every restart, and the bot must not write to the backup channel, so each
//! person's settings live in a message PINNED in their own chat with the bot: it is the settings screen itself (the text they read, the buttons they press)
//! and its last line carries the values as a short code. At start-up and on first use the bot asks Telegram for the chat's pinned message (`getChat`) and
//! reads the code back. Nothing else is stored anywhere; losing the pinned message just brings the defaults back.

use crate::chat::fmt_int;
use crate::format::esc;
use crate::translit::to_latin as lat;
use serde_json::{json, Value};

const MARK: &str = "sozlama kodi:";

/// the times offered (minutes after midnight, Uzbekistan time) and the horizons
pub const MORNING_TIMES: [u32; 3] = [7 * 60, 8 * 60, 9 * 60];
pub const EVENING_TIMES: [u32; 4] = [17 * 60, 18 * 60, 19 * 60, 20 * 60];
pub const DAYS: [u32; 4] = [3, 7, 14, 30];

/// companies per page of the picker (two to a row), and how many pages `n` companies make
pub const PICK_PAGE: usize = 8;
pub fn pages(n: usize) -> usize {
    n.div_ceil(PICK_PAGE).max(1)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Prefs {
    /// minutes after midnight, None = off
    pub morning: Option<u32>,
    pub evening: Option<u32>,
    /// how many days the morning message covers (today included)
    pub days: u32,
    /// the companies the reminders are about; empty = all
    pub tins: Vec<String>,
    /// the day (yyyymmdd) the morning / evening message was last SENT for, 0 = never. It lives in the pinned code too: the bot's memory is lost whenever
    /// the host restarts or wakes from sleep, and without this a restart inside the hour after the chosen time sent the same reminder again.
    pub sent_m: u32,
    pub sent_e: u32,
}

impl Default for Prefs {
    fn default() -> Prefs {
        Prefs { morning: Some(8 * 60), evening: Some(18 * 60), days: 7, tins: Vec::new(), sent_m: 0, sent_e: 0 }
    }
}

fn hhmm(min: u32) -> String {
    format!("{:02}:{:02}", min / 60, min % 60)
}

fn code_time(t: Option<u32>) -> String {
    t.map(|m| format!("{:02}{:02}", m / 60, m % 60)).unwrap_or_else(|| "off".into())
}

fn parse_time(s: &str) -> Option<Option<u32>> {
    if s == "off" {
        return Some(None);
    }
    if s.len() != 4 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (h, m): (u32, u32) = (s[..2].parse().ok()?, s[2..].parse().ok()?);
    (h < 24 && m < 60).then_some(Some(h * 60 + m))
}

fn is_tin(s: &str) -> bool {
    s.len() == 9 && s.bytes().all(|b| b.is_ascii_digit())
}

impl Prefs {
    /// the values as the short code on the last line of the settings message: `m=0800 e=1800 d=7 c=*`
    pub fn code(&self) -> String {
        let c = if self.tins.is_empty() { "*".to_string() } else { self.tins.join(",") };
        let sent = [("sm", self.sent_m), ("se", self.sent_e)].iter().filter(|(_, d)| *d > 0).map(|(k, d)| format!(" {k}={d}")).collect::<String>();
        format!("m={} e={} d={} c={c}{sent}", code_time(self.morning), code_time(self.evening), self.days)
    }

    /// the settings out of the plain text of a pinned message; None when it is not a settings message (the defaults then apply)
    pub fn parse(text: &str) -> Option<Prefs> {
        let at = text.find(MARK)?;
        let mut p = Prefs::default();
        for tok in text[at + MARK.len()..].split_whitespace() {
            let Some((k, v)) = tok.split_once('=') else { continue };
            match k {
                "m" => p.morning = parse_time(v)?,
                "e" => p.evening = parse_time(v)?,
                "d" => p.days = v.parse::<u32>().ok().filter(|d| (1..=crate::service::MAX_HEARING_DAYS).contains(d))?,
                "c" => p.tins = if v == "*" { Vec::new() } else { v.split(',').filter(|t| is_tin(t)).map(str::to_string).collect() },
                "sm" => p.sent_m = v.parse().ok()?,
                "se" => p.sent_e = v.parse().ok()?,
                _ => {}
            }
        }
        Some(p)
    }

    /// does a company belong to the reminders
    pub fn wants(&self, tin: &str) -> bool {
        self.tins.is_empty() || self.tins.iter().any(|t| t == tin)
    }

    /// One button press: `m:0800`, `m:off`, `e:1800`, `e:off`, `d:14`, `c:<STIR>` (toggle), `c:all`, `g:<page>` (only turn the company page). Every button may end in
    /// `@<page>`: the page of the company picker that was showing, so the screen is drawn again on the same page. Gives the page to draw, or None when the data
    /// means nothing (nothing changes). `all` = the STIRs of every company, to tell «this one only» from «everything but this one».
    pub fn apply(&mut self, data: &str, all: &[String]) -> Option<usize> {
        let (data, page) = match data.rsplit_once('@') {
            Some((d, p)) => (d, p.parse::<usize>().ok()?),
            None => (data, 0),
        };
        let (k, v) = data.split_once(':')?;
        match k {
            "m" => match parse_time(v) {
                Some(t) if t.map_or(true, |m| MORNING_TIMES.contains(&m)) => self.morning = t,
                _ => return None,
            },
            "e" => match parse_time(v) {
                Some(t) if t.map_or(true, |m| EVENING_TIMES.contains(&m)) => self.evening = t,
                _ => return None,
            },
            "d" => match v.parse::<u32>() {
                Ok(d) if DAYS.contains(&d) => self.days = d,
                _ => return None,
            },
            "g" => return Some(v.parse::<usize>().ok()?.min(pages(all.len()).saturating_sub(1))),
            "c" if v == "all" => self.tins.clear(),
            "c" if is_tin(v) && all.iter().any(|t| t == v) => {
                if self.tins.is_empty() {
                    self.tins = vec![v.to_string()] // from «all»: this company only
                } else if let Some(i) = self.tins.iter().position(|t| t == v) {
                    self.tins.remove(i);
                } else {
                    self.tins.push(v.to_string());
                }
                // every company picked is the same as «all»
                if self.tins.len() >= all.len() {
                    self.tins.clear();
                }
            }
            _ => return None,
        }
        Some(page.min(pages(all.len()).saturating_sub(1)))
    }

    /// the settings screen (Telegram HTML): what is on, when, and the code the bot reads back
    pub fn text(&self, companies: &[(String, String)]) -> String {
        let mut out = String::from("⚙️ <b>Eslatma sozlamalari</b>\n\n");
        out.push_str(&match self.morning {
            Some(m) => format!("🌅 <b>Ertalabki eslatma:</b> {} · keyingi {} kun\n", hhmm(m), self.days),
            None => "🌅 <b>Ertalabki eslatma:</b> oʻchiq\n".to_string(),
        });
        out.push_str(&match self.evening {
            Some(m) => format!("🌙 <b>Kechki eslatma:</b> {} · ertangi majlislar\n", hhmm(m)),
            None => "🌙 <b>Kechki eslatma:</b> oʻchiq\n".to_string(),
        });
        let who = if self.tins.is_empty() {
            "hamma kompaniyalar".to_string()
        } else {
            let names: Vec<String> = self.tins.iter().map(|t| companies.iter().find(|(x, _)| x == t).map(|(_, n)| short(n)).filter(|n| !n.is_empty()).unwrap_or_else(|| t.clone())).collect();
            let shown = names.iter().take(4).cloned().collect::<Vec<_>>().join(", ");
            let more = if names.len() > 4 { format!(" va yana {} ta", fmt_int((names.len() - 4) as i64)) } else { String::new() };
            format!("{} ta: {}{}", fmt_int(names.len() as i64), esc(&shown), more)
        };
        out.push_str(&format!("🏢 <b>Kompaniyalar:</b> {who}\n\n"));
        out.push_str("Vaqt Oʻzbekiston vaqti bilan (UTC+5). Majlis boʻlmasa, xabar kelmaydi. Oʻzgartirish uchun pastdagi tugmalarni bosing.\n\n");
        out.push_str(&format!("<i>{MARK} {}</i>", self.code()));
        out
    }

    /// The buttons: the morning times, the evening times, the horizons and the companies (a tick marks what is chosen). The companies are two to a row and
    /// `PICK_PAGE` to a page, with «‹ 2/7 ›» under them: a person may have hundreds, and Telegram takes at most about 100 buttons in a message.
    /// Every callback carries the page (`@n`) so a press redraws the screen where it was.
    pub fn keyboard(&self, companies: &[(String, String)], page: usize) -> Value {
        let page = page.min(pages(companies.len()).saturating_sub(1));
        let tick = |on: bool, label: &str| if on { format!("✓ {label}") } else { label.to_string() };
        let mut rows: Vec<Value> = Vec::new();
        let mut morning: Vec<Value> = MORNING_TIMES.iter().map(|m| json!({ "text": tick(self.morning == Some(*m), &hhmm(*m)), "callback_data": format!("s:m:{}@{page}", code_time(Some(*m))) })).collect();
        morning.push(json!({ "text": tick(self.morning.is_none(), "Oʻchiq"), "callback_data": format!("s:m:off@{page}") }));
        rows.push(json!([{ "text": "🌅 Ertalab", "callback_data": "s:noop" }]));
        rows.push(Value::Array(morning));
        let mut evening: Vec<Value> = EVENING_TIMES.iter().map(|m| json!({ "text": tick(self.evening == Some(*m), &hhmm(*m)), "callback_data": format!("s:e:{}@{page}", code_time(Some(*m))) })).collect();
        evening.push(json!({ "text": tick(self.evening.is_none(), "Oʻchiq"), "callback_data": format!("s:e:off@{page}") }));
        rows.push(json!([{ "text": "🌙 Kechqurun", "callback_data": "s:noop" }]));
        rows.push(Value::Array(evening));
        rows.push(json!([{ "text": "📅 Ertalabki eslatma necha kunni qamrab oladi", "callback_data": "s:noop" }]));
        rows.push(Value::Array(DAYS.iter().map(|d| json!({ "text": tick(self.days == *d, &format!("{d} kun")), "callback_data": format!("s:d:{d}@{page}") })).collect()));
        if !companies.is_empty() {
            rows.push(json!([{ "text": "🏢 Kompaniyalar", "callback_data": "s:noop" }]));
            rows.push(json!([{ "text": tick(self.tins.is_empty(), "Hammasi"), "callback_data": format!("s:c:all@{page}") }]));
            let slice = &companies[page * PICK_PAGE..companies.len().min((page + 1) * PICK_PAGE)];
            for pair in slice.chunks(2) {
                rows.push(Value::Array(
                    pair.iter()
                        .map(|(tin, name)| {
                            let label = short(name);
                            let label = if label.is_empty() { tin.clone() } else { label };
                            json!({ "text": format!("{} {label}", if self.tins.iter().any(|t| t == tin) { "☑" } else { "☐" }), "callback_data": format!("s:c:{tin}@{page}") })
                        })
                        .collect(),
                ));
            }
            let n = pages(companies.len());
            if n > 1 {
                rows.push(json!([
                    { "text": "‹", "callback_data": format!("s:g:{}@{}", page.saturating_sub(1), page.saturating_sub(1)) },
                    { "text": format!("{}/{n}", page + 1), "callback_data": "s:noop" },
                    { "text": "›", "callback_data": format!("s:g:{}@{}", (page + 1).min(n - 1), (page + 1).min(n - 1)) },
                ]));
            }
        }
        json!({ "inline_keyboard": rows })
    }
}

/// a company's name shortened to fit a button, in Latin
fn short(name: &str) -> String {
    let n = lat(name);
    let n = n.trim();
    if n.chars().count() <= 16 { n.to_string() } else { format!("{}…", n.chars().take(15).collect::<String>().trim_end()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all() -> Vec<String> {
        vec!["207275139".into(), "302678824".into(), "200248856".into()]
    }

    #[test]
    fn the_code_reads_back_exactly() {
        for p in [
            Prefs::default(),
            Prefs { morning: None, evening: Some(19 * 60), days: 30, tins: vec!["207275139".into(), "302678824".into()], sent_m: 0, sent_e: 20_261_125 },
            Prefs { morning: Some(7 * 60), evening: None, days: 3, tins: vec![], sent_m: 20_261_124, sent_e: 0 },
        ] {
            assert_eq!(Prefs::parse(&crate::format::plain(&p.text(&[]))), Some(p.clone()), "{}", p.code());
        }
        assert_eq!(Prefs::default().code(), "m=0800 e=1800 d=7 c=*");
    }

    #[test]
    fn a_pinned_message_that_is_not_ours_gives_nothing_and_a_damaged_code_gives_nothing() {
        assert_eq!(Prefs::parse("salom, bu boshqa xabar"), None);
        assert_eq!(Prefs::parse("sozlama kodi: m=9999 e=1800 d=7 c=*"), None);
        assert_eq!(Prefs::parse("sozlama kodi: m=0800 e=1800 d=0 c=*"), None);
        // unknown parts are ignored, a missing part is the default
        assert_eq!(Prefs::parse("sozlama kodi: d=14"), Some(Prefs { days: 14, ..Prefs::default() }));
    }

    #[test]
    fn the_buttons_change_one_thing_and_nonsense_changes_nothing() {
        let mut p = Prefs::default();
        assert!(p.apply("m:0900", &all()).is_some() && p.morning == Some(9 * 60));
        assert!(p.apply("m:off", &all()).is_some() && p.morning.is_none());
        assert!(p.apply("e:2000", &all()).is_some() && p.evening == Some(20 * 60));
        assert!(p.apply("d:14", &all()).is_some() && p.days == 14);
        for bad in ["m:0830", "m:1200", "e:0800", "d:5", "d:x", "c:123", "c:111111111", "zzz", "m"] {
            assert!(p.apply(bad, &all()).is_none(), "{bad}");
        }
        assert_eq!((p.morning, p.evening, p.days), (None, Some(20 * 60), 14));
    }

    #[test]
    fn companies_toggle_from_all_to_this_one_and_back() {
        let mut p = Prefs::default();
        assert!(p.wants("302678824")); // all
        assert!(p.apply("c:207275139", &all()).is_some() && p.tins == vec!["207275139".to_string()]); // from «all»: this one only
        assert!(p.wants("207275139") && !p.wants("302678824"));
        assert!(p.apply("c:302678824", &all()).is_some() && p.tins.len() == 2);
        assert!(p.apply("c:207275139", &all()).is_some() && p.tins == vec!["302678824".to_string()]);
        assert!(p.apply("c:302678824", &all()).is_some() && p.tins.is_empty()); // the last one off: all again
        assert!(p.apply("c:207275139", &all()).is_some() && p.apply("c:302678824", &all()).is_some() && p.apply("c:200248856", &all()).is_some());
        assert!(p.tins.is_empty(), "every company picked is «all»");
        p.apply("c:207275139", &all());
        assert!(p.apply("c:all", &all()).is_some() && p.tins.is_empty());
    }

    #[test]
    fn the_screen_names_what_is_on_and_marks_it_in_the_buttons() {
        let names = vec![("207275139".to_string(), "«ANDIJONKABEL» AKSIYADORLIK JAMIYATI".to_string()), ("302678824".to_string(), "A & B <x> МЧЖ".to_string())];
        let p = Prefs { tins: vec!["302678824".into()], ..Prefs::default() };
        let t = p.text(&names);
        assert!(t.contains("🌅 <b>Ertalabki eslatma:</b> 08:00 · keyingi 7 kun") && t.contains("🌙 <b>Kechki eslatma:</b> 18:00 · ertangi majlislar"), "{t}");
        assert!(t.contains("A &amp; B &lt;x&gt; MChJ") && !t.contains("<x>"), "{t}"); // a name cannot break the message
        let kb = p.keyboard(&names, 0).to_string();
        assert!(kb.contains("✓ 08:00") && kb.contains("✓ 18:00") && kb.contains("✓ 7 kun") && kb.contains("☑ A &") || kb.contains("☑ A & B"), "{kb}");
        assert!(kb.contains("s:c:302678824") && kb.contains("s:m:off") && kb.contains("s:e:1900"));
        // every callback fits Telegram's 64 bytes
        for row in p.keyboard(&names, 0)["inline_keyboard"].as_array().unwrap() {
            for b in row.as_array().unwrap() {
                assert!(b["callback_data"].as_str().unwrap().len() <= 64);
            }
        }
    }

    fn many(n: usize) -> Vec<(String, String)> {
        (0..n).map(|i| (format!("{}", 200_000_000 + i), format!("Kompaniya raqami {i} mas'uliyati cheklangan jamiyat"))).collect()
    }

    #[test]
    fn a_long_picker_is_two_to_a_row_a_page_at_a_time_and_stays_under_telegrams_limits() {
        let names = many(100);
        let all: Vec<String> = names.iter().map(|(t, _)| t.clone()).collect();
        let p = Prefs::default();
        for page in [0, 5, 12, 99] {
            let kb = p.keyboard(&names, page);
            let rows = kb["inline_keyboard"].as_array().unwrap();
            let buttons: usize = rows.iter().map(|r| r.as_array().unwrap().len()).sum();
            assert!(buttons < 40, "page {page}: {buttons} buttons");
            let companies = rows.iter().filter(|r| r[0]["callback_data"].as_str().unwrap().starts_with("s:c:2")).count();
            assert_eq!(companies, if page >= 12 { 2 } else { PICK_PAGE / 2 }, "two to a row");
            for r in rows {
                for b in r.as_array().unwrap() {
                    assert!(b["callback_data"].as_str().unwrap().len() <= 64, "{b}");
                }
            }
        }
        // the page shows the right companies and the nav row says where we are
        let kb = p.keyboard(&names, 1).to_string();
        assert!(kb.contains("s:c:200000008@1") && kb.contains("s:c:200000015@1") && !kb.contains("s:c:200000007@1") && !kb.contains("s:c:200000016@1"), "{kb}");
        assert!(kb.contains("2/13") && kb.contains("s:g:0@0") && kb.contains("s:g:2@2"), "{kb}");
        // a short list has no nav row
        assert!(!p.keyboard(&many(5), 0).to_string().contains("1/1"));
        // the page survives a press and is clamped
        let mut p = Prefs::default();
        assert_eq!(p.apply("c:200000009@1", &all), Some(1));
        assert_eq!(p.tins, vec!["200000009".to_string()]);
        assert_eq!(p.apply("g:3", &all), Some(3));
        assert_eq!(p.apply("g:999", &all), Some(12));
        assert_eq!(p.apply("m:0900@999", &all), Some(12));
        assert_eq!(p.apply("m:0900@x", &all), None);
    }

    #[test]
    fn the_text_names_a_few_companies_and_counts_the_rest() {
        let names = many(30);
        let p = Prefs { tins: names.iter().take(12).map(|(t, _)| t.clone()).collect(), ..Prefs::default() };
        let t = p.text(&names);
        assert!(t.contains("12 ta:") && t.contains("va yana 8 ta"), "{t}");
        assert!(t.len() < 1200, "{}", t.len());
    }
}
