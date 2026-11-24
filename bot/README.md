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
`initData`, checked against the bot token and the allowed ids. Commands: `/find`, `/case`, `/bill`, `/company`, `/hearings`, `/stats`, `/settings`, `/app`, `/status`; any plain text is a search. Reminders: a morning message (the next days' hearings) and an evening one (tomorrow's), each person's own times, number of days and companies, chosen with `/settings` and kept in the message pinned in their chat (see `src/prefs.rs`); `DIGEST=0` turns the scheduler off.

`bun bot/tests/make-fixture.ts` rewrites `tests/fixtures/compat.json` from `src/lib/backup-crypto.ts` (run it when the app's format changes).
