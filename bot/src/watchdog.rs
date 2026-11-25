//! The watchdog: the bot tells the OWNER when something is wrong, instead of the owner finding out by asking `/status`.
//!
//!  * the backup cannot be read (the channel, the passphrase, Telegram): the bot answers from older data;
//!  * the main channel is down and the mirror is being read;
//!  * the app (the computer that scrapes) has not asked for work for hours: Kuzatuv, auto-backup and `/refresh` are not running.
//!
//! One message when a problem starts, one when it is over, and the same problem again only after a day. Nothing at night (23:00 to 07:00 in Uzbekistan:
//! what started then is told at seven). LIMIT worth knowing: on a free host that sleeps after 15 quiet minutes the bot is not running while it sleeps, so
//! it can only watch while it is awake (the app's own calls keep it awake while the app is on; a free uptime monitor pinging `/health` every five
//! minutes keeps it awake always). The state is in memory: a restart forgets it, which is why a problem needs three failed reads in a row to count.

use crate::date::secs_of_day;
use crate::state::{now, Shared};
use std::{collections::HashMap, sync::Arc, time::Duration};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Kind {
    SyncDown,
    MainDown,
    AppSilent,
}

/// what the bot can see
#[derive(Debug, Clone)]
pub struct Obs {
    pub now: i64,
    pub failures: u32,
    pub error: Option<String>,
    /// 0 = the main channel is the one being read
    pub channel: usize,
    /// when the app last asked for work (epoch seconds), 0 = not since this start
    pub last_seen: i64,
    pub silent_hours: i64,
}

/// failed reads in a row before it is a problem (the sync backs off 5, 10, 20 minutes: about 35 minutes)
pub const FAILURES: u32 = 3;
const REPEAT_SECS: i64 = 24 * 3600;

fn quiet(now: i64) -> bool {
    let s = secs_of_day(now);
    !(7 * 3600..23 * 3600).contains(&s)
}

fn problem(k: Kind, o: &Obs) -> Option<String> {
    match k {
        Kind::SyncDown if o.failures >= FAILURES => Some(format!("⚠️ <b>Bot zaxirani oʻqiy olmayapti</b>\n{}\nHozircha eski maʼlumotdan javob beryapman.", crate::format::esc(o.error.as_deref().unwrap_or("sababi nomaʼlum")))),
        Kind::MainDown if o.channel > 0 => Some("⚠️ <b>Asosiy kanal ishlamayapti</b>\nZaxira ehtiyot kanaldan oʻqilmoqda. Botni asosiy kanalga ham admin qiling va kanal raqamini tekshiring.".to_string()),
        Kind::AppSilent if o.last_seen > 0 && o.now - o.last_seen > o.silent_hours * 3600 => {
            Some(format!("⚠️ <b>Ilova {} soatdan beri javob bermayapti</b>\nKompyuter oʻchiq yoki ilova toʻxtagan boʻlishi mumkin: Kuzatuv, avtomatik zaxira va /refresh ishlamaydi. Kompyuterda <code>Sud.bat keep</code> bilan yoqing.", (o.now - o.last_seen) / 3600))
        }
        _ => None,
    }
}

fn recovery(k: Kind) -> &'static str {
    match k {
        Kind::SyncDown => "✅ Bot zaxirani yana oʻqiyapti.",
        Kind::MainDown => "✅ Asosiy kanal yana ishlayapti.",
        Kind::AppSilent => "✅ Ilova qayta ulandi.",
    }
}

/// One look: the messages to send now. `active` = the problems already told (kind → when).
pub fn step(active: &mut HashMap<Kind, i64>, o: &Obs) -> Vec<String> {
    if quiet(o.now) {
        return Vec::new(); // told at seven, if it is still so
    }
    let mut out = Vec::new();
    for k in [Kind::SyncDown, Kind::MainDown, Kind::AppSilent] {
        match (problem(k, o), active.get(&k).copied()) {
            (Some(text), None) => {
                out.push(text);
                active.insert(k, o.now);
            }
            (Some(text), Some(at)) if o.now - at >= REPEAT_SECS => {
                out.push(text);
                active.insert(k, o.now);
            }
            (None, Some(_)) => {
                out.push(recovery(k).to_string());
                active.remove(&k);
            }
            _ => {}
        }
    }
    out
}

/// look at the bot's own state
pub async fn observe(sh: &Arc<Shared>, now: i64) -> Obs {
    let info = sh.info().await;
    let last_seen = sh.link.lock().unwrap().last_seen;
    Obs { now, failures: info.failures, error: info.error, channel: info.channel, last_seen, silent_hours: sh.cfg.app_silent_hours }
}

/// one look at the clock: tell the owner what changed
pub async fn tick(sh: &Arc<Shared>, now: i64, active: &mut HashMap<Kind, i64>) {
    let obs = observe(sh, now).await;
    for text in step(active, &obs) {
        for user in &sh.cfg.alert_users {
            sh.outbox.send_html(*user, &text, None).await;
        }
    }
}

