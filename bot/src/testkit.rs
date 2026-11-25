//! Test support: builds a whole encrypted backup (sealed manifest v2 + buckets) in memory, exactly as the app lays it out, so the sync, the service,
//! the HTTP router and the chat handlers are tested against the real format without Telegram.

use crate::config::Config;
use crate::crypto::{bucket_aad, bucket_id, derive_key, seal, seal_manifest, sha256_hex, Key};
use crate::state::Shared;
use crate::telegram::{MemoryChannel, Outbox, Source};
use base64::Engine;
use serde_json::{json, Value};
use std::io::Write;
use std::sync::{Arc, Mutex, OnceLock};

pub const TIN: &str = "207275139";
pub const OTHER_TIN: &str = "207324986";
pub const CASE: &str = "2-1004-2503/8020";
pub const BILL: &str = "260880770031";

pub const MAIN: &str = "-100123";
pub const MIRROR: &str = "-100456";

/// every channel is its own chain with its own salt (so its own key and bucket ids), as a second backup chain really is
fn salt_of(chat: &str) -> [u8; 16] {
    [if chat == MAIN { 7 } else { 9 }; 16]
}

fn key(pass: &str, chat: &str) -> Key {
    static K: OnceLock<Mutex<std::collections::HashMap<(String, [u8; 16]), Key>>> = OnceLock::new();
    let salt = salt_of(chat);
    *K.get_or_init(Default::default).lock().unwrap().entry((pass.to_string(), salt)).or_insert_with(|| derive_key(pass, &salt).unwrap())
}

fn gz(b: &[u8]) -> Vec<u8> {
    let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    e.write_all(b).unwrap();
    e.finish().unwrap()
}

fn lines(rows: &[Value]) -> String {
    rows.iter().map(|r| format!("{r}\n")).collect()
}

/// a bill row in the app's column order (only the columns the bot reads are filled)
pub fn bill_row(tin: &str, number: &str, issued: i64, amount: i64, case: &str) -> Value {
    json!([tin, number, "Тўланган", issued, amount, amount, amount, 0, 0, "Почта", "", "Court", "", "civil", case, "", "", "Payer", "000000000"])
}

/// the whole backup of the fixture: which buckets exist, by name → plain text
pub fn buckets(extra_case: bool) -> Vec<(String, String)> {
    let detail = base64::engine::general_purpose::STANDARD.encode(gz(json!({
        "general": { "caseStatus": "Якунланган", "plaintiff": "Daʼvogar MCHJ", "defendant": "-", "court": "Toshkent sudi" },
        "firstInstance": { "hearings": [{ "date": "01.04.2025", "time": "10:00", "status": "Oʻtkazilgan" }], "decision": { "date": "02.04.2025", "text": "Daʼvo qanoatlantirilsin" } }
    }).to_string().as_bytes()));
    let mut index = vec![json!(["c", CASE, "civil", 25]), json!(["c", "2-1004-2503/8021", "civil", 25]), json!(["c", "2-0001-2401/5", "economic", 24]), json!(["b", BILL, 2025, CASE])];
    if extra_case {
        index.push(json!(["c", "2-1004-2603/1", "civil", 26]));
    }
    let bills25 = vec![bill_row(TIN, BILL, 1_774_827_370_376, 206_000_000, CASE), bill_row(TIN, "260880770032", 1_774_000_000_000, 100_000, "2-1004-2503/8021")];
    // hearings relative to today: today, tomorrow, in five days, in forty days, and one that has passed
    let t = crate::date::today(crate::state::now());
    let hearing = |num: &str, day: u32, time: &str| json!([num, "civil", day, time, "first", "Тайинлаш", "Универсал МЧЖ", "ANOR МЧЖ", 1]);
    let hearings = vec![hearing(CASE, t, "10:00"), hearing("2-1004-2503/8021", crate::date::add_days(t, 1), "09:30"), hearing("2-0001-2401/5", crate::date::add_days(t, 5), "14:00"), hearing("2-1004-2603/1", crate::date::add_days(t, 40), "11:00"), hearing("2-1004-2603/2", crate::date::add_days(t, -3), "11:00")];
    vec![
        (format!("hearings:{TIN}"), lines(&hearings)),
        (format!("index:{TIN}"), lines(&index)),
        (format!("bills:{TIN}:2025"), lines(&bills25)),
        (format!("details:civil:25"), lines(&[json!(["x", CASE, "x", detail])])),
        (format!("found:{TIN}:civil:25"), lines(&[json!(["x", "x", "2-1004-2503/8021", "x", "x", "x", json!({ "caseStatus": "Ijroda", "plaintiff": "Boshqa MCHJ" }).to_string()])])),
        (format!("index:{OTHER_TIN}"), lines(&[json!(["c", "2-1503-2503/5802", "civil", 25])])),
    ]
}

