//! Settings, all from the environment (Render: Environment tab). Secrets are never logged.

pub struct Config {
    pub token: String,
    /// the channels that hold the backup, the main one first, then its mirrors: `@name` or `-100…` (SUD_CHANNEL, comma separated). The backup is read
    /// from the first channel that works.
    pub channels: Vec<String>,
    pub pass: String,
    /// Telegram user ids allowed to use the bot and the Mini App (comma separated)
    pub allowed: Vec<i64>,
    pub webhook_secret: String,
    pub public_url: Option<String>,
    pub port: u16,
    pub api_base: String,
    pub refresh_secs: u64,
    pub set_webhook: bool,
    /// calls per person per minute (0 = no limit)
    pub rate_per_minute: usize,
    /// the morning message with the week's hearings (DIGEST=0 turns it off)
    pub digest: bool,
}

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl Config {
    pub fn from_env() -> Result<Config, String> {
        let need = |k: &str| env(k).ok_or_else(|| format!("{k} oʻrnatilmagan"));
        Ok(Config {
            token: need("BOT_TOKEN")?,
            channels: need("SUD_CHANNEL")?.split(',').map(|c| c.trim().to_string()).filter(|c| !c.is_empty()).collect(),
            pass: need("SUD_PASSPHRASE")?,
            allowed: env("ALLOWED_USER_IDS").map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).collect()).unwrap_or_default(),
            webhook_secret: need("WEBHOOK_SECRET")?,
            public_url: env("PUBLIC_URL").or_else(|| env("RENDER_EXTERNAL_URL")).map(|u| u.trim_end_matches('/').to_string()),
            port: env("PORT").and_then(|p| p.parse().ok()).unwrap_or(10000),
            api_base: env("TG_API_BASE").unwrap_or_else(|| "https://api.telegram.org".to_string()),
            refresh_secs: env("REFRESH_SECS").and_then(|p| p.parse().ok()).unwrap_or(300),
            set_webhook: env("WEBHOOK").map(|v| v != "0").unwrap_or(true),
            rate_per_minute: env("RATE_PER_MINUTE").and_then(|p| p.parse().ok()).unwrap_or(90),
            digest: env("DIGEST").map(|v| v != "0").unwrap_or(true),
        })
    }
}

impl Config {
    /// a fixed set of values for tests (never read from the environment)
    #[cfg(test)]
    pub fn for_tests() -> Config {
        Config {
            token: "123456789:AAFakeFakeFakeFakeFakeFakeFakeFake_x1Yz".into(),
            channels: vec!["-100123".into()],
            pass: "a fine long pass phrase".into(),
            allowed: vec![4242],
            webhook_secret: "testsecrettestsecret".into(),
            public_url: Some("https://bot.example".into()),
            port: 0,
            api_base: "http://127.0.0.1:1".into(),
            refresh_secs: 300,
            set_webhook: false,
            rate_per_minute: 0,
            digest: false,
        }
    }
}
