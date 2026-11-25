//! The link between the bot and the operator's app (the computer that scrapes). Two small signed doors and one queue:
//!
//! * `POST /link/synced`: the app has just made a backup. The bot re-reads the manifest at once (instead of at its next 5-minute look) and tells the
//!   people whose `/refresh` that backup answered.
//! * `POST /link/pull`: the app asks for work. It gets the STIRs people asked to refresh with `/refresh`.
//!
//! The app always calls the bot (outbound), never the other way: the computer needs no open port. Each call is signed with a key derived from the bot
//! token (`HMAC-SHA256(token, "sud-link-v1")`): the same token is already on both sides, so there is no new secret to set. The signature covers the time,
//! the path and the body; a call more than two minutes old is refused. The queue lives in memory: a restart empties it, and a person simply asks again.

use crate::state::Shared;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;
use std::sync::Arc;

type HmacSha256 = Hmac<Sha256>;

/// a call older (or newer) than this many seconds is refused
pub const WINDOW_SECS: i64 = 120;
/// the app asks for work about every minute: silent for longer than this, the link counts as down
pub const ALIVE_SECS: i64 = 180;
/// a request nobody took within this long is dropped (the computer is off)
const UNTAKEN_SECS: i64 = 600;
/// a request taken but not finished within this long is dropped
const TAKEN_SECS: i64 = 1800;
/// a company just refreshed is not queued again for this long
const COOLDOWN_SECS: i64 = 300;
pub const QUEUE_MAX: usize = 20;
pub const PER_PERSON_MAX: usize = 3;

pub fn key(token: &str) -> Vec<u8> {
    let mut m = HmacSha256::new_from_slice(token.as_bytes()).expect("hmac takes any key length");
    m.update(b"sud-link-v1");
    m.finalize().into_bytes().to_vec()
}

#[cfg_attr(not(test), allow(dead_code))]
/// hex of HMAC(key, "<ts>\n<path>\n" + body)
pub fn sign(token: &str, ts: i64, path: &str, body: &[u8]) -> String {
    let mut m = HmacSha256::new_from_slice(&key(token)).expect("hmac takes any key length");
    m.update(format!("{ts}\n{path}\n").as_bytes());
    m.update(body);
    hex::encode(m.finalize().into_bytes())
}

pub fn verify(token: &str, ts: &str, sig: &str, path: &str, body: &[u8], now: i64) -> bool {
    let Ok(ts) = ts.trim().parse::<i64>() else { return false };
    if (now - ts).abs() > WINDOW_SECS {
        return false;
    }
    let Ok(sig) = hex::decode(sig.trim()) else { return false };
    let mut m = HmacSha256::new_from_slice(&key(token)).expect("hmac takes any key length");
    m.update(format!("{ts}\n{path}\n").as_bytes());
    m.update(body);
    m.verify_slice(&sig).is_ok()
}

/// what the app is asked to do: refresh a company, or download one order's PDF
#[derive(Debug, Clone, PartialEq)]
pub enum What {
    Company(String),
    /// an order that was found but whose PDF was never downloaded (`pdf_id` = the file id in the backup's record)
    Order { pdf_id: String, case: String, instance: String },
}

