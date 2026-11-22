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

const SALT: [u8; 16] = [7; 16];

fn key(pass: &str) -> Key {
    static K: OnceLock<Key> = OnceLock::new();
    *K.get_or_init(|| derive_key(pass, &SALT).unwrap())
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
    vec![
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
pub fn publish(channel: &Arc<MemoryChannel>, pass: &str, version: u32, content: &[(String, String)]) {
    let k = key(pass);
    let mut bs = Vec::new();
    for (name, text) in content {
        let id = bucket_id(&k, text.as_bytes());
        let piece = seal(&k, &gz(text.as_bytes()), &bucket_aad(&id, 0));
        let file_id = format!("F-{id}");
        channel.put(&file_id, piece.clone());
        bs.push(json!({ "name": name, "id": id, "rows": text.lines().count(), "bytes": text.len(), "parts": [{ "fileId": file_id, "messageId": 1, "size": piece.len(), "sha256": sha256_hex(&piece) }] }));
    }
    let m = json!({ "v": 2, "id": format!("m{version}"), "created": "2026-11-22T10:00:00.000Z", "app": "sud-tizimi", "prev": null,
        "companies": { TIN: { "firstAt": 1_774_000_000_000i64, "refreshedAt": 1_774_827_370_376i64 }, OTHER_TIN: { "firstAt": 1, "refreshedAt": 2 } }, "buckets": bs });
    let file_id = format!("MANIFEST-{version}");
    channel.put(&file_id, seal_manifest(&k, &SALT, m.to_string().as_bytes()));
    channel.pin(version as i64, &file_id);
}

pub fn backup() -> Backup {
    let cfg = Config::for_tests();
    let channel = Arc::new(MemoryChannel::default());
    publish(&channel, &cfg.pass, 1, &buckets(false));
    Backup { channel, pass: cfg.pass }
}

/// a bot over an in-memory channel and a capturing outbox, not yet synced
pub fn bot(b: &Backup) -> Arc<Shared> {
    Shared::with(Config::for_tests(), Source::Memory(b.channel.clone()), Outbox::Capture(Mutex::new(Vec::new())))
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