/// the id of the file that holds a bucket's single piece in `chat`'s channel (to damage or delete it in a test)
pub fn piece_file_id(chat: &str, pass: &str, text: &str) -> String {
    format!("F{chat}-{}", bucket_id(&key(pass, chat), text.as_bytes()))
}

pub const PDF_FIRST: &str = "11111111-1111-1111-1111-111111111111";
pub const PDF_APPEAL: &str = "22222222-2222-2222-2222-222222222222";
pub const PDF_APPEAL2: &str = "33333333-3333-3333-3333-333333333333";
pub const PDF_OTHER_CASE: &str = "44444444-4444-4444-4444-444444444444";
pub const PDF_OTHER_COMPANY: &str = "55555555-5555-5555-5555-555555555555";
pub const PDF_MIXED: &str = "66666666-6666-6666-6666-666666666666";
pub const MIXED_CASE: &str = "2-1004-2503/8022"; // a saved first instance and an appeal that was found but never downloaded
pub const UNSAVED_CASE: &str = "2-1004-2503/8024"; // found, nothing downloaded
pub const CHECKED_CASE: &str = "2-1004-2503/8023"; // checked: nothing published
pub const CHECKED_AT: i64 = 1_774_000_000_000;
pub fn pdf_text(id: &str) -> String {
    format!("%PDF-1.4\n% fake order {id}\n%%EOF")
}

/// the downloaded court orders of the fixture, as the app writes them: ONE case (`CASE`) with an order in each of its instances (and two in the appeal),
/// another case of the same company, and a case of the other company
pub fn orders_buckets() -> Vec<(String, String)> {
    let order = |id: &str, case: &str, inst: &str, result: &str, pdf: &str, name: &str| json!([id, case, inst, result, "Andijon tumanlararo iqtisodiy sudi", "J. J.", "Qarz", pdf, name, pdf_text(pdf).len(), "ECONOMIC", 1_774_000_000_000i64]);
    let rows = vec![
        order("o-first", CASE, "FIRST", "FULFILLED", PDF_FIRST, "birinchi.pdf"),
        order("o-appeal", CASE, "APPEAL", "REFUSED", PDF_APPEAL, "apellyatsiya.pdf"),
        order("o-appeal2", CASE, "APPEAL", "FULFILLED", PDF_APPEAL2, "apellyatsiya-2.pdf"),
        order("o-other", "2-1004-2503/8021", "FIRST", "RETURNED", PDF_OTHER_CASE, "boshqa.pdf"),
        order("o-co2", "2-1503-2503/5802", "FIRST", "CASE_ENDED", PDF_OTHER_COMPANY, "ikkinchi.pdf"),
        order("o-mixed1", MIXED_CASE, "FIRST", "FULFILLED", PDF_MIXED, "aralash.pdf"),
        // found, never downloaded: saved at 0 (no `pdf:` bucket exists for it)
        json!(["o-mixed2", MIXED_CASE, "APPEAL", "REFUSED", "Andijon viloyat sudi", "K. K.", "Qarz", "77777777-7777-7777-7777-777777777777", "", 5000, "ECONOMIC", 0]),
        json!(["o-unsaved", UNSAVED_CASE, "FIRST", "FULFILLED", "Andijon tumanlararo iqtisodiy sudi", "J. J.", "Qarz", "88888888-8888-8888-8888-888888888888", "", 5000, "ECONOMIC", 0]),
        json!(["k", CHECKED_CASE, CHECKED_AT]),
    ];
    let mut out = vec![("orders:25".to_string(), lines(&rows))];
    for id in [PDF_FIRST, PDF_APPEAL, PDF_APPEAL2, PDF_OTHER_CASE, PDF_OTHER_COMPANY, PDF_MIXED] {
        out.push((format!("pdf:{id}"), pdf_text(id)));
    }
    out
}

pub struct Backup {
    pub channel: Arc<MemoryChannel>,
    pub pass: String,
}

