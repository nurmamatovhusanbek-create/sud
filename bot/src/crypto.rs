//! The backup's cryptography, byte-compatible with `src/lib/backup-crypto.ts` of the app: AES-256-GCM with a key from the passphrase (scrypt,
//! N=2^15, r=8, p=1), pieces laid out as `iv(12) | tag(16) | ciphertext`, a keyed bucket id (HMAC-SHA-256 under a sub-key). A test opens a
//! fixture that the app's own code produced, so a change on either side that breaks compatibility fails here.

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;

type HmacSha256 = Hmac<Sha256>;

const MAGIC: &[u8] = b"SUDB1";
const SALT: usize = 16;
const IV: usize = 12;
const TAG: usize = 16;

pub type Key = [u8; 32];

pub fn derive_key(pass: &str, salt: &[u8]) -> Result<Key, String> {
    let params = scrypt::Params::new(15, 8, 1, 32).map_err(|e| e.to_string())?;
    let norm: String = pass.nfkc().collect();
    let mut out = [0u8; 32];
    scrypt::scrypt(norm.as_bytes(), salt, &params, &mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

/// `iv | tag | ciphertext` → plain text, or None when the key is wrong or a byte changed
pub fn open(key: &Key, blob: &[u8], aad: &str) -> Option<Vec<u8>> {
    if blob.len() < IV + TAG {
        return None;
    }
    let (iv, rest) = blob.split_at(IV);
    let (tag, ct) = rest.split_at(TAG);
    let mut joined = Vec::with_capacity(ct.len() + TAG);
    joined.extend_from_slice(ct);
    joined.extend_from_slice(tag);
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    cipher.decrypt(Nonce::from_slice(iv), Payload { msg: &joined, aad: aad.as_bytes() }).ok()
}

pub fn bucket_id(key: &Key, plain: &[u8]) -> String {
    let mut m = <HmacSha256 as Mac>::new_from_slice(key).expect("hmac key");
    m.update(b"sud-bucket-id");
    let sub = m.finalize().into_bytes();
    let mut m2 = <HmacSha256 as Mac>::new_from_slice(&sub).expect("hmac key");
    m2.update(plain);
    hex::encode(m2.finalize().into_bytes())
}

pub fn sha256_hex(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

pub fn bucket_aad(id: &str, part: usize) -> String {
    format!("bucket:{id}:{part}")
}

/// plain → `iv | tag | ciphertext` (tests only: the bot never writes a backup; the iv is a counter, unique per process)
#[cfg(test)]
pub fn seal(key: &Key, plain: &[u8], aad: &str) -> Vec<u8> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(1);
    let mut iv = [0u8; IV];
    iv[4..].copy_from_slice(&N.fetch_add(1, Ordering::SeqCst).to_be_bytes());
    let cipher = Aes256Gcm::new_from_slice(key).expect("key");
    let ct_tag = cipher.encrypt(Nonce::from_slice(&iv), Payload { msg: plain, aad: aad.as_bytes() }).expect("seal");
    let (ct, tag) = ct_tag.split_at(ct_tag.len() - TAG);
    let mut out = Vec::with_capacity(IV + TAG + ct.len());
    out.extend_from_slice(&iv);
    out.extend_from_slice(tag);
    out.extend_from_slice(ct);
    out
}

/// the manifest as the app writes it: `MAGIC | salt | seal(json, "manifest")` (tests only)
#[cfg(test)]
pub fn seal_manifest(key: &Key, salt: &[u8], json: &[u8]) -> Vec<u8> {
    let mut out = MAGIC.to_vec();
    out.extend_from_slice(salt);
    out.extend(seal(key, json, "manifest"));
    out
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartRef {
    pub file_id: String,
    pub size: usize,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketRef {
    pub name: String,
    pub id: String,
    #[serde(default)]
    pub rows: usize,
    pub parts: Vec<PartRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyDates {
    #[serde(default)]
    pub first_at: i64,
    #[serde(default)]
    pub refreshed_at: i64,
    /// the company's name as its own bills spell it (absent in older backups and for a company no bill names)
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub v: u8,
    #[allow(dead_code)]
    pub id: String,
    pub created: String,
    #[serde(default)]
    pub companies: HashMap<String, CompanyDates>,
    #[serde(default)]
    pub buckets: Vec<BucketRef>,
}

#[derive(Debug, PartialEq)]
pub enum ManifestError {
    NotBackup,
    WrongPassphrase,
    OldFormat,
}

/// the sealed manifest: `MAGIC | salt | iv | tag | ciphertext(JSON)`. Returns the manifest, the key and the salt (the key is reused while the salt is the same).
pub fn open_manifest(pass: &str, blob: &[u8], known: Option<(&[u8], Key)>) -> Result<(Manifest, Key, Vec<u8>), ManifestError> {
    if blob.len() < MAGIC.len() + SALT + IV + TAG || &blob[..MAGIC.len()] != MAGIC {
        return Err(ManifestError::NotBackup);
    }
    let salt = &blob[MAGIC.len()..MAGIC.len() + SALT];
    let key = match known {
        Some((s, k)) if s == salt => k,
        _ => derive_key(pass, salt).map_err(|_| ManifestError::WrongPassphrase)?,
    };
    let plain = open(&key, &blob[MAGIC.len() + SALT..], "manifest").ok_or(ManifestError::WrongPassphrase)?;
    let m: Manifest = serde_json::from_slice(&plain).map_err(|_| ManifestError::NotBackup)?;
    if m.v != 2 {
        return Err(ManifestError::OldFormat);
    }
    Ok((m, key, salt.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    /// produced by the app's own TypeScript code (`bun bot/tests/make-fixture.ts`)
    const FIXTURE: &str = include_str!("../tests/fixtures/compat.json");

    fn fx() -> serde_json::Value {
        serde_json::from_str(FIXTURE).unwrap()
    }
    fn b64(v: &serde_json::Value, k: &str) -> Vec<u8> {
        base64::engine::general_purpose::STANDARD.decode(v[k].as_str().unwrap()).unwrap()
    }

    #[test]
    fn opens_a_manifest_sealed_by_the_app() {
        let f = fx();
        let (m, _key, salt) = open_manifest(f["passphrase"].as_str().unwrap(), &b64(&f, "manifest"), None).unwrap();
        assert_eq!(m.id, "fixture-id");
        assert_eq!(m.buckets.len(), 1);
        assert_eq!(m.buckets[0].name, "index:207324986");
        assert_eq!(hex::encode(salt), f["salt"].as_str().unwrap());
    }

    #[test]
    fn wrong_passphrase_and_foreign_files_are_told_apart() {
        let f = fx();
        assert_eq!(open_manifest("another long pass", &b64(&f, "manifest"), None).unwrap_err(), ManifestError::WrongPassphrase);
        assert_eq!(open_manifest("x", b"not a backup at all, just some text bytes", None).unwrap_err(), ManifestError::NotBackup);
    }

    #[test]
    fn opens_a_piece_and_matches_the_bucket_id_the_app_computed() {
        let f = fx();
        let (m, key, _) = open_manifest(f["passphrase"].as_str().unwrap(), &b64(&f, "manifest"), None).unwrap();
        let b = &m.buckets[0];
        let sealed = b64(&f, "piece");
        assert_eq!(sha256_hex(&sealed), b.parts[0].sha256);
        let gz = open(&key, &sealed, &bucket_aad(&b.id, 0)).expect("piece opens");
        assert_eq!(bucket_id(&key, f["plain"].as_str().unwrap().as_bytes()), b.id);
        let mut text = String::new();
        std::io::Read::read_to_string(&mut flate2::read::GzDecoder::new(&gz[..]), &mut text).unwrap();
        assert_eq!(text, f["plain"].as_str().unwrap());
        // a piece moved to another place does not open
        assert!(open(&key, &sealed, &bucket_aad(&b.id, 1)).is_none());
    }
}
