//! Settings, all from the environment (Render: Environment tab). Secrets are never logged.

pub struct Config {
    pub token: String,
    /// the channel that holds the backup: `@name` or `-100…`
    pub chat: String,
    pub pass: String,
    /// Telegram user ids allowed to use the bot and the Mini App (comma separated)
    pub allowed: Vec<i64>,
    pub webhook_secret: String,
    pub public_url: Option<String>,
    pub port: u16,
    pub api_base: String,
    pub refresh_secs: u64,
    pub set_webhook: bool,
}

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl Config {
    pub fn from_env() -> Result<Config, String> {
        let need = |k: &str| env(k).ok_or_else(|| format!("{k} oʻrnatilmagan"));
        Ok(Config {
            token: need("BOT_TOKEN")?,
            chat: need("SUD_CHANNEL")?,
            pass: need("SUD_PASSPHRASE")?,
            allowed: env("ALLOWED_USER_IDS").map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).collect()).unwrap_or_default(),
            webhook_secret: need("WEBHOOK_SECRET")?,
            public_url: env("PUBLIC_URL").or_else(|| env("RENDER_EXTERNAL_URL")).map(|u| u.trim_end_matches('/').to_string()),
            port: env("PORT").and_then(|p| p.parse().ok()).unwrap_or(10000),
            api_base: env("TG_API_BASE").unwrap_or_else(|| "https://api.telegram.org".to_string()),
            refresh_secs: env("REFRESH_SECS").and_then(|p| p.parse().ok()).unwrap_or(300),
            set_webhook: env("WEBHOOK").map(|v| v != "0").unwrap_or(true),
        })
    }
}
