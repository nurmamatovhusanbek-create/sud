# Sud tizimi: delivery notes

A private, localhost, single-operator app that looks up Uzbek companies, court cases (with their instances: first, appeal,
cassation, Taftish), receipts, published court orders and fills legal documents. **Start at [`README.md`](./README.md)**; the rules
for changing it are in [`AGENTS.md`](./AGENTS.md) and the map of the code in [`docs/MAP.md`](./docs/MAP.md).

## Run

```bash
bun install
cp .env.example .env   # CF_WORKER_URLS, CF_WORKER_SECRET, optional APP_API_TOKEN / VLM_*
bun run dev            # http://localhost:3000   (Windows: double-click Sud.bat)
```

Before handing a change over:

```bash
bun run typecheck && bun run lint && bun test src/core src/lib src/server && bun run map:check
```

## What is in the box

| Path | Role |
|------|------|
| `src/core/` | Pure domain: classification, win rate, dates, hearing / instance logic, public-orders policy, alphabets, penalty maths, schemas |
| `src/lib/` | Scrapers, worker routing, document engine, company report, published-orders store, client registry |
| `src/sources/`, `src/server/` | Source adapters; the `guard()` middleware, security, typed config |
| `src/app/api/` | Route handlers (every one guarded) |
| `src/components/` | Shell, company tabs (Toʻlovlar, Sud ishlari, Majlislar, Kompaniya, Statistika), Kuzatuv, Qarorlar, Hujjatlar, Sozlamalar |
| `src/app/*.css` | Tokens and the two looks (Premium, Moviy) |
| `cloudflare-worker/` | `proxy.js`, the allow-listed proxy to deploy as your own workers |
| `mini-services/` | tor-manager and ihamkor-scraper side-processes |
| `docs/` | `MAP.md`, `design-notes.md`, `orders.md`, `SECURITY.md`, `public-sud-api.md` |
| `P0-RUNBOOK.md` | Secret-rotation and hardening runbook (owner actions) |

## Honest states

Partial banners, skeletons, empty and error blocks everywhere: a source that fails is said to have failed, never shown as a zero or a
made-up value. Live scraping does not work from a sandbox; verify the UI against mocked `/api/*`.
