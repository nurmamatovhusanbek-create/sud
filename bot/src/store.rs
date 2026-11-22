//! The bot's state: the opened manifest, the in-memory locator, and the buckets fetched on demand (downloaded from Telegram, hash-checked, opened,
//! cached up to a size cap). Everything the bot answers comes from the encrypted backup in the operator's own channel.

use crate::config::Config;
use crate::crypto::{bucket_aad, bucket_id, open, open_manifest, sha256_hex, BucketRef, Key, Manifest, ManifestError};
use crate::index::{is_case_like, Hit, Index};
use crate::tg::Tg;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

const CACHE_BYTES: usize = 120 * 1024 * 1024;

#[derive(Default)]
pub struct State {
    pub ready: bool,
    pub error: Option<String>,
    pub manifest: Option<Manifest>,
    pub key: Option<Key>,
    pub salt: Vec<u8>,
    pub pin_file_id: String,
    pub index: Index,
    pub synced_at: i64,
}

#[derive(Default)]
struct Cache {
    map: HashMap<String, Arc<Vec<u8>>>,
    order: VecDeque<String>,
    bytes: usize,
}

pub struct Shared {
    pub cfg: Config,
    pub tg: Tg,
    pub st: RwLock<State>,
    cache: Mutex<Cache>,
}

pub fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn gunzip(b: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(b).read_to_end(&mut out).map_err(|_| "Siqilgan boʻlak ochilmadi".to_string())?;
    Ok(out)
}

/// download, check, open and unpack one bucket
async fn fetch_bucket(tg: &Tg, key: &Key, b: &BucketRef) -> Result<Vec<u8>, String> {
    let mut gz = Vec::new();
    for (i, p) in b.parts.iter().enumerate() {
        let f = tg.file_bytes(&p.file_id).await?;
        if f.len() != p.size || sha256_hex(&f) != p.sha256 {
            return Err("Boʻlak shikastlangan (hash mos kelmadi)".into());
        }
        gz.extend(open(key, &f, &bucket_aad(&b.id, i)).ok_or("Boʻlakni ochib boʻlmadi")?);
    }
    let text = gunzip(&gz)?;
    if bucket_id(key, &text) != b.id {
        return Err("Boʻlak mazmuni id ga mos kelmadi".into());
    }
    Ok(text)
}

impl Shared {
    pub fn new(cfg: Config) -> Arc<Shared> {
        let tg = Tg::new(&cfg.api_base, &cfg.token);
        Arc::new(Shared { cfg, tg, st: RwLock::new(State::default()), cache: Mutex::new(Cache::default()) })
    }

    /// Read the pinned manifest and bring the locator up to date (only the index buckets whose id changed are downloaded). Cheap when nothing changed.
    pub async fn sync(&self) -> Result<String, String> {
        let (known_pin, known) = {
            let s = self.st.read().await;
            (s.pin_file_id.clone(), s.key.map(|k| (s.salt.clone(), k)))
        };
        let Some((_, file_id)) = self.tg.pinned_document(&self.cfg.chat).await? else {
            return Err("Kanalda mahkamlangan zaxira manifesti yoʻq".into());
        };
        if file_id == known_pin && self.st.read().await.ready {
            return Ok("oʻzgarmagan".into());
        }
        let blob = self.tg.file_bytes(&file_id).await?;
        let (m, key, salt) = open_manifest(&self.cfg.pass, &blob, known.as_ref().map(|(s, k)| (s.as_slice(), *k))).map_err(|e| match e {
            ManifestError::WrongPassphrase => "Parol notoʻgʻri (yoki manifest shikastlangan)".to_string(),
            ManifestError::NotBackup => "Mahkamlangan fayl Sud tizimi zaxirasi emas".to_string(),
            ManifestError::OldFormat => "Zaxira eski formatda: ilovada yangi zaxira oling".to_string(),
        })?;

        let mut fresh: Vec<(String, String, String)> = Vec::new();
        let mut alive = Vec::new();
        for b in m.buckets.iter().filter(|b| b.name.starts_with("index:")) {
            let tin = b.name["index:".len()..].to_string();
            alive.push(tin.clone());
            if self.st.read().await.index.shard_id(&tin) == Some(b.id.as_str()) {
                continue;
            }
            let text = fetch_bucket(&self.tg, &key, b).await?;
            fresh.push((tin, b.id.clone(), String::from_utf8_lossy(&text).into_owned()));
        }
        let downloaded = fresh.len();
        let mut s = self.st.write().await;
        for (tin, id, text) in fresh {
            s.index.replace(&tin, &id, &text);
        }
        for tin in s.index.tins() {
            if !alive.contains(&tin) {
                s.index.remove(&tin);
            }
        }
        let created = m.created.clone();
        s.manifest = Some(m);
        s.key = Some(key);
        s.salt = salt;
        s.pin_file_id = file_id;
        s.ready = true;
        s.error = None;
        s.synced_at = now();
        Ok(format!("zaxira {created}: {downloaded} ta indeks boʻlagi yuklandi, {} yozuv", s.index.rows()))
    }

