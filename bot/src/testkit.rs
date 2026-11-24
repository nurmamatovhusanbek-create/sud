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
