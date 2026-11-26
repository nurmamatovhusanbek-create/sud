# Sud tizimi bot

A standalone server that reads the **encrypted backup the app keeps in your own Telegram channel**, holds the locator (every case and bill number) in
memory and answers in a chat and in a Telegram Mini App. It never scrapes a site and never writes to the channel. Design: `docs/design-notes.md` ›
«Telegram bot (Rust)».

## Environment

| Variable | |
|---|---|
| `BOT_TOKEN` | the bot's token (@BotFather) |
| `SUD_CHANNEL` | the channel that holds the backup (`@name` or `-100…`); the bot must be an admin there. Several, comma separated: the main one first, then its mirrors; the backup is read from the first that works |
| `SUD_PASSPHRASE` | the backup passphrase (**the host can then read your data**: use a host you trust) |
| `ALLOWED_USER_IDS` | comma separated Telegram user ids that may use the bot. Anyone else is told their own id and nothing else |
| `WEBHOOK_SECRET` | a long random string; part of the webhook URL and checked in Telegram's header |
| `PUBLIC_URL` | the service's public https address (Render sets `RENDER_EXTERNAL_URL`, used when this is empty) |
| `PORT` | default 10000 · `REFRESH_SECS` (300) how often the pinned manifest is checked · `WEBHOOK=0` do not register a webhook (local runs) |

## Run

```
cd bot && cargo test            # includes a test that opens data sealed by the app's own TypeScript code
cargo run --release
```
The Mini App is `bot/static/` (tokens → components → screens, see design-notes › «Mini App architecture and design tokens»).
`GET /health` → `{ready, indexed, companies, backupAt}` (what UptimeRobot pings). `GET /app` is the Mini App; its `/api/*` calls carry Telegram's signed
`initData`, checked against the bot token and the allowed ids. Commands: `/find`, `/case`, `/bill`, `/company`, `/hearings`, `/stats` (paged), `/refresh STIR` (asks the app to re-read a company, needs the link), `/orders <case or STIR>` (the court orders the app downloaded, one PDF per instance), `/settings`, `/app`, `/status`; any plain text is a search. Reminders: a morning message (the next days' hearings) and an evening one (tomorrow's), each person's own times, number of days and companies, chosen with `/settings` and kept in the message pinned in their chat (see `src/prefs.rs`); `DIGEST=0` turns the scheduler off.

`bun bot/tests/make-fixture.ts` rewrites `tests/fixtures/compat.json` from `src/lib/backup-crypto.ts` (run it when the app's format changes).

## The link with the app (`src/link.rs`, `src/http/link.rs`)
Two signed doors for the operator's app (outbound from the computer): `POST /link/synced` (a backup was just made: the sync loop wakes now; may carry `done: [{id, ok, note}]`, the finished `/refresh` requests) and `POST /link/pull` (the app asks for work: the STIRs people asked for, each handed out once, and the proof that the app is on). Headers `x-sud-ts` (epoch seconds) and `x-sud-sig` = hex `HMAC-SHA256(HMAC-SHA256(BOT_TOKEN, "sud-link-v1"), "<ts>\n<path>\n" + body)`; a call more than 120 s off is refused. The queue is in memory (a restart empties it). `/refresh STIR` is refused politely when the app has not asked for work within 3 minutes. Tests: `link.rs` (signature, vector shared with the app, queue rules) and `tests.rs` › `the_app_link` (both doors, the whole flow, escaping, strangers).

## Watchdog (`src/watchdog.rs`)
The bot tells the owner when something is wrong: it cannot read the backup (three failed reads in a row), the main channel is down and the mirror is being read, or the app has not asked for work for `ALERT_APP_SILENT_HOURS` (default 6). One message when a problem starts, one when it ends, the same problem again only after a day, nothing between 23:00 and 07:00 (Uzbekistan). `ALERT_USER_IDS` (default: the first of `ALLOWED_USER_IDS`), `ALERTS=0` turns it off. **It can only watch while it is awake:** a free host sleeps after 15 quiet minutes, and the app's own calls keep the bot awake only while the app is on, so the «app is silent» message needs the bot kept awake (a free uptime monitor that opens `https://<your bot>/health` every 5 minutes does it). `/status` also says whether the app is connected.

## Mini App: fullscreen and loading screens
The Mini App asks Telegram for fullscreen (Bot API 8.0+; on by default on phones, a button in the header everywhere, remembered) and follows the safe areas, with no external script: `static/js/core/telegram-core.js` speaks the client protocol itself. It shows its own loading screen from the first byte, waits for a freshly woken bot to read the backup (`/health`), and draws row-shaped skeletons and a thin top bar while a screen loads. Details: `docs/design-notes.md` › «Mini App: fullscreen and loading screens».

