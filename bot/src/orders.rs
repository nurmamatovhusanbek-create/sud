//! Court orders in the bot («Qarorlar»): the decisions the operator downloaded in the app (public.sud.uz) travel in the backup as `orders:<yy>` records and
//! `pdf:<id>` files. The bot never goes to public.sud.uz (its firewall refuses scripts); it only reads what the backup holds, and sends a PDF to the
//! chat by opening its piece in memory, so nothing is written to the host's disk.
//!
//! A line of `orders:<yy>`: `[id, case number, instance, result, court, judge, category, pdf id, file name, size, court type, saved at (ms)]`; saved at 0 =
//! the order is known but its PDF was never downloaded (it has no `pdf:<id>` file). A line `["k", case number, checked at (ms)]` says the case was checked and
//! nothing was published. Older backups hold downloaded orders only (saved at above 0).

use crate::format::esc;
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct Order {
    pub id: String,
    pub case: String,
    pub instance: String,
    pub result: String,
    pub court: String,
    pub judge: String,
    pub category: String,
    pub pdf_id: String,
    pub pdf_name: String,
    pub size: u64,
    /// the PDF is in the backup (`pdf:<id>`); false = found, not downloaded
    pub saved: bool,
    /// ECONOMIC | CIVIL | ADMINISTRATIVE | CRIMINAL, as the app stored it
    pub court_type: String,
    /// when the PDF was saved on the computer (ms); 0 = not downloaded
    pub saved_at: i64,
}

fn text(v: &[Value], i: usize) -> String {
    v.get(i).and_then(Value::as_str).unwrap_or("").to_string()
}

/// the orders of one `orders:<yy>` bucket (a damaged line is skipped)
pub fn parse(bytes: &[u8]) -> Vec<Order> {
    let rows: Vec<Vec<Value>> = String::from_utf8_lossy(bytes).lines().filter_map(|l| serde_json::from_str::<Vec<Value>>(l).ok()).collect();
    // tombstones: ["x", pdf id, when, case]: an order the app removed because its file can never be downloaded; it is in no list any more
    let gone: std::collections::HashSet<String> = rows.iter().filter(|r| r.first().and_then(Value::as_str) == Some("x") && r.get(4).and_then(Value::as_i64) != Some(1)).filter_map(|r| r.get(1).and_then(Value::as_str)).map(str::to_lowercase).collect();
    rows.into_iter()
        .filter_map(|r| {
            let o = Order { id: text(&r, 0), case: text(&r, 1), instance: text(&r, 2), result: text(&r, 3), court: text(&r, 4), judge: text(&r, 5), category: text(&r, 6), pdf_id: text(&r, 7), pdf_name: text(&r, 8), size: r.get(9).and_then(Value::as_u64).unwrap_or(0), saved: r.get(11).and_then(Value::as_i64).unwrap_or(1) > 0, court_type: text(&r, 10), saved_at: r.get(11).and_then(Value::as_i64).unwrap_or(0).max(0) };
            (!o.id.is_empty() && is_pdf_id(&o.pdf_id) && !o.case.is_empty() && !gone.contains(&o.pdf_id.to_lowercase())).then_some(o)
        })
        .collect()
}

/// the cases of an `orders:<yy>` bucket that were checked and have no order: case number → when it was checked (ms)
pub fn parse_checks(bytes: &[u8]) -> Vec<(String, i64)> {
    String::from_utf8_lossy(bytes)
        .lines()
        .filter_map(|l| serde_json::from_str::<Vec<Value>>(l).ok())
        .filter(|r| r.first().and_then(Value::as_str) == Some("k"))
        .filter_map(|r| Some((r.get(1)?.as_str()?.to_string(), r.get(2)?.as_i64()?)))
        .collect()
}

