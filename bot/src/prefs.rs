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

#[derive(Debug, Clone, PartialEq)]
pub struct Prefs {
    /// minutes after midnight, None = off
    pub morning: Option<u32>,
    pub evening: Option<u32>,
    /// how many days the morning message covers (today included)
    pub days: u32,
    /// the companies the reminders are about; empty = all
    pub tins: Vec<String>,
}

impl Default for Prefs {
    fn default() -> Prefs {
        Prefs { morning: Some(8 * 60), evening: Some(18 * 60), days: 7, tins: Vec::new() }
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
        format!("m={} e={} d={} c={c}", code_time(self.morning), code_time(self.evening), self.days)
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
                _ => {}
            }
        }
        Some(p)
    }

    /// does a company belong to the reminders
    pub fn wants(&self, tin: &str) -> bool {
        self.tins.is_empty() || self.tins.iter().any(|t| t == tin)
    }

    /// One button press: `m:0800`, `m:off`, `e:1800`, `e:off`, `d:14`, `c:<STIR>` (toggle), `c:all`. False when the data means nothing (nothing changes).
    /// `all` = the STIRs of every company, to tell «this one only» from «everything but this one».
    pub fn apply(&mut self, data: &str, all: &[String]) -> bool {
        let Some((k, v)) = data.split_once(':') else { return false };
        match k {
            "m" => match parse_time(v) {
                Some(t) if t.map_or(true, |m| MORNING_TIMES.contains(&m)) => self.morning = t,
                _ => return false,
            },
            "e" => match parse_time(v) {
                Some(t) if t.map_or(true, |m| EVENING_TIMES.contains(&m)) => self.evening = t,
                _ => return false,
            },
            "d" => match v.parse::<u32>() {
                Ok(d) if DAYS.contains(&d) => self.days = d,
                _ => return false,
            },
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
            _ => return false,
        }
        true
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
            format!("{} ta: {}", fmt_int(names.len() as i64), esc(&names.join(", ")))
        };
        out.push_str(&format!("🏢 <b>Kompaniyalar:</b> {who}\n\n"));
        out.push_str("Vaqt Oʻzbekiston vaqti bilan (UTC+5). Majlis boʻlmasa, xabar kelmaydi. Oʻzgartirish uchun pastdagi tugmalarni bosing.\n\n");
        out.push_str(&format!("<i>{MARK} {}</i>", self.code()));
        out
    }

    /// the buttons: the morning times, the evening times, the horizons and the companies (a tick marks what is chosen)
    pub fn keyboard(&self, companies: &[(String, String)]) -> Value {
        let tick = |on: bool, label: &str| if on { format!("✓ {label}") } else { label.to_string() };
        let mut rows: Vec<Value> = Vec::new();
        let mut morning: Vec<Value> = MORNING_TIMES.iter().map(|m| json!({ "text": tick(self.morning == Some(*m), &hhmm(*m)), "callback_data": format!("s:m:{}", code_time(Some(*m))) })).collect();
        morning.push(json!({ "text": tick(self.morning.is_none(), "Oʻchiq"), "callback_data": "s:m:off" }));
        rows.push(json!([{ "text": "🌅 Ertalab", "callback_data": "s:noop" }]));
        rows.push(Value::Array(morning));
        let mut evening: Vec<Value> = EVENING_TIMES.iter().map(|m| json!({ "text": tick(self.evening == Some(*m), &hhmm(*m)), "callback_data": format!("s:e:{}", code_time(Some(*m))) })).collect();
        evening.push(json!({ "text": tick(self.evening.is_none(), "Oʻchiq"), "callback_data": "s:e:off" }));
        rows.push(json!([{ "text": "🌙 Kechqurun", "callback_data": "s:noop" }]));
        rows.push(Value::Array(evening));
        rows.push(json!([{ "text": "📅 Ertalabki eslatma necha kunni qamrab oladi", "callback_data": "s:noop" }]));
        rows.push(Value::Array(DAYS.iter().map(|d| json!({ "text": tick(self.days == *d, &format!("{d} kun")), "callback_data": format!("s:d:{d}") })).collect()));
        if !companies.is_empty() {
            rows.push(json!([{ "text": "🏢 Kompaniyalar", "callback_data": "s:noop" }]));
            rows.push(json!([{ "text": tick(self.tins.is_empty(), "Hammasi"), "callback_data": "s:c:all" }]));
            for (tin, name) in companies {
                let label = short(name);
                let label = if label.is_empty() { tin.clone() } else { label };
                rows.push(json!([{ "text": format!("{} {label}", if self.tins.iter().any(|t| t == tin) { "☑" } else { "☐" }), "callback_data": format!("s:c:{tin}") }]));
            }
        }
        json!({ "inline_keyboard": rows })
    }
}

