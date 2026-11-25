//! Sud tizimi bot: a standalone server that reads the encrypted backup the app keeps in the operator's own Telegram channel, keeps the locator
//! (every case and bill number) in memory and answers in chat and in a Telegram Mini App. It never scrapes any site and never writes to the channel.
//!
//! Layers: `telegram` (the wire) → `backup` (open/fetch buckets) → `state` (shared state + sync) → `service` (typed answers) → `http` / `chat` (the
//! two front doors). Nothing in `http` or `chat` talks to Telegram's file API or decrypts anything itself.

mod auth;
mod backup;
mod chat;
mod config;
mod crypto;
mod domain;
mod format;
mod error;
mod http;
mod index;
mod orders;
mod link;
mod ratelimit;
mod service;
mod state;
mod sync;
mod telegram;
mod party;
mod prefs;
mod translit;
mod date;
mod digest;
mod watchdog;
#[cfg(test)]
mod testkit;
#[cfg(test)]
mod tests;

#[tokio::main]
async fn main() {
    let cfg = match config::Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[bot] sozlama xatosi: {e}");
            std::process::exit(2);
        }
    };
    let port = cfg.port;
    if cfg.allowed.is_empty() {
        println!("[bot] ALLOWED_USER_IDS boʻsh: hamma ruxsatsiz hisoblanadi (bot oʻz ID sini yozib beradi)");
    }
    let tg = telegram::Tg::new(&cfg.api_base, &cfg.token);
    let want_webhook = cfg.set_webhook;
    let digest = cfg.digest;
    let alerts = cfg.alerts && !cfg.alert_users.is_empty();
    let sh = state::Shared::new(cfg);

    // the port opens at once (the host's health check); the backup is read in the background
    tokio::spawn(sync::keep_synced(sh.clone()));
    if digest {
        tokio::spawn(digest::run(sh.clone()));
    }
    if alerts {
        tokio::spawn(watchdog::run(sh.clone()));
    }
    if want_webhook {
        tokio::spawn(sync::register_webhook(sh.clone(), tg));
    } else {
        tokio::spawn(sync::pause_webhook(tg));
    }

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.expect("port");
    println!("[bot] tinglanmoqda: 0.0.0.0:{port}");
    axum::serve(listener, http::router(sh)).await.expect("server");
}