/// an order file's id as the app writes it (a uuid, or `old-<court>-<key>`): the only shapes that may name a bucket
pub fn is_pdf_id(s: &str) -> bool {
    (4..=80).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// the registration year (two digits) of a case number: «2-1004-2603/8020» → 26; None when the number does not say
pub fn year_of(case: &str) -> Option<u32> {
    let mut it = case.split('-');
    let (a, b, c) = (it.next()?, it.next()?, it.next()?);
    if !a.bytes().all(|x| x.is_ascii_digit()) || !b.bytes().all(|x| x.is_ascii_digit()) || a.is_empty() || b.is_empty() {
        return None;
    }
    let ym = c.split('/').next()?;
    (ym.len() == 4 && ym.bytes().all(|x| x.is_ascii_digit())).then(|| ym[..2].parse().ok()).flatten()
}

/// cases compare case- and space-insensitively
pub fn norm(case: &str) -> String {
    case.split_whitespace().collect::<String>().to_uppercase()
}

pub fn instance_word(i: &str) -> &str {
    match i.to_uppercase().as_str() {
        "FIRST" => "Birinchi instansiya",
        "APPEAL" => "Apellyatsiya",
        "CASSATION" => "Kassatsiya",
        "CASSATION_REPEATED" => "Takroriy kassatsiya",
        "INSPECTION" | "SUPERVISION" => "Taftish",
        _ => "Qaror",
    }
}

pub fn instance_rank(i: &str) -> u8 {
    match i.to_uppercase().as_str() {
        "FIRST" => 0,
        "APPEAL" => 1,
        "CASSATION" => 2,
        "CASSATION_REPEATED" => 3,
        "INSPECTION" | "SUPERVISION" => 4,
        _ => 5,
    }
}

/// the court's decision, in words; an unknown value is put together word by word (never shown in English)
pub fn result_word(r: &str) -> String {
    match r.to_uppercase().as_str() {
        "FULFILLED" => "qanoatlantirildi".into(),
        "PARTIALLY_FULFILLED" => "qisman qanoatlantirildi".into(),
        "REFUSED" => "rad etildi".into(),
        "RETURNED" => "qaytarildi".into(),
        "UNCONSIDERED" => "koʻrmasdan qoldirildi".into(),
        "CASE_ENDED" => "tugatildi".into(),
        "CASSATION_UNCHANGED" => "kassatsiya: oʻzgarishsiz qoldirildi".into(),
        "APPEAL_UNCHANGED" => "apellyatsiya: oʻzgarishsiz qoldirildi".into(),
        "JOINED_TO_OTHER_CASE" => "boshqa ish bilan birlashtirildi".into(),
        "" => String::new(),
        other => {
            let words: Vec<String> = other
                .to_lowercase()
                .split('_')
                .filter(|w| !w.is_empty())
                .map(|w| match w {
                    "cassation" => "kassatsiya",
                    "appeal" => "apellyatsiya",
                    "unchanged" => "oʻzgarishsiz",
                    "changed" => "oʻzgartirildi",
                    "cancelled" | "canceled" => "bekor qilindi",
                    "joined" => "birlashtirildi",
                    "other" => "boshqa",
                    "case" => "ish",
                    "partially" => "qisman",
                    "ended" => "tugatildi",
                    "returned" => "qaytarildi",
                    "refused" | "rejected" | "dismissed" => "rad etildi",
                    "accepted" | "approved" | "satisfied" => "qabul qilindi",
                    "terminated" | "stopped" => "tugatildi",
                    "left" | "without" => "",
                    "fulfilled" => "qanoatlantirildi",
                    "to" | "of" | "the" => "",
                    x => x,
                }.to_string())
                .filter(|w| !w.is_empty())
                .collect();
            words.join(" ")
        }
    }
}

/// an order as the Mini App reads it (camelCase, the words already in Uzbek)
pub fn to_json(o: &Order) -> Value {
    json!({
        "id": o.id, "caseNumber": o.case, "instance": o.instance, "instanceWord": instance_word(&o.instance), "result": o.result, "resultWord": result_word(&o.result),
        "court": o.court, "judge": o.judge, "category": o.category, "courtType": o.court_type.to_lowercase(), "pdfId": o.pdf_id, "name": file_name(o),
        "size": o.size, "sizeLabel": size_label(o.size), "saved": o.saved, "savedAt": o.saved_at,
    })
}

/// what the Qarorlar tab filters by
#[derive(Debug, Default, Clone)]
pub struct Query {
    /// a case number (any part), or a word of the court, the judge or the category
    pub q: String,
    /// economic | civil | administrative | criminal
    pub court: String,
    /// qanoatlantirildi … : the result enum (`FULFILLED`) as stored, case-insensitive
    pub result: String,
    /// Some(true) = downloaded only, Some(false) = not downloaded only
    pub saved: Option<bool>,
    /// the case's registration year, two digits
    pub year: Option<u32>,
    /// first | appeal | cassation | …: the instance enum as stored, case-insensitive
    pub instance: String,
    /// only orders of these cases (normalised numbers): one company's cases
    pub cases: Option<std::collections::HashSet<String>>,
}

impl Query {
    pub fn matches(&self, o: &Order) -> bool {
        if !self.court.is_empty() && !o.court_type.eq_ignore_ascii_case(&self.court) {
            return false;
        }
        if !self.result.is_empty() && !o.result.eq_ignore_ascii_case(&self.result) {
            return false;
        }
        if !self.instance.is_empty() && !o.instance.eq_ignore_ascii_case(&self.instance) {
            return false;
        }
        if self.cases.as_ref().is_some_and(|c| !c.contains(&norm(&o.case))) {
            return false;
        }
        if self.saved.is_some_and(|s| s != o.saved) || self.year.is_some_and(|y| year_of(&o.case) != Some(y)) {
            return false;
        }
        let q = self.q.trim().to_lowercase();
        q.is_empty() || o.case.to_lowercase().contains(&q) || crate::translit::to_latin(&format!("{} {} {}", o.court, o.judge, o.category)).to_lowercase().contains(&crate::translit::to_latin(&q).to_lowercase())
    }
}

/// the line for a case with no order: checked (when) or never checked
pub fn none_text(title: &str, checked_ms: Option<i64>) -> String {
    match checked_ms {
        Some(ms) => format!("📄 {title}: <b>qaror eʼlon qilinmagan</b>\n<i>Ilova {} da tekshirgan. Sud qarorni keyinroq eʼlon qilishi mumkin.</i>", crate::chat::dmy_ms(ms)),
        None => format!("📄 {title}: qaror maʼlumoti yoʻq.\n<i>Ish hali tekshirilmagan yoki qarorlar ilovada yuklanmagan. Ilovada ishning «Qarorlar» tugmasini bosing, soʻng zaxira oling.</i>"),
    }
}

/// «412 KB», «1,3 MB»
pub fn size_label(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / 1_048_576.0).replace('.', ",")
    } else {
        format!("{} KB", (bytes / 1024).max(1))
    }
}

