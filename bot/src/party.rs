//! Who is who in a case. The backup knows the company's name (as its own bills spell it) and each case's two parties; the company is the plaintiff or the
//! defendant. A party's TIN in a case detail decides first (exact); otherwise the names are compared the way the app's `core/classify` does: the courts
//! write Cyrillic («ПРОКАБ» МЧЖ), the registers Latin, and the spelling differs beyond script (c/k, q/k, x/h), so both are put in Latin, stripped of
//! quotes and legal-form words (MChJ, AJ, XK …) and of the letters that vary, and compared by words.

use crate::translit::to_latin;

/// legal-form words: they say what KIND of company it is, not which one
const LEGAL: &[&str] = &[
    "mchj", "aj", "ooo", "oao", "ao", "xk", "uk", "fx", "yatt", "ok", "masʼuliyati", "masuliyati", "cheklangan", "jamiyati", "jamiyat", "aktsiyadorlik", "aksiyadorlik", "xususiy",
    "korxonasi", "korxona", "qoshma", "kooperativ", "kompaniyasi",
];

/// one word, with the letters that vary between spellings folded together
fn fold(word: &str) -> String {
    let mut out = String::new();
    for c in word.chars() {
        let c = match c {
            'c' | 'q' | 'k' => 'k',
            'x' | 'h' => 'h',
            'w' | 'v' => 'v',
            'ʻ' | 'ʼ' | '\'' | '`' | '’' | '‘' => continue,
            c => c,
        };
        if out.chars().last() != Some(c) {
            out.push(c); // «ll» → «l»
        }
    }
    // Cyrillic «кс» and Latin «x» are one sound (ТЕКСТИЛЕ / TEXTILE): both end up as «h»
    out.replace("ks", "h")
}

/// the words of a name that tell companies apart: Latin, lowercase, no quotes, no legal-form words, spelling folded
pub fn distinctive(s: &str) -> Vec<String> {
    to_latin(s)
        .to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || c == 'ʻ' || c == 'ʼ' || c == '\''))
        .filter(|w| !w.is_empty() && !LEGAL.contains(w))
        .map(fold)
        .filter(|w| !w.is_empty())
        .collect()
}

/// Do these two names mean the same company? All the distinctive words of the SHORTER name are in the other (so «ANOR» matches «ANOR TEXTILE», but two
/// MChJs never match just because both are MChJs: the legal form is not a word here).
pub fn same_party(company: &str, party: &str) -> bool {
    let (a, b) = (distinctive(company), distinctive(party));
    if a.is_empty() || b.is_empty() {
        return false;
    }
    let (short, long) = if a.len() <= b.len() { (&a, &b) } else { (&b, &a) };
    short.iter().all(|w| long.contains(w))
}

/// Does a typed name (the first letters of its words, in either script) point at this company? Every distinctive word of the query is the start of one
/// of the name's words, both folded the same way («proka» finds «ПРОКАБ» МЧЖ).
pub fn name_matches_query(name: &str, query: &str) -> bool {
    let (n, q) = (distinctive(name), distinctive(query));
    !q.is_empty() && !n.is_empty() && q.iter().all(|w| n.iter().any(|x| x.starts_with(w.as_str())))
}

/// the company's side of a case
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Side {
    /// "plaintiff" | "defendant" | "" (not known)
    pub role: &'static str,
    /// the OTHER party's name
    pub counterparty: String,
}

/// The side from the names alone. Both matching, or neither, is «not known» (the person sees both parties as they are).
pub fn side_by_name(company: &str, plaintiff: &str, defendant: &str) -> Side {
    match (same_party(company, plaintiff), same_party(company, defendant)) {
        (true, false) => Side { role: "plaintiff", counterparty: defendant.trim().to_string() },
        (false, true) => Side { role: "defendant", counterparty: plaintiff.trim().to_string() },
        _ => Side::default(),
    }
}

/// The side from SEVERAL names of the same company (the one its bills spell, the one its cases use): the first name that settles it wins.
pub fn side_by_aliases(aliases: &[String], plaintiff: &str, defendant: &str) -> Side {
    for a in aliases {
        let s = side_by_name(a, plaintiff, defendant);
        if !s.role.is_empty() {
            return s;
        }
    }
    Side::default()
}

/// The side when the case detail names the parties' TINs: exact, and it wins over any name.
pub fn side_by_tin(tin: &str, plaintiff: &str, plaintiff_tin: &str, defendant: &str, defendant_tin: &str) -> Side {
    if !tin.is_empty() && plaintiff_tin == tin && defendant_tin != tin {
        return Side { role: "plaintiff", counterparty: defendant.trim().to_string() };
    }
    if !tin.is_empty() && defendant_tin == tin && plaintiff_tin != tin {
        return Side { role: "defendant", counterparty: plaintiff.trim().to_string() };
    }
    Side::default()
}