/// seal `buckets` and the manifest into a channel and pin the manifest (message id and file id change with `version`)
pub fn publish(channel: &Arc<MemoryChannel>, chat: &str, pass: &str, version: u32, content: &[(String, String)]) {
    publish_named(channel, chat, pass, version, content, Some("«ANOR» МЧЖ"))
}

/// the same, with the name of the first company in the manifest (None: the backup does not know it)
pub fn publish_named(channel: &Arc<MemoryChannel>, chat: &str, pass: &str, version: u32, content: &[(String, String)], name: Option<&str>) {
    let k = key(pass, chat);
    let mut bs = Vec::new();
    for (name, text) in content {
        let id = bucket_id(&k, text.as_bytes());
        let piece = seal(&k, &gz(text.as_bytes()), &bucket_aad(&id, 0));
        let file_id = format!("F{chat}-{id}");
        channel.put(chat, &file_id, piece.clone());
        bs.push(json!({ "name": name, "id": id, "rows": text.lines().count(), "bytes": text.len(), "parts": [{ "fileId": file_id, "messageId": 1, "size": piece.len(), "sha256": sha256_hex(&piece) }] }));
    }
    let m = json!({ "v": 2, "id": format!("m{version}"), "created": "2026-11-22T10:00:00.000Z", "app": "sud-tizimi", "prev": null,
        "companies": { TIN: { "firstAt": 1_774_000_000_000i64, "refreshedAt": 1_774_827_370_376i64, "name": name }, OTHER_TIN: { "firstAt": 1, "refreshedAt": 2 } }, "buckets": bs });
    let file_id = format!("MANIFEST{chat}-{version}");
    channel.put(chat, &file_id, seal_manifest(&k, &salt_of(chat), m.to_string().as_bytes()));
    channel.pin(chat, version as i64, &file_id);
}

pub fn backup() -> Backup {
    let cfg = Config::for_tests();
    let channel = Arc::new(MemoryChannel::default());
    publish(&channel, MAIN, &cfg.pass, 1, &buckets(false));
    Backup { channel, pass: cfg.pass }
}

/// the same backup in the main channel and in a mirror (each its own chain), and a config that lists both
pub fn mirrored() -> (Backup, Config) {
    let b = backup();
    publish(&b.channel, MIRROR, &b.pass, 1, &buckets(false));
    let mut cfg = Config::for_tests();
    cfg.channels = vec![MAIN.into(), MIRROR.into()];
    (b, cfg)
}

pub fn bot_with(cfg: Config, b: &Backup) -> Arc<Shared> {
    Shared::with(cfg, Source::Memory(b.channel.clone()), Outbox::Capture(Default::default()))
}

/// a bot over an in-memory channel and a capturing outbox, not yet synced
pub fn bot(b: &Backup) -> Arc<Shared> {
    Shared::with(Config::for_tests(), Source::Memory(b.channel.clone()), Outbox::Capture(Default::default()))
}

/// a bot that has already read the backup
pub async fn ready_bot() -> (Arc<Shared>, Backup) {
    let b = backup();
    let sh = bot(&b);
    sh.sync().await.expect("sync");
    (sh, b)
}

/// signed launch data for `user`, as Telegram's client would send it
pub fn init_data(token: &str, user: i64, auth_date: i64) -> String {
    use hmac::{Hmac, Mac};
    let user_json = json!({ "id": user, "first_name": "T" }).to_string();
    let mut pairs = vec![("auth_date".to_string(), auth_date.to_string()), ("user".to_string(), user_json)];
    pairs.sort();
    let check = pairs.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("\n");
    let mut secret = <Hmac<sha2::Sha256> as Mac>::new_from_slice(b"WebAppData").unwrap();
    secret.update(token.as_bytes());
    let key = secret.finalize().into_bytes();
    let mut mac = <Hmac<sha2::Sha256> as Mac>::new_from_slice(&key).unwrap();
    mac.update(check.as_bytes());
    let hash = hex::encode(mac.finalize().into_bytes());
    let mut s = form_urlencoded::Serializer::new(String::new());
    for (k, v) in &pairs {
        s.append_pair(k, v);
    }
    s.append_pair("hash", &hash);
    s.finish()
}

/// a details bucket with one case whose general part is `general` (so a test can put TINs in it)
pub fn detail_bucket(num: &str, general: Value) -> (String, String) {
    let detail = base64::engine::general_purpose::STANDARD.encode(gz(json!({ "general": general }).to_string().as_bytes()));
    ("details:civil:25".to_string(), lines(&[json!(["x", num, "x", detail])]))
}