/// a company's orders: the newest case number first, and inside a case its instances in their natural order
pub fn newest_case_first(mut v: Vec<Order>) -> Vec<Order> {
    v.sort_by(|a, b| b.case.cmp(&a.case).then(instance_rank(&a.instance).cmp(&instance_rank(&b.instance))).then(a.id.cmp(&b.id)));
    v
}

/// the same case's orders, first instance first
pub fn sorted(mut v: Vec<Order>) -> Vec<Order> {
    v.sort_by(|a, b| a.case.cmp(&b.case).then(instance_rank(&a.instance).cmp(&instance_rank(&b.instance))).then(a.id.cmp(&b.id)));
    v
}

fn line(o: &Order, label: &str, with_case: bool) -> String {
    let mut out = String::new();
    if with_case {
        out.push_str(&format!("<code>{}</code>\n", esc(&o.case)));
    }
    let r = result_word(&o.result);
    out.push_str(&format!("<b>{}</b>{}\n", esc(label), if r.is_empty() { String::new() } else { format!(" · {}", esc(&r)) }));
    let who = [o.court.as_str(), o.judge.as_str()].iter().filter(|s| !s.is_empty()).map(|s| esc(s)).collect::<Vec<_>>().join(" · ");
    if !who.is_empty() {
        out.push_str(&format!("{who}\n"));
    }
    if !o.category.is_empty() {
        out.push_str(&format!("<i>{}</i>\n", esc(&o.category)));
    }
    if !o.saved {
        out.push_str("⏳ <i>PDF hali yuklanmagan</i>\n");
    }
    out
}