/// A company's name when no bill gave one: the name that is a party of (nearly) every one of its cases is the company itself (the list was found by its
/// TIN), so the most common party text across the rows, if it is in at least 60 % of them (and at least three), is it. `rows` = (plaintiff, defendant).
pub fn learn_name(rows: &[(String, String)]) -> Option<String> {
    if rows.len() < 3 {
        return None;
    }
    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for (p, d) in rows {
        for x in [p.trim(), d.trim()] {
            if !x.is_empty() && x != "-" {
                *counts.entry(x).or_default() += 1;
            }
        }
        // a case that names the same text twice counts once
        if p.trim() == d.trim() && !p.trim().is_empty() {
            *counts.entry(p.trim()).or_default() -= 1;
        }
    }
    let (name, n) = counts.into_iter().max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(a.0)))?;
    (n * 10 >= rows.len() * 6).then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_company_in_cyrillic_and_in_latin_with_other_spellings() {
        assert!(same_party("\"ANOR TEXTILE\" МЧЖ", "«АНОР ТЕКСТИЛЕ» масъулияти чекланган жамияти"));
        assert!(same_party("PROCAB MChJ", "«ПРОКАБ» МЧЖ")); // c/k
        assert!(same_party("XAMKOR MChJ", "ҲАМКОР МЧЖ")); // x/h
        assert!(same_party("ANOR", "ANOR TEXTILE MChJ")); // the shorter name is inside the longer
    }

    #[test]
    fn two_different_companies_of_the_same_legal_form_never_match() {
        assert!(!same_party("ANOR TEXTILE MChJ", "UNIVERSAL SAVDO MChJ"));
        assert!(!same_party("MChJ", "MChJ"), "a legal form alone is not a name");
        assert!(!same_party("", "ANOR"));
        assert!(!same_party("TOSHKENT SHAHAR SUV TA`MINOTI", "TOSHKENT SHAHAR ELEKTR TARMOQLARI"));
    }

    #[test]
    fn the_side_is_known_only_when_exactly_one_party_is_the_company() {
        let s = side_by_name("ANOR TEXTILE MChJ", "Универсал Савдо МЧЖ", "«ANOR TEXTILE» МЧЖ");
        assert_eq!((s.role, s.counterparty.as_str()), ("defendant", "Универсал Савдо МЧЖ"));
        let s = side_by_name("ANOR TEXTILE MChJ", "ANOR TEXTILE МЧЖ", "Boshqa MChJ");
        assert_eq!((s.role, s.counterparty.as_str()), ("plaintiff", "Boshqa MChJ"));
        assert_eq!(side_by_name("ANOR TEXTILE MChJ", "ANOR TEXTILE", "ANOR TEXTILE MChJ").role, ""); // both: not known
        assert_eq!(side_by_name("ANOR TEXTILE MChJ", "A MChJ", "B MChJ").role, ""); // neither
        assert_eq!(side_by_name("", "A", "B").role, ""); // no name
    }

    #[test]
    fn several_names_of_one_company_the_first_that_settles_it_wins() {
        let names = vec!["Капиталбанк филиали Термиз".to_string(), "«КАПИТАЛ БАНК» АТБ".to_string()];
        let s = side_by_aliases(&names, "Боshqa МЧЖ", "«КАПИТАЛ БАНК» АТБ");
        assert_eq!((s.role, s.counterparty.as_str()), ("defendant", "Боshqa МЧЖ"));
        assert_eq!(side_by_aliases(&[], "A", "B").role, "");
    }

    #[test]
    fn a_tin_in_the_detail_decides_and_beats_the_name() {
        let s = side_by_tin("207275139", "Universal", "201234567", "ANOR", "207275139");
        assert_eq!((s.role, s.counterparty.as_str()), ("defendant", "Universal"));
        assert_eq!(side_by_tin("207275139", "A", "-", "B", "-").role, "");
        assert_eq!(side_by_tin("207275139", "A", "207275139", "B", "207275139").role, ""); // the same TIN on both sides: not known
        assert_eq!(side_by_tin("", "A", "", "B", "").role, "");
    }

    #[test]
    fn a_typed_name_finds_the_company_in_either_script() {
        assert!(name_matches_query("«ПРОКАБ» МЧЖ", "proka"));
        assert!(name_matches_query("«ПРОКАБ» МЧЖ", "прокаб"));
        assert!(name_matches_query("ANOR TEXTILE MChJ", "anor tex"));
        assert!(!name_matches_query("ANOR TEXTILE MChJ", "mchj")); // a legal form alone finds nothing
        assert!(!name_matches_query("", "anor"));
        assert!(!name_matches_query("ANOR TEXTILE MChJ", "bank"));
    }

    #[test]
    fn a_name_is_learned_from_the_cases_when_no_bill_gave_one() {
        let r = |p: &str, d: &str| (p.to_string(), d.to_string());
        let rows = vec![r("Bank", "A"), r("Bank", "B"), r("C", "Bank"), r("Bank", "D"), r("E", "F")];
        assert_eq!(learn_name(&rows).as_deref(), Some("Bank")); // in 4 of 5 cases
        assert_eq!(learn_name(&[r("A", "B"), r("C", "D"), r("E", "F")]), None); // nobody is in most of them
        assert_eq!(learn_name(&[r("Bank", "A"), r("Bank", "B")]), None); // too few cases to say
    }
}