    /// the text of a bucket by name (cached)
    pub async fn bucket_text(&self, name: &str) -> Result<Option<Arc<Vec<u8>>>, String> {
        let (b, key) = {
            let s = self.st.read().await;
            let (Some(m), Some(key)) = (&s.manifest, s.key) else { return Err("Zaxira hali yuklanmagan".into()) };
            (m.buckets.iter().find(|b| b.name == name).cloned(), key)
        };
        let Some(b) = b else { return Ok(None) };
        if let Some(hit) = self.cache.lock().unwrap().map.get(&b.id) {
            return Ok(Some(hit.clone()));
        }
        let text = Arc::new(fetch_bucket(&self.tg, &key, &b).await?);
        let mut c = self.cache.lock().unwrap();
        c.bytes += text.len();
        c.map.insert(b.id.clone(), text.clone());
        c.order.push_back(b.id.clone());
        while c.bytes > CACHE_BYTES && c.order.len() > 1 {
            if let Some(old) = c.order.pop_front() {
                if let Some(t) = c.map.remove(&old) {
                    c.bytes -= t.len();
                }
            }
        }
        Ok(Some(text))
    }

    pub async fn info(&self) -> Value {
        let s = self.st.read().await;
        json!({
            "ready": s.ready,
            "error": s.error,
            "indexed": s.index.rows(),
            "companies": s.index.tins().len(),
            "backupAt": s.manifest.as_ref().map(|m| m.created.clone()),
            "syncedAt": s.synced_at,
        })
    }

    /// the company's numbers from the manifest: dates, bills and found cases
    pub async fn company(&self, tin: &str) -> Option<Value> {
        let s = self.st.read().await;
        let m = s.manifest.as_ref()?;
        let (mut bills, mut found, mut years) = (0usize, 0usize, Vec::new());
        let mut known = false;
        for b in &m.buckets {
            let p: Vec<&str> = b.name.split(':').collect();
            if p.get(1) != Some(&tin) {
                continue;
            }
            known = true;
            match p[0] {
                "bills" => {
                    bills += b.rows;
                    if let Some(y) = p.get(2) {
                        years.push(y.to_string());
                    }
                }
                "found" => found += b.rows,
                _ => {}
            }
        }
        if !known && !m.companies.contains_key(tin) {
            return None;
        }
        let d = m.companies.get(tin);
        Some(json!({ "tin": tin, "bills": bills, "found": found, "years": years, "firstAt": d.map(|d| d.first_at).unwrap_or(0), "refreshedAt": d.map(|d| d.refreshed_at).unwrap_or(0) }))
    }

    /// every company the backup holds (the Mini App's home screen)
    pub async fn companies(&self) -> Vec<Value> {
        let tins: std::collections::BTreeSet<String> = {
            let s = self.st.read().await;
            let mut set: std::collections::BTreeSet<String> = s.index.tins().into_iter().collect();
            if let Some(m) = &s.manifest {
                set.extend(m.companies.keys().cloned());
            }
            set
        };
        let mut out = Vec::new();
        for t in tins {
            if let Some(c) = self.company(&t).await {
                out.push(c);
            }
        }
        out.sort_by(|a, b| b["bills"].as_i64().cmp(&a["bills"].as_i64()));
        out
    }