/// the message for a case (`title` = the case number) or a company's list; at most `max` orders are listed
pub fn list_text(title: &str, orders: &[Order], with_case: bool, max: usize) -> String {
    let saved = orders.iter().filter(|o| o.saved).count();
    let mut out = if saved == orders.len() {
        format!("📄 <b>Qarorlar</b> · {title}\n<b>{}</b> ta yuklangan\n", orders.len())
    } else {
        format!("📄 <b>Qarorlar</b> · {title}\n<b>{}</b> ta qaror: {} ta yuklangan, {} ta yuklanmagan\n", orders.len(), saved, orders.len() - saved)
    };
    for (i, o) in orders.iter().enumerate().take(max) {
        out.push('\n');
        out.push_str(&line(o, &label_of(orders, i), with_case));
    }
    if orders.len() > max {
        out.push_str(&format!("\n…yana <b>{}</b> ta. Aniq ishni yozing: <code>/orders ish raqami</code>\n", orders.len() - max));
    }
    out
}

/// «Apellyatsiya», or «Apellyatsiya 2» when the same case has several orders of that instance (the order within its case and instance, 1-based)
fn label_of(orders: &[Order], at: usize) -> String {
    let o = &orders[at];
    let same = |x: &&Order| x.case == o.case && instance_rank(&x.instance) == instance_rank(&o.instance);
    let total = orders.iter().filter(same).count();
    if total < 2 {
        return instance_word(&o.instance).to_string();
    }
    let n = orders[..=at].iter().filter(same).count();
    format!("{} {n}", instance_word(&o.instance))
}

/// one button per order (at most `max`): its PDF, or «Yuklash» (ask the app to download it) when the PDF was never downloaded. A case has one order per
/// instance (first, appeal, cassation, …), sometimes several in one instance.
pub fn keyboard(orders: &[Order], max: usize) -> Value {
    let rows: Vec<Value> = (0..orders.len().min(max))
        .map(|i| {
            let o = &orders[i];
            if !o.saved {
                let label = if orders.iter().any(|x| x.case != o.case) { format!("⬇️ {} · {} · yuklash", o.case, label_of(orders, i)) } else { format!("⬇️ {} · yuklash", label_of(orders, i)) };
                return json!([{ "text": label, "callback_data": format!("d:{}", o.pdf_id) }]);
            }
            let label = if orders.iter().any(|x| x.case != o.case) { format!("📄 {} · {}", o.case, label_of(orders, i)) } else { format!("📄 {} · {}", label_of(orders, i), size_label(o.size)) };
            json!([{ "text": label, "callback_data": format!("o:{}", o.pdf_id) }])
        })
        .collect();
    json!({ "inline_keyboard": rows })
}

