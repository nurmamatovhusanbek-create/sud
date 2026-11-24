//! Talking to Telegram, in two halves that the rest of the bot sees as plain types:
//!  - `Tg`: a thin Bot API client (the token is part of Telegram's URL, so NO error text here contains a URL);
//!  - `Source`: where the backup's files come from: the channel (`Telegram`) or an in-memory channel (`Memory`, used by tests, so the whole bot runs
//!    without a network);
//!  - `Outbox`: where chat replies go: Telegram, or a capture list in tests.

use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{atomic::{AtomicI64, AtomicUsize, Ordering}, Mutex},
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
        self.send_as(chat_id, text, markup, false).await;
    }

    /// `html`: the text is Telegram HTML (every piece of data in it escaped, see `format::esc`)
    pub async fn send_as(&self, chat_id: i64, text: &str, markup: Option<Value>, html: bool) {
        let text: String = text.chars().take(4000).collect();
        let mut body = json!({ "chat_id": chat_id, "text": text, "disable_web_page_preview": true });
        if html {
            body["parse_mode"] = json!("HTML");
        }
        if let Some(m) = markup {
            body["reply_markup"] = m;
        }
        if let Err(e) = self.call::<Value>("sendMessage", &body).await {
            eprintln!("[bot] sendMessage: {e}");
        }
    }

    /// like `send_as`, and gives back the message's id (to edit or pin it later)
    pub async fn send_with_id(&self, chat_id: i64, text: &str, markup: Option<Value>) -> Option<i64> {
        let text: String = text.chars().take(4000).collect();
        let mut body = json!({ "chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": true });
        if let Some(m) = markup {
            body["reply_markup"] = m;
        }
        match self.call::<Value>("sendMessage", &body).await {
            Ok(v) => v["message_id"].as_i64(),
            Err(e) => {
                eprintln!("[bot] sendMessage: {e}");
                None
            }
        }
    }

    /// edit a message the bot sent (Telegram says «not modified» when nothing changed: that is not an error worth logging)
    pub async fn edit_html(&self, chat_id: i64, message_id: i64, text: &str, markup: Option<Value>) {
        let text: String = text.chars().take(4000).collect();
        let mut body = json!({ "chat_id": chat_id, "message_id": message_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": true });
        if let Some(m) = markup {
            body["reply_markup"] = m;
        }
        if let Err(e) = self.call::<Value>("editMessageText", &body).await {
            if !e.contains("not modified") {
                eprintln!("[bot] editMessageText: {e}");
            }
        }
    }

    /// pin a message in a private chat (quietly)
    pub async fn pin(&self, chat_id: i64, message_id: i64) {
        if let Err(e) = self.call::<Value>("pinChatMessage", &json!({ "chat_id": chat_id, "message_id": message_id, "disable_notification": true })).await {
            eprintln!("[bot] pinChatMessage: {e}");
        }
    }

    /// the newest pinned message of a chat: its id and its text (as plain text: the entities are not part of `text`)
    pub async fn pinned_text(&self, chat_id: i64) -> Result<Option<(i64, String)>, String> {
        let r: Value = self.call("getChat", &json!({ "chat_id": chat_id })).await?;
        let m = &r["pinned_message"];
        Ok(m["text"].as_str().map(|t| (m["message_id"].as_i64().unwrap_or(0), t.to_string())))
    }

    pub async fn answer_callback(&self, id: &str) {
        let _ = self.call::<Value>("answerCallbackQuery", &json!({ "callback_query_id": id })).await;
    }

    pub async fn set_webhook(&self, url: &str, secret: &str) -> Result<(), String> {
        self.call::<Value>("setWebhook", &json!({ "url": url, "secret_token": secret, "allowed_updates": ["message", "callback_query"], "max_connections": 4 })).await.map(|_| ())
    }

    /// Telegram allows either a webhook or getUpdates, never both: the app's «Kanalni topish» reads getUpdates, so while the operator tests it the webhook is taken off.
    pub async fn delete_webhook(&self) -> Result<(), String> {
        self.call::<Value>("deleteWebhook", &json!({ "drop_pending_updates": false })).await.map(|_| ())
    }

    /// the «/» menu of the chat: the commands and what they do
    pub async fn set_commands(&self) -> Result<(), String> {
        let list: Vec<Value> = [
            ("start", "Boshlash va yordam"),
            ("find", "Qidirish: ish, kvitansiya, STIR yoki nom"),
            ("hearings", "Yaqin majlislar"),
            ("stats", "Sonlar: kompaniyalar va ishlar"),
            ("company", "Kompaniya: STIR"),
            ("case", "Ish: raqam"),
            ("bill", "Kvitansiya: raqam"),
            ("app", "Qidiruv oynasi (Mini App)"),
            ("refresh", "Kompaniyani yangilash: STIR"),
            ("settings", "Eslatma sozlamalari"),
            ("status", "Zaxira holati"),
            ("help", "Yordam"),
        ]
        .iter()
        .map(|(c, d)| json!({ "command": c, "description": d }))
        .collect();
        self.call::<Value>("setMyCommands", &json!({ "commands": list })).await.map(|_| ())
    }

    pub async fn set_menu_button(&self, app_url: &str) -> Result<(), String> {
        self.call::<Value>("setChatMenuButton", &json!({ "menu_button": { "type": "web_app", "text": "Qidiruv", "web_app": { "url": app_url } } })).await.map(|_| ())
    }
}

/// An in-memory set of channels: each has a pinned document and its own files; a channel can be «killed» (banned) or lose its pin. The tests build
/// whole sealed backups in it.
#[derive(Default)]
pub struct MemoryChannel {
    pinned: Mutex<HashMap<String, (i64, String)>>,
    /// file id → (the channel it was sent to, bytes): a file id of one channel means nothing in another
    files: Mutex<HashMap<String, (String, Vec<u8>)>>,
    dead: Mutex<std::collections::HashSet<String>>,
    /// how many files were asked for (a test checks that an unchanged backup downloads nothing)
    pub downloads: AtomicUsize,
}

#[cfg_attr(not(test), allow(dead_code))]
impl MemoryChannel {
    pub fn put(&self, chat: &str, file_id: &str, bytes: Vec<u8>) {
        self.files.lock().unwrap().insert(file_id.to_string(), (chat.to_string(), bytes));
    }
    pub fn pin(&self, chat: &str, message_id: i64, file_id: &str) {
        self.pinned.lock().unwrap().insert(chat.to_string(), (message_id, file_id.to_string()));
    }
    /// the channel is banned: every call about it and every file of it fails
    pub fn kill(&self, chat: &str) {
        self.dead.lock().unwrap().insert(chat.to_string());
    }
    /// the pinned message is deleted
    pub fn unpin(&self, chat: &str) {
        self.pinned.lock().unwrap().remove(chat);
    }
    /// one file is deleted
    pub fn delete_file(&self, file_id: &str) {
        self.files.lock().unwrap().remove(file_id);
    }
    pub fn files_of(&self, chat: &str) -> Vec<String> {
        self.files.lock().unwrap().iter().filter(|(_, (c, _))| c == chat).map(|(id, _)| id.clone()).collect()
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
            Source::Memory(m) => {
                if m.dead.lock().unwrap().contains(chat) {
                    return Err("Forbidden: bot was kicked from the channel chat".into());
                }
                Ok(m.pinned.lock().unwrap().get(chat).cloned())
            }
        }
    }

    pub async fn file_bytes(&self, file_id: &str) -> Result<Vec<u8>, String> {
        match self {
            Source::Telegram(t) => t.file_bytes(file_id).await,
            Source::Memory(m) => {
                m.downloads.fetch_add(1, Ordering::SeqCst);
                let found = m.files.lock().unwrap().get(file_id).cloned();
                match found {
                    Some((chat, bytes)) if !m.dead.lock().unwrap().contains(&chat) => Ok(bytes),
                    _ => Err("Fayl topilmadi".to_string()),
                }
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
    pub id: i64,
}

/// what the test outbox keeps: the messages sent, the edits made, and what is pinned in each chat (id and plain text), like Telegram would keep it
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Default)]
pub struct CaptureBox {
    pub sent: Mutex<Vec<Sent>>,
    pub edited: Mutex<Vec<Sent>>,
    pub pinned: Mutex<HashMap<i64, (i64, String)>>,
    pub next_id: AtomicI64,
}

/// where chat replies go
pub enum Outbox {
    Telegram(Tg),
    #[cfg_attr(not(test), allow(dead_code))]
    Capture(CaptureBox),
}

impl Outbox {
    pub async fn send(&self, chat: i64, text: &str, markup: Option<Value>) {
        match self {
            Outbox::Telegram(t) => t.send(chat, text, markup).await,
            Outbox::Capture(c) => {
                let id = c.next_id.fetch_add(1, Ordering::SeqCst) + 1;
                c.sent.lock().unwrap().push(Sent { chat, text: text.to_string(), markup, id });
            }
        }
    }
    /// the text is Telegram HTML
    pub async fn send_html(&self, chat: i64, text: &str, markup: Option<Value>) {
        self.send_html_id(chat, text, markup).await;
    }
    /// like `send_html`, and gives back the message's id
    pub async fn send_html_id(&self, chat: i64, text: &str, markup: Option<Value>) -> Option<i64> {
        match self {
            Outbox::Telegram(t) => t.send_with_id(chat, text, markup).await,
            Outbox::Capture(c) => {
                let id = c.next_id.fetch_add(1, Ordering::SeqCst) + 1;
                c.sent.lock().unwrap().push(Sent { chat, text: text.to_string(), markup, id });
                Some(id)
            }
        }
    }
    pub async fn edit_html(&self, chat: i64, id: i64, text: &str, markup: Option<Value>) {
        match self {
            Outbox::Telegram(t) => t.edit_html(chat, id, text, markup).await,
            Outbox::Capture(c) => {
                c.edited.lock().unwrap().push(Sent { chat, text: text.to_string(), markup, id });
                // an edited pinned message keeps its place and gets the new text
                if let Some(p) = c.pinned.lock().unwrap().get_mut(&chat) {
                    if p.0 == id {
                        p.1 = crate::format::plain(text);
                    }
                }
            }
        }
    }
    pub async fn pin(&self, chat: i64, id: i64) {
        match self {
            Outbox::Telegram(t) => t.pin(chat, id).await,
            Outbox::Capture(c) => {
                let text = c.sent.lock().unwrap().iter().rev().find(|m| m.chat == chat && m.id == id).map(|m| crate::format::plain(&m.text)).unwrap_or_default();
                c.pinned.lock().unwrap().insert(chat, (id, text));
            }
        }
    }
    /// the newest pinned message of a chat (id, plain text)
    pub async fn pinned_text(&self, chat: i64) -> Result<Option<(i64, String)>, String> {
        match self {
            Outbox::Telegram(t) => t.pinned_text(chat).await,
            Outbox::Capture(c) => Ok(c.pinned.lock().unwrap().get(&chat).cloned()),
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
            Outbox::Capture(c) => c.sent.lock().unwrap().clone(),
            _ => Vec::new(),
        }
    }
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn edited(&self) -> Vec<Sent> {
        match self {
            Outbox::Capture(c) => c.edited.lock().unwrap().clone(),
            _ => Vec::new(),
        }
    }
}