    /// the search box: a STIR (company), a bill number or a case number, by prefix
    pub async fn search(&self, raw: &str, limit: usize) -> Vec<Value> {
        let q = raw.trim();
        let mut out: Vec<Value> = Vec::new();
        if q.len() < 3 || q.len() > 40 {
            return out;
        }
        let digits = q.chars().all(|c| c.is_ascii_digit());
        if digits && q.len() <= 9 {
            let mut tins: Vec<String> = {
                let s = self.st.read().await;
                // a company is known by its dates (manifest) or by its index bucket: a backup made before the dates existed has only the second
                let mut set: std::collections::BTreeSet<String> = s.index.tins().into_iter().collect();
                if let Some(m) = &s.manifest {
                    set.extend(m.companies.keys().cloned());
                }
                set.into_iter().filter(|t| t.starts_with(q)).collect()
            };
            tins.sort();
            for t in tins.into_iter().take(limit) {
                if let Some(c) = self.company(&t).await {
                    out.push(json!({ "kind": "company", "key": t, "tin": t, "bills": c["bills"], "found": c["found"], "refreshedAt": c["refreshedAt"] }));
                }
            }
        }
        let s = self.st.read().await;
        let mut hits: Vec<Hit> = Vec::new();
        if digits && q.len() >= 6 {
            hits.extend(s.index.search_bills(q, limit));
        }
        if is_case_like(q) {
            hits.extend(s.index.search_cases(q, limit));
        }
        out.extend(hits.into_iter().map(|h| serde_json::to_value(h).unwrap_or(Value::Null)));
        out.truncate(limit);
        out
    }

    /// One case: its stored detail (case_details), the row found by number, and its bills (the registration year and the years around it)
    pub async fn case_detail(&self, num: &str) -> Result<Value, String> {
        let entries = { self.st.read().await.index.case(num).cloned() }.ok_or("Bunday ish raqami zaxirada yoʻq")?;
        let e = entries.first().ok_or("Bunday ish raqami zaxirada yoʻq")?.clone();
        let mut detail = Value::Null;
        if let Some(t) = self.bucket_text(&format!("details:{}:{}", e.court, e.yy)).await? {
            for line in String::from_utf8_lossy(&t).lines() {
                if !line.contains(num) {
                    continue;
                }
                let Ok(r) = serde_json::from_str::<Vec<Value>>(line) else { continue };
                if r.get(1).and_then(|v| v.as_str()) == Some(num) {
                    if let Some(b64) = r.get(3).and_then(|v| v.as_str()) {
                        use base64::Engine;
                        if let Ok(gz) = base64::engine::general_purpose::STANDARD.decode(b64) {
                            if let Ok(j) = gunzip(&gz).and_then(|b| serde_json::from_slice::<Value>(&b).map_err(|_| "detail".to_string())) {
                                detail = j;
                            }
                        }
                    }
                    break;
                }
            }
        }
        let mut row = Value::Null;
        if let Some(t) = self.bucket_text(&format!("found:{}:{}:{}", e.tin, e.court, e.yy)).await? {
            for line in String::from_utf8_lossy(&t).lines() {
                if !line.contains(num) {
                    continue;
                }
                let Ok(r) = serde_json::from_str::<Vec<Value>>(line) else { continue };
                if r.get(2).and_then(|v| v.as_str()) == Some(num) {
                    if let Some(s) = r.get(6).and_then(|v| v.as_str()) {
                        row = serde_json::from_str(s).unwrap_or(Value::Null);
                    }
                    break;
                }
            }
        }
        let mut bills = Vec::new();
        for year in [2000 + e.yy, 2000 + e.yy + 1, 2000 + e.yy - 1] {
            if let Some(t) = self.bucket_text(&format!("bills:{}:{}", e.tin, year)).await? {
                for line in String::from_utf8_lossy(&t).lines() {
                    if !line.contains(num) {
                        continue;
                    }
                    if let Ok(r) = serde_json::from_str::<Vec<Value>>(line) {
                        if r.get(14).and_then(|v| v.as_str()) == Some(num) {
                            bills.push(bill_json(&r));
                        }
                    }
                }
            }
        }
        Ok(json!({ "num": num, "court": e.court, "tin": e.tin, "year": e.yy, "detail": detail, "row": row, "bills": bills, "companies": entries.iter().map(|x| x.tin.clone()).collect::<Vec<_>>() }))
    }