impl What {
    /// the identity for «already queued» and «done a moment ago»
    pub fn key(&self) -> String {
        match self {
            What::Company(t) => t.clone(),
            What::Order { pdf_id, .. } => format!("o:{pdf_id}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Job {
    pub id: u64,
    pub what: What,
    /// everyone who asked for this company (one run answers them all)
    pub chats: Vec<i64>,
    pub at: i64,
    pub taken_at: Option<i64>,
    /// set when the app reports the result; the message to the people goes out after the next sync
    pub result: Option<(bool, String)>,
}

#[derive(Default)]
pub struct Link {
    pub jobs: Vec<Job>,
    pub next_id: u64,
    /// when the app last asked for work (epoch seconds); 0 = never since this start
    pub last_seen: i64,
    /// company → when it was last reported done
    pub done_at: std::collections::HashMap<String, i64>,
}

pub enum Queued {
    New,
    /// already waiting: this person is added to the ones who will be told
    Joined,
    NotLinked,
    Full,
    TooMany,
    /// refreshed this many seconds ago
    Recent(i64),
}

impl Link {
    pub fn alive(&self, now: i64) -> bool {
        self.last_seen > 0 && now - self.last_seen <= ALIVE_SECS
    }

    pub fn ask(&mut self, what: What, chat: i64, now: i64) -> Queued {
        if !self.alive(now) {
            return Queued::NotLinked;
        }
        let key = what.key();
        if let Some(j) = self.jobs.iter_mut().find(|j| j.what.key() == key && j.result.is_none()) {
            if !j.chats.contains(&chat) {
                j.chats.push(chat);
            }
            return Queued::Joined;
        }
        if let Some(t) = self.done_at.get(&key) {
            if now - t < COOLDOWN_SECS {
                return Queued::Recent(now - t);
            }
        }
        if self.jobs.iter().filter(|j| j.chats.contains(&chat) && j.result.is_none()).count() >= PER_PERSON_MAX {
            return Queued::TooMany;
        }
        if self.jobs.len() >= QUEUE_MAX {
            return Queued::Full;
        }
        self.next_id += 1;
        self.jobs.push(Job { id: self.next_id, what, chats: vec![chat], at: now, taken_at: None, result: None });
        Queued::New
    }

    /// the app asks for work: what nobody has taken yet, now marked taken
    pub fn pull(&mut self, now: i64) -> Vec<(u64, What)> {
        self.last_seen = now;
        let mut out = Vec::new();
        for j in self.jobs.iter_mut().filter(|j| j.taken_at.is_none() && j.result.is_none()) {
            j.taken_at = Some(now);
            out.push((j.id, j.what.clone()));
        }
        out
    }

    pub fn finish(&mut self, id: u64, ok: bool, note: &str, now: i64) {
        if let Some(j) = self.jobs.iter_mut().find(|j| j.id == id && j.result.is_none()) {
            j.result = Some((ok, note.chars().take(300).collect()));
            if ok {
                self.done_at.insert(j.what.key(), now);
            }
        }
    }

    /// requests that gave up waiting become failed results (so the people are told), and the cooldown list forgets old entries
    pub fn expire(&mut self, now: i64) {
        for j in self.jobs.iter_mut().filter(|j| j.result.is_none()) {
            match j.taken_at {
                None if now - j.at > UNTAKEN_SECS => j.result = Some((false, "Ilova javob bermadi (kompyuter oʻchiq yoki ulanish yoqilmagan).".into())),
                Some(t) if now - t > TAKEN_SECS => j.result = Some((false, "Ilova vaqtida tugata olmadi.".into())),
                _ => {}
            }
        }
        self.done_at.retain(|_, t| now - *t < COOLDOWN_SECS);
    }

    /// results waiting to be told, removed from the queue
    pub fn take_results(&mut self) -> Vec<Job> {
        let (done, keep): (Vec<Job>, Vec<Job>) = std::mem::take(&mut self.jobs).into_iter().partition(|j| j.result.is_some());
        self.jobs = keep;
        done
    }
}

#[derive(Deserialize)]
pub struct Done {
    pub id: u64,
    pub ok: bool,
    #[serde(default)]
    pub note: String,
}

#[derive(Deserialize, Default)]
pub struct SyncedBody {
    #[serde(default)]
    pub done: Vec<Done>,
}

/// the message to the people who asked, after the bot has (tried to) read the new backup
pub async fn deliver(sh: &Arc<Shared>) {
    let ready = {
        let mut l = sh.link.lock().unwrap();
        l.expire(crate::state::now());
        l.take_results()
    };
    for job in ready {
        let (ok, note) = job.result.clone().unwrap_or((false, String::new()));
        match &job.what {
            What::Company(tin) => {
                let text = if ok {
                    match sh.overview(tin).await {
                        Ok(o) => format!("✅ <b>{}</b> yangilandi\n<code>{}</code> · ishlar <b>{}</b> · toʻlovlar {}", crate::format::esc(&crate::translit::to_latin(&o.company.name)), tin, crate::chat::fmt_int(o.cases as i64), crate::chat::fmt_int(o.company.bills as i64)),
                        // the app finished but the bot has not read the backup yet: the next look will bring it
                        Err(_) => format!("✅ <code>{tin}</code> yangilandi. Bot yangi zaxirani bir necha daqiqada oʻqiydi."),
                    }
                } else {
                    format!("⚠️ <code>{tin}</code> yangilanmadi: {}", crate::format::esc(&note))
                };
                for chat in job.chats {
                    sh.outbox.send_html(chat, &text, None).await;
                }
            }
            What::Order { pdf_id, case, instance } => {
                let label = format!("<code>{}</code> · {}", crate::format::esc(case), crate::format::esc(crate::orders::instance_word(instance)));
                if !ok {
                    let text = format!("⚠️ Qarorni yuklab boʻlmadi ({label}): {}", crate::format::esc(&note));
                    for chat in job.chats {
                        sh.outbox.send_html(chat, &text, None).await;
                    }
                    continue;
                }
                // downloaded and backed up: the bot has just read that backup, so the file is here: send it
                let file = sh.order_pdf(pdf_id).await.ok().flatten();
                let meta = sh.order_meta(pdf_id).await;
                for chat in job.chats {
                    match (&file, &meta) {
                        (Some(bytes), Some(o)) => {
                            if !sh.outbox.send_document(chat, &crate::orders::file_name(o), bytes, &label).await {
                                sh.outbox.send_html(chat, &format!("✅ Qaror yuklandi ({label}), lekin faylni yuborib boʻlmadi. /orders bilan qayta urining."), None).await;
                            }
                        }
                        _ => {
                            sh.outbox.send_html(chat, &format!("✅ Qaror yuklandi ({label}). Bot zaxirani bir necha daqiqada oʻqiydi: keyin /orders bilan oling."), None).await;
                        }
                    }
                }
            }
        }
    }
}

/// the answer to «anything for me?»: a company job is `{id, tin}` (as before), an order job is `{id, kind: "order", pdfId}`
pub fn pull_json(jobs: &[(u64, What)]) -> Value {
    json!({ "ok": true, "jobs": jobs.iter().map(|(id, w)| match w {
        What::Company(tin) => json!({ "id": id, "tin": tin }),
        What::Order { pdf_id, .. } => json!({ "id": id, "kind": "order", "pdfId": pdf_id }),
    }).collect::<Vec<_>>() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn co(tin: &str) -> What {
        What::Company(tin.to_string())
    }

    #[test]
    fn the_signature_is_checked_against_time_path_and_body() {
        let sig = sign("123:abc", 1000, "/link/pull", b"{}");
        assert!(verify("123:abc", "1000", &sig, "/link/pull", b"{}", 1000));
        assert!(verify("123:abc", "1000", &sig, "/link/pull", b"{}", 1000 + WINDOW_SECS));
        assert!(!verify("123:abc", "1000", &sig, "/link/pull", b"{}", 1000 + WINDOW_SECS + 1), "too old");
        assert!(!verify("123:abc", "1000", &sig, "/link/pull", b"{}", 1000 - WINDOW_SECS - 1), "from the future");
        assert!(!verify("123:abc", "1000", &sig, "/link/synced", b"{}", 1000), "another door");
        assert!(!verify("123:abc", "1000", &sig, "/link/pull", b"{ }", 1000), "another body");
        assert!(!verify("123:abd", "1000", &sig, "/link/pull", b"{}", 1000), "another token");
        assert!(!verify("123:abc", "1001", &sig, "/link/pull", b"{}", 1001), "another time");
        assert!(!verify("123:abc", "1000", "zz", "/link/pull", b"{}", 1000) && !verify("123:abc", "x", &sig, "/link/pull", b"{}", 1000));
    }

    /// the app (TypeScript) computes the same signature: this vector is in `src/lib/__tests__/bot-link.test.ts` too
    #[test]
    fn the_signature_matches_the_apps_known_vector() {
        assert_eq!(hex::encode(key("123456:TEST-token")), "71bee8cd5078605f430a96601ec4ac51c8abf80c0e87d2e03ef27a28c77672d0");
        assert_eq!(sign("123456:TEST-token", 1700000000, "/link/pull", br#"{"a":1}"#), "b8e0ad794adb63a34d19ea7551a533291d4c9958806875d8ae629094b336597c");
    }

    #[test]
    fn requests_queue_dedupe_cap_and_expire() {
        let mut l = Link::default();
        assert!(matches!(l.ask(co("207275139"), 1, 100), Queued::NotLinked), "the app has not been seen");
        assert!(l.pull(100).is_empty());
        assert!(matches!(l.ask(co("207275139"), 1, 110), Queued::New));
        assert!(matches!(l.ask(co("207275139"), 2, 111), Queued::Joined) && matches!(l.ask(co("207275139"), 2, 112), Queued::Joined));
        assert_eq!(l.jobs.len(), 1);
        assert_eq!(l.jobs[0].chats, vec![1, 2]);
        assert!(matches!(l.ask(co("302678824"), 1, 113), Queued::New) && matches!(l.ask(co("200248856"), 1, 114), Queued::New));
        assert!(matches!(l.ask(co("111111111"), 1, 115), Queued::TooMany), "three at a time per person");
        // a pull hands out each job once
        assert_eq!(l.pull(120).len(), 3);
        assert!(l.pull(121).is_empty());
        // the result is kept until it is told; a finished company is not asked again at once
        l.finish(1, true, "", 130);
        assert!(matches!(l.ask(co("207275139"), 3, 140), Queued::Recent(10)));
        let told = l.take_results();
        assert_eq!(told.len(), 1);
        assert_eq!(l.jobs.len(), 2);
        // silence ends the link; an old untaken request gives up
        assert!(l.alive(121 + ALIVE_SECS) && !l.alive(121 + ALIVE_SECS + 1));
        let mut l = Link::default();
        l.pull(1000);
        assert!(matches!(l.ask(co("207275139"), 1, 1001), Queued::New));
        l.expire(1001 + UNTAKEN_SECS + 1);
        let told = l.take_results();
        assert!(told.len() == 1 && !told[0].result.as_ref().unwrap().0);
    }

    #[test]
    fn the_queue_is_capped() {
        let mut l = Link::default();
        l.pull(10);
        for i in 0..QUEUE_MAX as i64 {
            assert!(matches!(l.ask(co(&format!("{}", 200_000_000 + i)), 100 + i, 11), Queued::New));
        }
        assert!(matches!(l.ask(co("999999999"), 1, 12), Queued::Full));
    }

    #[test]
    fn an_order_download_queues_dedupes_and_is_handed_out_as_an_order_job() {
        let ord = |pdf: &str| What::Order { pdf_id: pdf.into(), case: "2-1004-2603/8020".into(), instance: "APPEAL".into() };
        let mut l = Link::default();
        l.pull(10);
        assert!(matches!(l.ask(ord("p1"), 1, 11), Queued::New));
        assert!(matches!(l.ask(ord("p1"), 2, 12), Queued::Joined), "the same order asked twice is one job");
        assert!(matches!(l.ask(co("207275139"), 1, 13), Queued::New), "a company with the same text is another thing");
        assert_eq!(l.jobs.len(), 2);
        let got = l.pull(20);
        assert_eq!(got.len(), 2);
        let j = pull_json(&got);
        assert_eq!(j["jobs"][0], json!({ "id": got[0].0, "kind": "order", "pdfId": "p1" }));
        assert_eq!(j["jobs"][1], json!({ "id": got[1].0, "tin": "207275139" }));
        // a finished order is not asked again at once; its key is not the company's
        l.finish(got[0].0, true, "", 30);
        assert!(matches!(l.ask(ord("p1"), 3, 40), Queued::Recent(10)));
        assert!(matches!(l.ask(ord("p2"), 3, 40), Queued::New));
    }
}
