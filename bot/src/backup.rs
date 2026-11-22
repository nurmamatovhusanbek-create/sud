//! Reading the encrypted backup: the pinned manifest, and buckets (downloaded, hash-checked, opened, unpacked, id-verified) with a size-capped cache.
//! Nothing here knows about HTTP or chat.

use crate::crypto::{bucket_aad, bucket_id, open, open_manifest, sha256_hex, BucketRef, Key, Manifest, ManifestError};
use crate::telegram::Source;
use std::{collections::{HashMap, VecDeque}, io::Read, sync::Arc};

pub const CACHE_BYTES: usize = 120 * 1024 * 1024;

#[derive(Debug, PartialEq)]
pub enum BackupError {
    NoPinned,
    WrongPassphrase,
    NotBackup,
    OldFormat,
    Source(String),
}

impl std::fmt::Display for BackupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BackupError::NoPinned => write!(f, "Kanalda mahkamlangan zaxira manifesti yoʻq"),
            BackupError::WrongPassphrase => write!(f, "Parol notoʻgʻri (yoki manifest shikastlangan)"),
            BackupError::NotBackup => write!(f, "Mahkamlangan fayl Sud tizimi zaxirasi emas"),
            BackupError::OldFormat => write!(f, "Zaxira eski formatda: ilovada yangi zaxira oling"),
            BackupError::Source(m) => write!(f, "{m}"),
        }
    }
}

pub struct Opened {
    pub manifest: Manifest,
    pub key: Key,
    pub salt: Vec<u8>,
    pub pin_file_id: String,
}

pub enum Pinned {
    /// the pinned manifest is the one already read
    Unchanged,
    Opened(Opened),
}

/// Read the manifest pinned in the channel. `known` = the salt and key of the manifest read before (a manifest of the same chain needs no second scrypt).
pub async fn open_pinned(source: &Source, chat: &str, pass: &str, known: Option<(Vec<u8>, Key)>, current_pin: Option<&str>) -> Result<Pinned, BackupError> {
    let (_, file_id) = source.pinned_document(chat).await.map_err(BackupError::Source)?.ok_or(BackupError::NoPinned)?;
    if current_pin == Some(file_id.as_str()) {
        return Ok(Pinned::Unchanged);
    }
    let blob = source.file_bytes(&file_id).await.map_err(BackupError::Source)?;
    let (manifest, key, salt) = open_manifest(pass, &blob, known.as_ref().map(|(s, k)| (s.as_slice(), *k))).map_err(|e| match e {
        ManifestError::WrongPassphrase => BackupError::WrongPassphrase,
        ManifestError::NotBackup => BackupError::NotBackup,
        ManifestError::OldFormat => BackupError::OldFormat,
    })?;
    Ok(Pinned::Opened(Opened { manifest, key, salt, pin_file_id: file_id }))
}

fn gunzip(b: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(b).read_to_end(&mut out).map_err(|_| "Siqilgan boʻlak ochilmadi".to_string())?;
    Ok(out)
}

/// Download, check, open and unpack one bucket. Each piece is checked against its hash and its authentication tag, the whole against its keyed id.
pub async fn fetch_bucket(source: &Source, key: &Key, b: &BucketRef) -> Result<Vec<u8>, String> {
    let mut gz = Vec::new();
    for (i, p) in b.parts.iter().enumerate() {
        let f = source.file_bytes(&p.file_id).await?;
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

/// Opened buckets kept in memory up to a byte cap, oldest out first.
#[derive(Default)]
pub struct BucketCache {
    map: HashMap<String, Arc<Vec<u8>>>,
    order: VecDeque<String>,
    bytes: usize,
}

impl BucketCache {
    pub fn get(&self, id: &str) -> Option<Arc<Vec<u8>>> {
        self.map.get(id).cloned()
    }

    pub fn insert(&mut self, id: &str, text: Arc<Vec<u8>>, cap: usize) {
        if self.map.contains_key(id) {
            return;
        }
        self.bytes += text.len();
        self.map.insert(id.to_string(), text);
        self.order.push_back(id.to_string());
        while self.bytes > cap && self.order.len() > 1 {
            if let Some(old) = self.order.pop_front() {
                if let Some(t) = self.map.remove(&old) {
                    self.bytes -= t.len();
                }
            }
        }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.map.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cache_forgets_the_oldest_first_and_keeps_the_newest() {
        let mut c = BucketCache::default();
        c.insert("a", Arc::new(vec![0; 60]), 100);
        c.insert("b", Arc::new(vec![0; 60]), 100);
        assert!(c.get("a").is_none(), "the oldest went to make room");
        assert!(c.get("b").is_some());
        // one piece bigger than the cap is still kept (it is the one being used)
        c.insert("big", Arc::new(vec![0; 500]), 100);
        assert!(c.get("big").is_some());
        assert_eq!(c.len(), 1);
    }
}