/// a company's name shortened to fit a button, in Latin
fn short(name: &str) -> String {
    let n = lat(name);
    let n = n.trim();
    if n.chars().count() <= 28 { n.to_string() } else { format!("{}…", n.chars().take(27).collect::<String>().trim_end()) }
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
            Prefs { morning: None, evening: Some(19 * 60), days: 30, tins: vec!["207275139".into(), "302678824".into()] },
            Prefs { morning: Some(7 * 60), evening: None, days: 3, tins: vec![] },
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
        assert!(p.apply("m:0900", &all()) && p.morning == Some(9 * 60));
        assert!(p.apply("m:off", &all()) && p.morning.is_none());
        assert!(p.apply("e:2000", &all()) && p.evening == Some(20 * 60));
        assert!(p.apply("d:14", &all()) && p.days == 14);
        for bad in ["m:0830", "m:1200", "e:0800", "d:5", "d:x", "c:123", "c:111111111", "zzz", "m"] {
            assert!(!p.apply(bad, &all()), "{bad}");
        }
        assert_eq!((p.morning, p.evening, p.days), (None, Some(20 * 60), 14));
    }

    #[test]
    fn companies_toggle_from_all_to_this_one_and_back() {
        let mut p = Prefs::default();
        assert!(p.wants("302678824")); // all
        assert!(p.apply("c:207275139", &all()) && p.tins == vec!["207275139".to_string()]); // from «all»: this one only
        assert!(p.wants("207275139") && !p.wants("302678824"));
        assert!(p.apply("c:302678824", &all()) && p.tins.len() == 2);
        assert!(p.apply("c:207275139", &all()) && p.tins == vec!["302678824".to_string()]);
        assert!(p.apply("c:302678824", &all()) && p.tins.is_empty()); // the last one off: all again
        assert!(p.apply("c:207275139", &all()) && p.apply("c:302678824", &all()) && p.apply("c:200248856", &all()));
        assert!(p.tins.is_empty(), "every company picked is «all»");
        p.apply("c:207275139", &all());
        assert!(p.apply("c:all", &all()) && p.tins.is_empty());
    }

    #[test]
    fn the_screen_names_what_is_on_and_marks_it_in_the_buttons() {
        let names = vec![("207275139".to_string(), "«ANDIJONKABEL» AKSIYADORLIK JAMIYATI".to_string()), ("302678824".to_string(), "A & B <x> МЧЖ".to_string())];
        let p = Prefs { tins: vec!["302678824".into()], ..Prefs::default() };
        let t = p.text(&names);
        assert!(t.contains("🌅 <b>Ertalabki eslatma:</b> 08:00 · keyingi 7 kun") && t.contains("🌙 <b>Kechki eslatma:</b> 18:00 · ertangi majlislar"), "{t}");
        assert!(t.contains("A &amp; B &lt;x&gt; MChJ") && !t.contains("<x>"), "{t}"); // a name cannot break the message
        let kb = p.keyboard(&names).to_string();
        assert!(kb.contains("✓ 08:00") && kb.contains("✓ 18:00") && kb.contains("✓ 7 kun") && kb.contains("☑ A &") || kb.contains("☑ A & B"), "{kb}");
        assert!(kb.contains("s:c:302678824") && kb.contains("s:m:off") && kb.contains("s:e:1900"));
        // every callback fits Telegram's 64 bytes
        for row in p.keyboard(&names)["inline_keyboard"].as_array().unwrap() {
            for b in row.as_array().unwrap() {
                assert!(b["callback_data"].as_str().unwrap().len() <= 64);
            }
        }
    }
}
