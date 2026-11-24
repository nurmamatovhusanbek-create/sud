//! The look of the bot's messages. They are sent as Telegram HTML (bold titles, the case number as `code` you can tap to copy), so EVERY piece of text that
//! comes from the data goes through `esc` first: a company called «A & B» or a name with «<» must not break a message. Courts' Cyrillic is turned into
//! Latin by the caller (`translit::to_latin`) before it gets here.

/// HTML-safe text
pub fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(c),
        }
    }
    out
}

/// the text of an HTML message as Telegram hands it back (`getChat` → pinned message `text`): no tags, the entities turned back into characters
#[cfg_attr(not(test), allow(dead_code))]
pub fn plain(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if in_tag => {}
            _ => out.push(c),
        }
    }
    out.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

/// a court type in words
pub fn court_word(court: &str) -> &'static str {
    match court {
        "economic" => "Iqtisodiy",
        "civil" => "Fuqarolik",
        "administrative" => "Maʼmuriy",
        "criminal" => "Jinoyat",
        _ => "",
    }
}

/// the heading of a day in a list: «Bugun · 24.11.2026 · seshanba», «Ertaga · …», else «27.11.2026 · juma»
pub fn day_head(day: u32, today: u32) -> String {
    let date = crate::date::dmy(day);
    let wd = crate::date::weekday(day);
    if day == today {
        format!("Bugun · {date} · {wd}")
    } else if day == crate::date::add_days(today, 1) {
        format!("Ertaga · {date} · {wd}")
    } else {
        format!("{date} · {wd}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_cannot_break_a_message() {
        assert_eq!(esc("A & B <MChJ> «x»"), "A &amp; B &lt;MChJ&gt; «x»");
        assert_eq!(esc("oddiy matn"), "oddiy matn");
    }

    #[test]
    fn a_day_is_named_with_its_weekday() {
        assert_eq!(day_head(20_261_124, 20_261_124), "Bugun · 24.11.2026 · seshanba");
        assert_eq!(day_head(20_261_125, 20_261_124), "Ertaga · 25.11.2026 · chorshanba");
        assert_eq!(day_head(20_261_127, 20_261_124), "27.11.2026 · juma");
    }
}
