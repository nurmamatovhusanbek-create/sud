//! The courts answer in Cyrillic; the bot speaks Latin (the app's old alphabet). Same rules as `core/translit.ts` of the app and
//! `static/js/core/translit.js` of the Mini App: a change to one must be made in all three.

fn is_cyr(c: char) -> bool {
    ('\u{0400}'..='\u{04FF}').contains(&c)
}

fn map(lo: char) -> Option<&'static str> {
    Some(match lo {
        'а' => "a", 'б' => "b", 'в' => "v", 'г' => "g", 'д' => "d", 'ж' => "j", 'з' => "z", 'и' => "i", 'й' => "y", 'к' => "k", 'л' => "l", 'м' => "m",
        'н' => "n", 'о' => "o", 'п' => "p", 'р' => "r", 'с' => "s", 'т' => "t", 'у' => "u", 'ф' => "f", 'х' => "x", 'ч' => "ch", 'ш' => "sh", 'э' => "e",
        'ў' => "oʻ", 'қ' => "q", 'ғ' => "gʻ", 'ҳ' => "h", 'ё' => "yo", 'ю' => "yu", 'я' => "ya", 'ц' => "ts", 'ъ' => "ʼ", 'ь' => "",
        _ => return None,
    })
}

fn lower(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

fn is_upper_letter(c: char) -> bool {
    c.to_uppercase().next() == Some(c) && lower(c) != c
}

pub fn to_latin(s: &str) -> String {
    if !s.chars().any(is_cyr) {
        return s.to_string();
    }
    let cs: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    for (i, &ch) in cs.iter().enumerate() {
        let lo = lower(ch);
        let mut l: String = if lo == 'е' {
            // «ye» at the start of a word and after a vowel / ъ / ь, otherwise «e»
            let p = if i == 0 { None } else { Some(lower(cs[i - 1])) };
            let ye = match p {
                None => true,
                Some(p) => !(is_cyr(p) || p.is_ascii_alphabetic()) || "аеёиоуэюяъь".contains(p),
            };
            (if ye { "ye" } else { "e" }).to_string()
        } else if let Some(m) = map(lo) {
            let mut m = m.to_string();
            if lo == 'с' && cs.get(i + 1).map(|c| lower(*c)) == Some('ҳ') {
                m.push('ʼ'); // «сҳ» are two letters, not the digraph «sh»
            }
            m
        } else {
            out.push(ch);
            continue;
        };
        if ch != lo {
            // the LAST letter of an all-capitals word has no capital after it: the one before it says (ШОДИЯ → SHODIYA)
            let next = cs.get(i + 1).copied();
            let prev_upper = i > 0 && is_upper_letter(cs[i - 1]);
            let word_upper = next.is_some_and(is_upper_letter) || (prev_upper && !next.is_some_and(|n| lower(n) != n.to_uppercase().next().unwrap_or(n)));
            l = if word_upper {
                l.to_uppercase()
            } else {
                let mut it = l.chars();
                it.next().map(|f| f.to_uppercase().collect::<String>() + it.as_str()).unwrap_or_default()
            };
        }
        out.push_str(&l);
    }
    // the abbreviation of a limited company is written MChJ
    let mut res = String::with_capacity(out.len());
    let chars: Vec<char> = out.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i..].starts_with(&['M', 'C', 'H', 'J']) && (i == 0 || !chars[i - 1].is_alphanumeric()) && chars.get(i + 4).is_none_or(|c| !c.is_alphanumeric()) {
            res.push_str("MChJ");
            i += 4;
        } else {
            res.push(chars[i]);
            i += 1;
        }
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latin_text_is_untouched() {
        assert_eq!(to_latin("Ish 2-1004-2503/8020"), "Ish 2-1004-2503/8020");
    }

    #[test]
    fn courts_names_and_statuses_read_as_uzbek_latin() {
        assert_eq!(to_latin("Якунланган"), "Yakunlangan");
        assert_eq!(to_latin("Кўриб чиқиш жараёнида"), "Koʻrib chiqish jarayonida");
        assert_eq!(to_latin("Тошкент туманлараро фуқаролик суди"), "Toshkent tumanlararo fuqarolik sudi");
        assert_eq!(to_latin("Ғафур Ғулом"), "Gʻafur Gʻulom");
    }

    #[test]
    fn ye_after_a_vowel_or_at_the_start_and_the_two_letters_s_and_h() {
        assert_eq!(to_latin("Еров"), "Yerov");
        assert_eq!(to_latin("Аъзам"), "Aʼzam");
        assert_eq!(to_latin("Исҳоқ"), "Isʼhoq");
        assert_eq!(to_latin("Бек"), "Bek");
    }

    #[test]
    fn capitals_follow_the_word_and_the_company_form_keeps_its_spelling() {
        assert_eq!(to_latin("ШОДИЯ"), "SHODIYA");
        assert_eq!(to_latin("Шодия"), "Shodiya");
        assert_eq!(to_latin("ANOR МЧЖ"), "ANOR MChJ");
        assert_eq!(to_latin("МЧЖ"), "MChJ");
    }
}