/// the file name the person gets: under the CASE NUMBER («2-1004-2603-8020-Birinchi instansiya.pdf»), never the court's own name (a uuid-like or Russian
/// scan name tells nothing); no case number → the court's name, else «qaror»; always ends in `.pdf`, no path or quote characters
pub fn file_name(o: &Order) -> String {
    let case = o.case.trim().replace('/', "-");
    let base = if !case.is_empty() { format!("{case}-{}", instance_word(&o.instance)) } else if !o.pdf_name.trim().is_empty() { o.pdf_name.trim().to_string() } else { "qaror".to_string() };
    let clean: String = base.chars().map(|c| if c.is_control() || matches!(c, '"' | '\\' | '/' | ':' | '*' | '?' | '<' | '>' | '|') { '_' } else { c }).collect();
    let clean = clean.trim().to_string();
    if clean.to_lowercase().ends_with(".pdf") { clean } else { format!("{clean}.pdf") }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn o(id: &str, case: &str, inst: &str, result: &str) -> Order {
        Order { id: id.into(), case: case.into(), instance: inst.into(), result: result.into(), court: "Andijon iqtisodiy sudi".into(), judge: "J. J.".into(), category: "Qarz".into(), pdf_id: format!("pdf-{id}"), pdf_name: "qaror.pdf".into(), size: 412 * 1024, saved: true, court_type: "ECONOMIC".into(), saved_at: 1 }
    }

    #[test]
    fn lines_parse_and_a_damaged_or_unsafe_one_is_dropped() {
        let ok = r#"["o1","2-1004-2603/8020","FIRST","FULFILLED","Sud","J","Qarz","11111111-2222-3333-4444-555555555555","qaror.pdf",421888,"ECONOMIC",1700000000000]"#;
        let text = format!("{ok}\nnot json\n[\"x\"]\n[\"o2\",\"2-1004-2603/8021\",\"FIRST\",\"\",\"\",\"\",\"\",\"../etc\",\"\",1,\"\",0]\n");
        let v = parse(text.as_bytes());
        assert_eq!(v.len(), 1, "{v:?}");
        assert_eq!((v[0].case.as_str(), v[0].size, v[0].pdf_id.as_str()), ("2-1004-2603/8020", 421888, "11111111-2222-3333-4444-555555555555"));
        assert!(is_pdf_id("old-civil-123") && !is_pdf_id("a/b") && !is_pdf_id("..") && !is_pdf_id("a:b") && !is_pdf_id(""));
    }

    #[test]
    fn the_year_comes_from_the_number_as_the_app_computes_it() {
        assert_eq!(year_of("2-1004-2603/8020"), Some(26));
        assert_eq!(year_of("4-1001-2218/44965"), Some(22));
        assert_eq!(year_of("5-2001-2102/901"), Some(21));
        for bad in ["", "abc", "2-1004/8020", "2-1004-26/1", "x-1004-2603/1", "2-1004-26a3/1"] {
            assert_eq!(year_of(bad), None, "{bad}");
        }
        assert_eq!(norm(" 2-1004-2603 / 8020 "), "2-1004-2603/8020");
    }

    #[test]
    fn words_and_sizes() {
        assert_eq!(instance_word("FIRST"), "Birinchi instansiya");
        assert_eq!(instance_word("inspection"), "Taftish");
        assert_eq!(instance_word("???"), "Qaror");
        assert_eq!(result_word("PARTIALLY_FULFILLED"), "qisman qanoatlantirildi");
        assert_eq!(result_word("CASSATION_REJECTED"), "kassatsiya rad etildi");
        assert_eq!(result_word("REJECTED"), "rad etildi");
        assert_eq!(result_word("SOMETHING_ODD"), "something odd", "an unknown word is left as it is");
        assert_eq!(result_word("CASSATION_UNCHANGED"), "kassatsiya: oʻzgarishsiz qoldirildi");
        assert_eq!(result_word("JOINED_TO_OTHER_CASE"), "boshqa ish bilan birlashtirildi");
        assert_eq!(result_word("CASSATION_CANCELLED"), "kassatsiya bekor qilindi");
        assert_eq!(result_word(""), "");
        assert_eq!(size_label(412 * 1024), "412 KB");
        assert_eq!(size_label(10), "1 KB");
        assert_eq!(size_label(1_500_000), "1,4 MB");
    }

    #[test]
    fn the_list_names_instance_result_and_court_and_the_buttons_open_the_pdfs() {
        let v = sorted(vec![o("b", "2-1004-2603/8020", "APPEAL", "REFUSED"), o("a", "2-1004-2603/8020", "FIRST", "FULFILLED")]);
        assert_eq!(v[0].instance, "FIRST", "first instance first");
        let t = list_text("<code>2-1004-2603/8020</code>", &v, false, 10);
        assert!(t.contains("<b>2</b> ta yuklangan") && t.contains("<b>Birinchi instansiya</b> · qanoatlantirildi") && t.contains("<b>Apellyatsiya</b> · rad etildi") && t.contains("Andijon iqtisodiy sudi · J. J."), "{t}");
        let k = keyboard(&v, 10).to_string();
        assert!(k.contains("o:pdf-a") && k.contains("o:pdf-b") && k.contains("412 KB"), "{k}");
        for r in keyboard(&v, 10)["inline_keyboard"].as_array().unwrap() {
            assert!(r[0]["callback_data"].as_str().unwrap().len() <= 64);
        }
        // a long list is cut and says so; a name cannot break the message
        let many: Vec<Order> = (0..15).map(|i| o(&format!("{i:02}"), &format!("2-1004-2603/{i}"), "FIRST", "FULFILLED")).collect();
        let t = list_text("x", &many, true, 10);
        assert!(t.contains("yana <b>5</b> ta") && t.len() < 3900, "{}", t.len());
        let mut evil = o("e", "2-1004-2603/1", "FIRST", "FULFILLED");
        evil.court = "A & B <b>".into();
        assert!(list_text("x", &[evil], false, 10).contains("A &amp; B &lt;b&gt;"));
    }

    #[test]
    fn one_case_keeps_every_instance_and_several_orders_of_one_instance_are_told_apart() {
        // the same case number: first instance, two appeal orders, a cassation: four orders, four PDFs, none overwrites another
        let v = sorted(vec![
            o("d", "2-1004-2603/8020", "CASSATION", "REFUSED"),
            o("b", "2-1004-2603/8020", "APPEAL", "REFUSED"),
            o("c", "2-1004-2603/8020", "APPEAL", "FULFILLED"),
            o("a", "2-1004-2603/8020", "FIRST", "FULFILLED"),
            o("z", "2-1004-2603/8021", "FIRST", "FULFILLED"),
        ]);
        let mine: Vec<Order> = v.iter().filter(|x| x.case == "2-1004-2603/8020").cloned().collect();
        assert_eq!(mine.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["a", "b", "c", "d"]);
        let k = keyboard(&mine, 10);
        let labels: Vec<String> = k["inline_keyboard"].as_array().unwrap().iter().map(|r| r[0]["text"].as_str().unwrap().to_string()).collect();
        assert_eq!(labels, vec!["📄 Birinchi instansiya · 412 KB", "📄 Apellyatsiya 1 · 412 KB", "📄 Apellyatsiya 2 · 412 KB", "📄 Kassatsiya · 412 KB"]);
        let ids: Vec<&str> = k["inline_keyboard"].as_array().unwrap().iter().map(|r| r[0]["callback_data"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["o:pdf-a", "o:pdf-b", "o:pdf-c", "o:pdf-d"]);
        // a list over several cases names the case on each button, and each case keeps its own numbering
        let both = keyboard(&v, 10).to_string();
        assert!(both.contains("2-1004-2603/8021 · Birinchi instansiya") && both.contains("2-1004-2603/8020 · Apellyatsiya 2"), "{both}");
        let t = list_text("x", &mine, false, 10);
        assert!(t.contains("<b>Apellyatsiya 1</b> · rad etildi") && t.contains("<b>Apellyatsiya 2</b> · qanoatlantirildi"), "{t}");
    }

    #[test]
    fn the_file_name_is_the_case_number() {
        let mut x = o("a", "2-1004-2603/8020", "FIRST", "");
        // the court's own name is not used: the file is named after the case
        assert_eq!(file_name(&x), "2-1004-2603-8020-Birinchi instansiya.pdf");
        x.pdf_name = "  ../a\"b\\c.PDF ".into();
        assert_eq!(file_name(&x), "2-1004-2603-8020-Birinchi instansiya.pdf");
        x.instance = "APPEAL".into();
        assert_eq!(file_name(&x), "2-1004-2603-8020-Apellyatsiya.pdf");
        // no case number: the court's name (made safe), else «qaror»
        x.case = String::new();
        assert!(file_name(&x).ends_with(".PDF") && !file_name(&x).contains('/') && !file_name(&x).contains('"') && !file_name(&x).contains('\\'), "{}", file_name(&x));
        x.pdf_name = "noext".into();
        assert_eq!(file_name(&x), "noext.pdf");
        x.pdf_name = String::new();
        assert_eq!(file_name(&x), "qaror.pdf");
        // a case number with odd characters is made safe too
        x.case = "2-1/2:3*".into();
        assert!(!file_name(&x).contains(['/', ':', '*']));
    }
}
