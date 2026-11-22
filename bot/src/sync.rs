//! Background upkeep: keep the locator fresh (a cheap look at the pinned manifest every few minutes, a download only when a new backup was made,
//! backing off while the channel is unreachable) and register the webhook.

use crate::state::Shared;
use std::{sync::Arc, time::Duration};

/// seconds to wait after `failures` failed syncs in a row: the normal period, doubling up to 30 minutes
pub fn delay_secs(base: u64, failures: u32) -> u64 {
    if failures == 0 {
        return base;
    }
    (base.saturating_mul(1u64 << failures.min(6))).min(1800)
}

pub async fn keep_synced(sh: Arc<Shared>) {
    let mut first = true;
    loop {
        match sh.sync().await {
            Ok(msg) => {
                if first || msg != "oʻzgarmagan" {
                    println!("[bot] sinxronlandi: {msg}");
                }
                first = false;
            }
            Err(e) => {
                eprintln!("[bot] sinxronlash xatosi: {e}");
                let mut s = sh.st.write().await;
                s.failures += 1;
                s.error = Some(e.to_string());
            }
        }
        let failures = sh.st.read().await.failures;
        tokio::time::sleep(Duration::from_secs(delay_secs(sh.cfg.refresh_secs, failures))).await;
    }
}

pub async fn register_webhook(sh: Arc<Shared>, tg: crate::telegram::Tg) {
    let Some(base) = sh.cfg.public_url.clone() else {
        println!("[bot] PUBLIC_URL yoʻq: webhook oʻrnatilmadi");
        return;
    };
    for attempt in 1..=5u64 {
        match tg.set_webhook(&format!("{base}/tg/{}", sh.cfg.webhook_secret), &sh.cfg.webhook_secret).await {
            Ok(()) => {
                let _ = tg.set_menu_button(&format!("{base}/app")).await;
                println!("[bot] webhook oʻrnatildi: {base}/tg/…");
                return;
            }
            Err(e) => {
                eprintln!("[bot] webhook xatosi: {e}");
                tokio::time::sleep(Duration::from_secs(3 * attempt)).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_and_is_capped() {
        assert_eq!(delay_secs(300, 0), 300);
        assert_eq!(delay_secs(300, 1), 600);
        assert_eq!(delay_secs(300, 2), 1200);
        assert_eq!(delay_secs(300, 3), 1800);
        assert_eq!(delay_secs(300, 40), 1800);
    }
}