    /// A company's cases (from its locator), newest registration first, filtered by a text (part of the number) and a court type; one page
    pub async fn company_cases(&self, tin: &str, q: &str, court: &str, offset: usize, limit: usize) -> Value {
        let mut rows = { self.st.read().await.index.shard_cases(tin) };
        let mut courts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
        for r in &rows {
            *courts.entry(r.1.clone()).or_default() += 1;
        }
        let q = q.trim();
        rows.retain(|r| (court.is_empty() || r.1 == court) && (q.is_empty() || r.0.contains(q)));
        // newest first: registration year, then the running number
        let tail = |k: &str| k.rsplit('/').next().and_then(|n| n.parse::<u64>().ok()).unwrap_or(0);
        rows.sort_by(|a, b| b.2.cmp(&a.2).then(tail(&b.0).cmp(&tail(&a.0))).then(b.0.cmp(&a.0)));
        let total = rows.len();
        let page: Vec<Value> = rows.into_iter().skip(offset).take(limit).map(|r| json!({ "key": r.0, "court": r.1, "year": r.2 })).collect();
        json!({ "total": total, "rows": page, "courts": courts })
    }

    /// A company's bills of one year (a bucket), newest first, filtered by a text; one page
    pub async fn company_bills(&self, tin: &str, year: u32, q: &str, offset: usize, limit: usize) -> Result<Value, String> {
        let t = self.bucket_text(&format!("bills:{tin}:{year}")).await?.ok_or("Bu yil uchun kvitansiyalar zaxirada yoʻq")?;
        let q = q.trim().to_lowercase();
        let mut rows: Vec<(i64, Value)> = Vec::new();
        let (mut sum, mut paid) = (0i64, 0i64);
        for line in String::from_utf8_lossy(&t).lines() {
            if !q.is_empty() && !line.to_lowercase().contains(&q) {
                continue;
            }
            if let Ok(r) = serde_json::from_str::<Vec<Value>>(line) {
                sum += r.get(4).and_then(|v| v.as_i64()).unwrap_or(0);
                paid += r.get(5).and_then(|v| v.as_i64()).unwrap_or(0);
                rows.push((r.get(3).and_then(|v| v.as_i64()).unwrap_or(0), bill_json(&r)));
            }
        }
        rows.sort_by(|a, b| b.0.cmp(&a.0));
        let total = rows.len();
        let page: Vec<Value> = rows.into_iter().skip(offset).take(limit).map(|r| r.1).collect();
        Ok(json!({ "total": total, "rows": page, "sum": sum, "paid": paid }))
    }

    pub async fn bill_detail(&self, number: &str) -> Result<Value, String> {
        let e = { self.st.read().await.index.bill(number).cloned() }.ok_or("Bunday kvitansiya zaxirada yoʻq")?;
        let t = self.bucket_text(&format!("bills:{}:{}", e.tin, e.year)).await?.ok_or("Kvitansiya boʻlagi zaxirada yoʻq")?;
        for line in String::from_utf8_lossy(&t).lines() {
            if !line.contains(number) {
                continue;
            }
            if let Ok(r) = serde_json::from_str::<Vec<Value>>(line) {
                if r.get(1).and_then(|v| v.as_str()) == Some(number) {
                    return Ok(bill_json(&r));
                }
            }
        }
        Err("Kvitansiya topilmadi".into())
    }
}

/// a bill row (the app's column order) as an object
fn bill_json(r: &[Value]) -> Value {
    let g = |i: usize| r.get(i).cloned().unwrap_or(Value::Null);
    json!({ "tin": g(0), "number": g(1), "status": g(2), "issued": g(3), "amount": g(4), "paid": g(5), "mustPay": g(6), "balance": g(7), "overdue": g(8), "cat": g(9), "court": g(11), "courtType": g(13), "caseNumber": g(14), "payer": g(17), "payerTin": g(18) })
}
