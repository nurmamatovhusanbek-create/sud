//! Talking to Telegram, in two halves that the rest of the bot sees as plain types:
//!  - `Tg`: a thin Bot API client (the token is part of Telegram's URL, so NO error text here contains a URL);
//!  - `Source`: where the backup's files come from: the channel (`Telegram`) or an in-memory channel (`Memory`, used by tests, so the whole bot runs
//!    without a network);
//!  - `Outbox`: where chat replies go: Telegram, or a capture list in tests.

use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{atomic::{AtomicUsize, Ordering}, Mutex},
    time::Duration,
};

pub struct Tg {
    http: reqwest::Client,
    base: String,
    token: String,
}

fn reqerr(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "Telegram javob bermadi (vaqt tugadi)".into()
    } else {
        "Telegramga ulanib boʻlmadi".into()
    }
}

impl Tg {
    pub fn new(base: &str, token: &str) -> Tg {
        let http = reqwest::Client::builder().timeout(Duration::from_secs(60)).build().expect("http client");
        Tg { http, base: base.trim_end_matches('/').to_string(), token: token.to_string() }
    }

    pub async fn call<T: DeserializeOwned>(&self, method: &str, body: &Value) -> Result<T, String> {
        let res = self.http.post(format!("{}/bot{}/{}", self.base, self.token, method)).json(body).send().await.map_err(reqerr)?;
        let j: Value = res.json().await.map_err(|_| "Telegram javobi oʻqilmadi".to_string())?;
        if j["ok"].as_bool() == Some(true) {
            serde_json::from_value(j["result"].clone()).map_err(|_| "Telegram javobi kutilgan shaklda emas".into())
        } else {
            Err(format!("Telegram: {}", j["description"].as_str().unwrap_or("xato")))
        }
    }

    /// the file pinned in the channel: (message id, file id)
    pub async fn pinned_document(&self, chat: &str) -> Result<Option<(i64, String)>, String> {
        let r: Value = self.call("getChat", &json!({ "chat_id": chat })).await?;
        let m = &r["pinned_message"];
        Ok(m["document"]["file_id"].as_str().map(|f| (m["message_id"].as_i64().unwrap_or(0), f.to_string())))
    }

    pub async fn file_bytes(&self, file_id: &str) -> Result<Vec<u8>, String> {
        let f: Value = self.call("getFile", &json!({ "file_id": file_id })).await?;
        let path = f["file_path"].as_str().ok_or("Telegram fayl manzilini bermadi")?;
        for attempt in 0..3u64 {
            if let Ok(res) = self.http.get(format!("{}/file/bot{}/{}", self.base, self.token, path)).send().await {
                if res.status().is_success() {
                    if let Ok(b) = res.bytes().await {
                        return Ok(b.to_vec());
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(800 * (attempt + 1))).await;
        }
        Err("Faylni yuklab boʻlmadi".into())
    }

    pub async fn send(&self, chat_id: i64, text: &str, markup: Option<Value>) {
        let text: String = text.chars().take(4000).collect();
        let mut body = json!({ "chat_id": chat_id, "text": text, "disable_web_page_preview": true });
        if let Some(m) = markup {
            body["reply_markup"] = m;
        }
        if let Err(e) = self.call::<Value>("sendMessage", &body).await {
            eprintln!("[bot] sendMessage: {e}");
        }
    }

    pub async fn answer_callback(&self, id: &str) {
        let _ = self.call::<Value>("answerCallbackQuery", &json!({ "callback_query_id": id })).await;
    }

    pub async fn set_webhook(&self, url: &str, secret: &str) -> Result<(), String> {
        self.call::<Value>("setWebhook", &json!({ "url": url, "secret_token": secret, "allowed_updates": ["message", "callback_query"], "max_connections": 4 })).await.map(|_| ())
    }

    pub async fn set_menu_button(&self, app_url: &str) -> Result<(), String> {
        self.call::<Value>("setChatMenuButton", &json!({ "menu_button": { "type": "web_app", "text": "Qidiruv", "web_app": { "url": app_url } } })).await.map(|_| ())
    }
}

/// An in-memory channel: a pinned document and a map of files. The tests build a whole sealed backup in it.
#[derive(Default)]
pub struct MemoryChannel {
    pub pinned: Mutex<Option<(i64, String)>>,
    pub files: Mutex<HashMap<String, Vec<u8>>>,
    /// how many files were asked for (a test checks that an unchanged backup downloads nothing)
    pub downloads: AtomicUsize,
}

#[cfg_attr(not(test), allow(dead_code))]
impl MemoryChannel {
    pub fn put(&self, file_id: &str, bytes: Vec<u8>) {
        self.files.lock().unwrap().insert(file_id.to_string(), bytes);
    }
    pub fn pin(&self, message_id: i64, file_id: &str) {
        *self.pinned.lock().unwrap() = Some((message_id, file_id.to_string()));
    }
}

/// where the backup's files come from
pub enum Source {
    Telegram(Tg),
    #[cfg_attr(not(test), allow(dead_code))]
    Memory(std::sync::Arc<MemoryChannel>),
}

impl Source {
    pub async fn pinned_document(&self, chat: &str) -> Result<Option<(i64, String)>, String> {
        match self {
            Source::Telegram(t) => t.pinned_document(chat).await,
            Source::Memory(m) => Ok(m.pinned.lock().unwrap().clone()),
        }
    }

    pub async fn file_bytes(&self, file_id: &str) -> Result<Vec<u8>, String> {
        match self {
            Source::Telegram(t) => t.file_bytes(file_id).await,
            Source::Memory(m) => {
                m.downloads.fetch_add(1, Ordering::SeqCst);
                m.files.lock().unwrap().get(file_id).cloned().ok_or_else(|| "Fayl topilmadi".to_string())
            }
        }
    }
}

/// a message the bot sent (kept by the test outbox)
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone)]
pub struct Sent {
    pub chat: i64,
    pub text: String,
    pub markup: Option<Value>,
}

/// where chat replies go
pub enum Outbox {
    Telegram(Tg),
    #[cfg_attr(not(test), allow(dead_code))]
    Capture(Mutex<Vec<Sent>>),
}

impl Outbox {
    pub async fn send(&self, chat: i64, text: &str, markup: Option<Value>) {
        match self {
            Outbox::Telegram(t) => t.send(chat, text, markup).await,
            Outbox::Capture(v) => v.lock().unwrap().push(Sent { chat, text: text.to_string(), markup }),
        }
    }
    pub async fn answer_callback(&self, id: &str) {
        if let Outbox::Telegram(t) = self {
            t.answer_callback(id).await;
        }
    }
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn captured(&self) -> Vec<Sent> {
        match self {
            Outbox::Capture(v) => v.lock().unwrap().clone(),
            _ => Vec::new(),
        }
    }
}