pub async fn run(sh: Arc<Shared>) {
    let mut active = HashMap::new();
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
        tick(&sh, now(), &mut active).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-11-23 07:00 UTC = 12:00 in Uzbekistan
    const NOON: i64 = 1_795_417_200;

    fn obs(now: i64) -> Obs {
        Obs { now, failures: 0, error: None, channel: 0, last_seen: 0, silent_hours: 6 }
    }

    #[test]
    fn a_problem_is_told_once_repeated_after_a_day_and_its_end_is_told() {
        let mut a = HashMap::new();
        let mut o = obs(NOON);
        assert!(step(&mut a, &o).is_empty(), "all is well: silence");
        o.failures = 2;
        assert!(step(&mut a, &o).is_empty(), "two failed reads are not a problem yet");
        o.failures = 3;
        o.error = Some("Parol <notoʻgʻri>".into());
        let first = step(&mut a, &o);
        assert_eq!(first.len(), 1);
        assert!(first[0].contains("Bot zaxirani oʻqiy olmayapti") && first[0].contains("Parol &lt;notoʻgʻri&gt;"), "{}", first[0]);
        o.now += 3600;
        assert!(step(&mut a, &o).is_empty(), "the same problem is not told again within a day");
        o.now += 24 * 3600;
        assert_eq!(step(&mut a, &o).len(), 1, "still so after a day: told again");
        o.failures = 0;
        o.now += 600;
        assert_eq!(step(&mut a, &o), vec!["✅ Bot zaxirani yana oʻqiyapti.".to_string()]);
        assert!(step(&mut a, &o).is_empty());
    }

    #[test]
    fn the_main_channel_and_a_silent_app_are_their_own_problems() {
        let mut a = HashMap::new();
        let mut o = obs(NOON);
        o.channel = 1;
        o.last_seen = NOON - 7 * 3600;
        let m = step(&mut a, &o);
        assert_eq!(m.len(), 2);
        assert!(m.iter().any(|t| t.contains("Asosiy kanal ishlamayapti")) && m.iter().any(|t| t.contains("Ilova 7 soatdan beri")), "{m:?}");
        // the app comes back (it asked for work a moment ago); the channel is still down
        o.last_seen = o.now - 30;
        let m2 = step(&mut a, &o);
        assert_eq!(m2, vec!["✅ Ilova qayta ulandi.".to_string()]);
    }

    #[test]
    fn an_app_never_seen_since_the_start_is_not_called_silent_and_a_short_silence_is_fine() {
        let mut a = HashMap::new();
        let mut o = obs(NOON);
        assert!(step(&mut a, &o).is_empty(), "last_seen 0 = unknown, not silent");
        o.last_seen = NOON - 5 * 3600;
        assert!(step(&mut a, &o).is_empty(), "five hours is within the six");
        o.silent_hours = 2;
        assert_eq!(step(&mut a, &o).len(), 1, "the owner's own limit");
    }

    #[test]
    fn nothing_is_told_at_night_and_what_is_still_wrong_is_told_at_seven() {
        let mut a = HashMap::new();
        let mut o = obs(NOON + 12 * 3600); // 00:00 in Uzbekistan
        o.failures = 5;
        assert!(step(&mut a, &o).is_empty(), "at midnight");
        o.now = NOON + 18 * 3600 + 1800; // 06:30
        assert!(step(&mut a, &o).is_empty(), "before seven");
        o.now = NOON - 5 * 3600 + 24 * 3600 + 60; // 07:01
        assert_eq!(step(&mut a, &o).len(), 1, "at seven");
        // a problem that started and ended during the night is never told
        let mut b = HashMap::new();
        let mut n = obs(NOON + 12 * 3600);
        n.failures = 5;
        assert!(step(&mut b, &n).is_empty());
        n.failures = 0;
        n.now += 3600;
        assert!(step(&mut b, &n).is_empty());
    }

    #[tokio::test]
    async fn tick_tells_the_owner_only_and_says_when_it_is_over() {
        let (sh, _b) = crate::testkit::ready_bot().await;
        let mut a = HashMap::new();
        tick(&sh, NOON, &mut a).await;
        assert!(sh.outbox.captured().is_empty());
        {
            let mut st = sh.st.write().await;
            st.failures = 4;
            st.error = Some("Telegramga ulanib boʻlmadi".into());
        }
        tick(&sh, NOON + 60, &mut a).await;
        tick(&sh, NOON + 120, &mut a).await;
        let sent = sh.outbox.captured();
        assert_eq!(sent.len(), 1, "told once");
        assert_eq!(sent[0].chat, 4242);
        assert!(sent[0].text.contains("Telegramga ulanib boʻlmadi"));
        sh.st.write().await.failures = 0;
        tick(&sh, NOON + 180, &mut a).await;
        assert!(sh.outbox.captured()[1].text.contains("yana oʻqiyapti"));
        // the app asked for work long ago: silent
        sh.link.lock().unwrap().last_seen = NOON - 8 * 3600;
        tick(&sh, NOON + 240, &mut a).await;
        assert!(sh.outbox.captured()[2].text.contains("Ilova 8 soatdan beri"), "{}", sh.outbox.captured()[2].text);
    }
}

