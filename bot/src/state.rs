//! The bot's shared state: settings, where files come from, where replies go, the opened manifest, the in-memory locator, the bucket cache and the
//! per-person rate limiter. `sync` brings the locator up to date; `service.rs` answers questions from it.

use crate::backup::{fetch_bucket, open_pinned, BackupError, BucketCache, Opened, Pinned, CACHE_BYTES};
use crate::config::Config;
use crate::crypto::{BucketRef, Key, Manifest};
use crate::domain::Info;
use crate::index::Index;
use crate::ratelimit::RateLimiter;
use crate::telegram::{Outbox, Source, Tg};
use std::{collections::HashMap, sync::{Arc, Mutex}};
use tokio::sync::RwLock;

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
    /// failed syncs in a row (the bot keeps answering from what it has)
    pub failures: u32,
    /// the channel the data was read from (index into `cfg.channels`), and why the ones before it were not used
    pub channel: usize,
    pub degraded: Option<String>,
}

pub struct Shared {
    pub cfg: Config,
    pub source: Source,
    pub outbox: Outbox,
    pub st: RwLock<State>,
    pub cache: Mutex<BucketCache>,
    /// at most one download of a given bucket at a time (a Mini App screen asks for the same bucket several times at once)
    pub inflight: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    pub limiter: RateLimiter,
}

pub fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

impl Shared {
    /// the real thing: Telegram is both the source and the outbox
    pub fn new(cfg: Config) -> Arc<Shared> {
        let source = Source::Telegram(Tg::new(&cfg.api_base, &cfg.token));
        let outbox = Outbox::Telegram(Tg::new(&cfg.api_base, &cfg.token));
        Shared::with(cfg, source, outbox)
    }

    pub fn with(cfg: Config, source: Source, outbox: Outbox) -> Arc<Shared> {
        let limiter = RateLimiter::new(cfg.rate_per_minute);
        Arc::new(Shared { cfg, source, outbox, st: RwLock::new(State::default()), cache: Mutex::new(BucketCache::default()), inflight: Mutex::new(HashMap::new()), limiter })
    }

    /// Read the pinned manifest and bring the locator up to date: only the index buckets whose id changed are downloaded. Cheap when nothing changed.
    /// The main channel is tried first, then each mirror in order: a banned channel, a deleted manifest message or a deleted piece moves the bot to the
    /// next channel (and `/health` says so). A wrong passphrase stops at once: it is wrong for every channel.
    pub async fn sync(&self) -> Result<String, BackupError> {
        let mut errs: Vec<String> = Vec::new();
        let mut last: Option<BackupError> = None;
        for (i, chat) in self.cfg.channels.iter().enumerate() {
            match self.sync_from(i, chat).await {
                Ok(msg) => {
                    self.st.write().await.degraded = if i == 0 { None } else { Some(errs.join(" · ")) };
                    return Ok(if i == 0 || msg == "oʻzgarmagan" { msg } else { format!("zaxira kanaldan ({chat}): {msg}") });
                }
                Err(BackupError::WrongPassphrase) => return Err(BackupError::WrongPassphrase),
                Err(e) => {
                    errs.push(format!("{chat}: {e}"));
                    last = Some(e);
                }
            }
        }
        Err(match last {
            Some(e) if self.cfg.channels.len() == 1 => e,
            _ => BackupError::Source(errs.join(" · ")),
        })
    }

    async fn sync_from(&self, channel: usize, chat: &str) -> Result<String, BackupError> {
        let (known_pin, known) = {
            let s = self.st.read().await;
            // «unchanged» only means something against the channel the data came from
            (if s.ready && s.channel == channel { Some(s.pin_file_id.clone()) } else { None }, s.key.map(|k| (s.salt.clone(), k)))
        };
        let opened = match open_pinned(&self.source, chat, &self.cfg.pass, known, known_pin.as_deref()).await? {
            Pinned::Unchanged => return Ok("oʻzgarmagan".into()),
            Pinned::Opened(o) => o,
        };
        let Opened { manifest: m, key, salt, pin_file_id } = opened;

        let mut fresh: Vec<(String, String, String)> = Vec::new();
        let mut alive = Vec::new();
        for b in m.buckets.iter().filter(|b| b.name.starts_with("index:")) {
            let tin = b.name["index:".len()..].to_string();
            alive.push(tin.clone());
            // a shard of the same id is the same bytes, whichever channel it came from (the id is a keyed hash of the content)
            if self.st.read().await.index.shard_id(&tin) == Some(b.id.as_str()) {
                continue;
            }
            let text = fetch_bucket(&self.source, &key, b).await.map_err(BackupError::Source)?;
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
        s.pin_file_id = pin_file_id;
        s.channel = channel;
        s.ready = true;
        s.error = None;
        s.failures = 0;
        s.synced_at = now();
        Ok(format!("zaxira {created}: {downloaded} ta indeks boʻlagi yuklandi, {} yozuv", s.index.rows()))
    }

    /// A bucket the current channel cannot give (its piece was deleted, the channel is banned): the same bucket from the next channel that can.
    /// The mirror has its own manifest and key, so this reads its pinned manifest afresh (about a second); it only happens when something is wrong.
    async fn from_mirrors(&self, name: &str) -> Option<Vec<u8>> {
        let current = self.st.read().await.channel;
        for (i, chat) in self.cfg.channels.iter().enumerate() {
            if i == current {
                continue;
            }
            let Ok(Pinned::Opened(o)) = open_pinned(&self.source, chat, &self.cfg.pass, None, None).await else { continue };
            let Some(b) = o.manifest.buckets.iter().find(|b| b.name == name) else { continue };
            if let Ok(text) = fetch_bucket(&self.source, &o.key, b).await {
                return Some(text);
            }
        }
        None
    }

    /// The text of a bucket by name: from the cache, or downloaded once (concurrent askers wait for the same download). `None` = the backup has no such bucket.
    pub async fn bucket_text(&self, name: &str) -> Result<Option<Arc<Vec<u8>>>, String> {
        let (b, key): (Option<BucketRef>, Key) = {
            let s = self.st.read().await;
            let (Some(m), Some(key)) = (&s.manifest, s.key) else { return Err("Zaxira hali yuklanmagan".into()) };
            (m.buckets.iter().find(|b| b.name == name).cloned(), key)
        };
        let Some(b) = b else { return Ok(None) };
        if let Some(hit) = self.cache.lock().unwrap().get(&b.id) {
            return Ok(Some(hit));
        }
        let gate = self.inflight.lock().unwrap().entry(b.id.clone()).or_default().clone();
        let _turn = gate.lock().await;
        // somebody else may have downloaded it while this call waited for its turn
        if let Some(hit) = self.cache.lock().unwrap().get(&b.id) {
            return Ok(Some(hit));
        }
        let text = match fetch_bucket(&self.source, &key, &b).await {
            Ok(t) => Arc::new(t),
            Err(e) => Arc::new(self.from_mirrors(name).await.ok_or(e)?),
        };
        self.cache.lock().unwrap().insert(&b.id, text.clone(), CACHE_BYTES);
        self.inflight.lock().unwrap().remove(&b.id);
        Ok(Some(text))
    }

    pub async fn info(&self) -> Info {
        let s = self.st.read().await;
        Info {
            ready: s.ready,
            error: s.error.clone(),
            indexed: s.index.rows(),
            companies: s.index.tins().len(),
            backup_at: s.manifest.as_ref().map(|m| m.created.clone()),
            synced_at: s.synced_at,
            failures: s.failures,
            channel: s.channel,
            channels: self.cfg.channels.len(),
            degraded: s.degraded.clone(),
        }
    }
}
