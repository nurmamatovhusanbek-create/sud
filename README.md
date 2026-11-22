<div align="center">

# Sud tizimi · by Nurmamatov

**A private legal-intelligence workbench for Uzbekistan.** Type a company's STIR (or a case number, a receipt) and get
its court cases, instances, hearings, payment receipts, published court orders, profile and contractor rating in one
place, then turn them into ready-to-file `.docx` and PDF documents.

Next.js 16 · React 19 · TypeScript · Tailwind v4 · Bun · IBM Plex Sans / Mono · Plus Jakarta Sans

</div>

> **New here? Read [`AGENTS.md`](./AGENTS.md) first** (the rules), then [`docs/MAP.md`](./docs/MAP.md) (where everything
> lives, what else to touch, change recipes). Security model: [`docs/SECURITY.md`](./docs/SECURITY.md).

## What it is

A single-operator, **localhost-first** power tool for a small expert team: dense, keyboard-driven (`⌘K`), optimised for
scanning, with sensitive scraped data that never leaves the machine. It listens on `127.0.0.1` only, keeps **no server
database** (the watchlist lives in the browser; a few deliberate files live under `~/.sud-tizimi`), and **never starts
work by itself**: loading, refreshing or switching pages never scrapes; work starts from a click or an opt-in setting.

It takes a **STIR** (9 digits), a PINFL, a case number or a kvitansiya and pulls what the Uzbek legal system knows from
`billing.sud.uz`, `jadval.sud.uz` / `jadvalapi.sud.uz`, `public.sud.uz`, `orginfo.uz` and `chamber.uz`. Requests go through
health-tracked Cloudflare Workers, with PoW / captcha solving, a TLS-fingerprint fallback and optional Tor for hostile endpoints.

## Looks

Settings › **Koʻrinish** picks one of two looks (light and dark are separate, `Animatsiya` in the sidebar overrides the
system's reduced-motion setting):

- **Premium** (default): a precise, technical identity in two colours, near-white and ink, in both themes. No accent hue; statuses
  are an ink dot and a word; IBM Plex Sans / Mono, tabular figures; animation (entrance, count-ups, charts that draw
  themselves, sliding indicators) lives in one file, `src/app/motion-premium.css`.
- **Moviy** (navy): the ORIGINAL navy-and-indigo app, restored in full (pizza chart, needle gauge, icon KPI cards, company
  cards, slide-over drawers). It is the old stylesheets scoped under `[data-look='navy']` plus the original markup brought back
  through `useLook()`; `docs/design-notes.md` › «Moviy» explains how it is kept faithful.

Everything is token-driven (`src/app/globals.css`, `prototype.css`, the look layers); there are no external fonts, scripts or CDNs.

## Features

**Home** (launcher): recently viewed and watched companies, refresh, *Tozalash* (clears searched companies only, never watched ones).
Search here or with `⌘K` from anywhere.

**Toʻlovlar** (bills): `billing.sud.uz` by STIR or a single kvitansiya; results stream in (PoW captcha → fetch → enrich) as receipts with
status, court and case links; the counters count up as they arrive. Excel export. A receipt opens its case.

**Sud ishlari** (cases): by STIR / PINFL / case number across economic, civil and administrative courts. The list can
be filtered by court type, side, outcome and text, exported to PDF / Excel, and a case opens in a detail panel that **docks beside the
list** (↑ ↓ / `k` `j` step through the rows; a slide-over on narrow screens). Click a case number to copy it.
- **Four instances**: first, appeal, cassation and **Taftish**, each with its **own court, judge, hearings and decision** (never the first
  instance's judge for all). The instance track follows the real procedure instead of a fixed chain: an instance that was skipped
  reads «Oʻtkazilgan» (the line jumps over it), a running filing window reads «N kun qoldi», a passed one «Berilmagan» (the court can
  restore a missed term), and the instance the case is in now is ringed.
- Published decisions (public.sud.uz) with PDF on click; petitions (nusxa olish, majlisni qoldirish, …) open in Hujjatlar pre-filled
  from the case.

**Majlislar** (hearings): scheduled hearings across court types, as date tiles with the countdown; a hearing in appeal / cassation /
taftish is found under the company's TIN too, with the right court and judge.

**Kompaniya**: `orginfo.uz` profile (address, director, status, capital, founders, OKED) and the `chamber.uz` contractor rating (0–100, AAA–D).

**Statistika**: win / lose / neutral / in progress judged from the company's side, one win-rate definition (won ÷ (won + lost)), trend
chart and an **outcome board**: a hero win rate, one strip of every case, four counts and a tile per court type or category. The counts
and the strip are **clickable**: «Jarayonda» opens Sud ishlari already filtered to those cases. Side-by-side company comparison.

**Kuzatuv** (watchlist): multi-company monitoring with hearings-due-soon alerts, kept in the browser (`localStorage`, keyed by STIR).

**Qarorlar** (published court orders): a local archive of the orders of the cases you care about (first instance, appeal, cassation,
Taftish; both the after-2024 and the pre-2024 systems). *Yuklangan / Yuklanmagan / Mavjud emas / Tozalangan* views, search by case
number, one-click download and open of the PDF. Orders come in through a case's *Tekshirish* or from **your own browser**: save a HAR
from DevTools and pick it in «HAR fayldan yuklash» (the app sends no request for this). Orders can be **removed from the lists**
(*Tozalash* for not-downloaded ones, *Oʻchirish* for downloaded ones): only the row goes; the record and the PDF stay and a click on
«Ochish» / «Qaytarish» brings them back. Details and rules: [`docs/orders.md`](./docs/orders.md).

**Hujjatlar** (documents): a `.docx` engine that fills templates from company / case data and your input, with a **live preview**
(form beside the real document, click a value on the page to jump to its field).
- Viza hujjatlari, Ichki ishlar, Tijorat siri, Sud arizalari, **Oʻz shablonlarim** (your own `.docx`, no code needed).
- Fill the shared fields once, switch between the documents of a category, download one, a **PDF**, or **a ZIP per category**; fill one
  document for many rows (*Jadvaldan*).
- **Three ways to write Uzbek**: the app's old Latin, the new 2026 Latin (`Gʻ Oʻ Sh Ch → Ğ Ö Ş Ç`) and, for the court petitions and the
  Uzbek talabnoma, **Cyrillic**; one converter, applied to the whole document.
- **Talabnoma** (from an *Akt sverka* `.xlsx`): detects every debtor contract, you pick which ones, and it generates a demand letter per
  contract with the penalty maths computed to the tiyin (0.4%/day, capped at 50% of the debt, inclusive delay days, 5-banking-day
  grace). Russian and Uzbek output; several contracts come back as a ZIP.

**Hisobot** (company report): a multi-page A4 PDF that follows the chosen look (an ink edition for Premium, the navy «Dossier» for Moviy)
with masthead, verdict, outcome board, attention list, case table, hearings and bills. It reuses the app's cache and never blocks on a
slow source: a source that fails is stated in place instead of printing a misleading zero. Page numbers need Chrome / Edge 131+.

**Sozlamalar**: *Koʻrinish*, *Yangilanishlar* (self-update from GitHub), *Workerlar* (Cloudflare Worker management and test), *Holat*
(health history per worker: today / 7 / 30 days / all), *Qarorlar*, *Captcha* (bring your own vision-model key for math captchas),
*Xavfsizlik* (what the app refused or did with privilege).

## Architecture

> **Important:** a persistent, stateful, multi-process service, *not* serverless. It relies on a long-lived Node process (in-memory
> caches, worker-health state), a `curl` child process for a TLS-fingerprint fallback and optional Tor / headless-Chrome side-processes.

```
Browser (SPA; client state: Zustand + a localStorage registry keyed by STIR)
   │  /api/*  (same-origin; every route guard()-wrapped: Host check → cross-site check → token → rate limit)
Next.js server ── src/sources + src/lib scrapers (billing, court-case, orginfo, chamber, stats, public-orders)
   │           ── worker pool + per-origin health ── in-memory caches
   │           ── document engine (JSZip .docx fill; pretenzia maths core; alphabet converter)
   ├─ curl (TLS-fingerprint fallback → jadval.sud.uz)
   ├─ Tor SOCKS5 (billing.sud.uz IP block)        } optional side-processes
   └─ headless Chrome (ihamkor.uz)                 }
        └── Cloudflare Worker pool (cloudflare-worker/proxy.js) → *.sud.uz / orginfo / chamber
```

On-disk state is deliberate and small, all under `~/.sud-tizimi` (published orders and their PDFs, worker-health history, daily company
snapshots) plus your own `vlm.json` and `templates/`. The client is same-origin (fonts self-hosted, no external scripts); a tight CSP and
the other security headers are set in `next.config.ts`.

## Getting started

**Prerequisites:** Bun (or Node 20+) · Git · curl · a free Cloudflare account for the proxy workers.

```bash
git clone https://github.com/nurmamatovhusanbek-create/sud.git
cd sud
bun install

# Cloudflare workers: dash.cloudflare.com → Workers & Pages → Create → paste cloudflare-worker/proxy.js → Deploy → copy the URL.
# Repeat for 3–4 workers. Use your OWN workers.

cp .env.example .env     # CF_WORKER_URLS, CF_WORKER_SECRET, …
bun run dev              # http://localhost:3000
```

Key variables (full list in `.env.example`; all read through `src/server/config.ts`):

| Variable | Purpose |
|---|---|
| `CF_WORKER_URLS` | Comma-separated list of your Cloudflare Worker URLs (or add them in Settings › Workerlar) |
| `CF_WORKER_SECRET` | Shared secret the app sends and `proxy.js` checks |
| `APP_API_TOKEN` | Bearer token guarding the app's own API routes (set it if the app is reachable by anyone else) |
| `VLM_API_KEY`, `VLM_BASE_URL` | Optional math-captcha reader; each user can instead paste their own key in Settings › Captcha (`~/.sud-tizimi/vlm.json`) |
| `NET_*` | Concurrency and spacing of outgoing requests |
| `PUBLIC_ORDERS_MIN_GAP_MS` | Spacing of requests to the court-orders API (default one every 10 s; the site's firewall blocks bursts) |

There is no `DATABASE_URL`: the app keeps no server database.

**Windows:** double-click `Sud.bat` (starts the app hidden, waits until the page answers, opens `http://localhost:3000`). Run it again for a
4-second menu: Open · Stop · Log · make a Desktop shortcut. The app stops by itself about a minute after the last window closes;
`Sud.bat keep` (or a plain `bun run dev`) keeps it running. Open it at `localhost`, not `127.0.0.1`: the browser keeps the watchlist per address.

**Verify:** open the app, search a STIR, confirm bills, cases and the profile load. Live scraping does not work from a sandbox; the UI
can be checked with mocked `/api/*` (see `AGENTS.md` §2).

## Scripts

```bash
bun run dev          # dev server on :3000 under a supervisor that restarts on crash
bun run dev:once     # the raw dev server (clean logs)
bun run build        # production build (standalone); types are enforced
bun run start        # the production standalone server
bun run typecheck    # tsc --noEmit
bun run lint         # eslint (0 problems expected)
bun test src/core src/lib src/server   # pure logic, scrapers (network mocked), security, route guards
bun run map          # regenerate docs/MAP.generated.md after moving files / routes / env vars
bun run map:check    # fail when that map is out of date
bun run ui:shots     # screenshot every screen (mocked data, fixed clock) and compare with the accepted run
```

## Configuration & security

- Secrets live in `.env` only. **Never commit credentials.** If a key was ever
  committed, rotate it and purge it from history.
- API routes are expensive (they drive live scraping) and every one goes through
  `guard()`. Set `APP_API_TOKEN` and keep rate-limiting on in production.
- Type safety is enforced at build time (`ignoreBuildErrors` is off). Run
  `bun run typecheck` before deploying.
- Security headers and CSP are defined in `next.config.ts`. The production CSP is
  stricter than dev (dev additionally allows `unsafe-eval` and `ws:` for HMR).

## Running it

This is a private tool for one operator: run it on your own computer. For a production-style run use `bun run build` and
`bun run start` (the standalone server, bound to `127.0.0.1`). Put it behind your own access control before exposing it anywhere else,
and set `APP_API_TOKEN`. On Linux `jadval.sud.uz` may return fewer cases than on Windows because of TLS-fingerprint differences.

## Project structure

```
src/
  app/            page.tsx · layout.tsx · globals.css · prototype.css · look-premium.css · look-navy.css · motion-premium.css · api/ (route handlers)
  components/
    shell/        app-shell (nav, bell) · command-palette (⌘K)
    sections/     bills · cases · hearings · profile · overview   (a company's tabs)
    views/        launcher · watchlist · orders-view · documents-view · doc-editor · pretenzia-view · settings-view …
    proto/        shared widgets: primitives (KPI, outcome board, gauges) · classic (the navy look's pizza and gauge) · drawer · date-tile · case-orders …
    company/ · ui/ · ui-custom/
  core/           pure domain: classify · status · rates · dates · hearing-pick · instance-track · public-orders · billing-format · pretenzia · uz-alphabet · schemas
  lib/
    documents/    template registry · fill (server + preview) · alphabet step · own templates
    pretenzia/ · report/ (company report) · public-orders/ (orders store, engine, pacing, HAR import) · net/ (workers, pacing, TLS repair)
    store/ · registry · enrich · look · motion · print · scrapers (billing, court-case, orginfo, chamber, stats)
  sources/        source adapters
  server/         config.ts · middleware (guard) · security
cloudflare-worker/  proxy.js (allow-listed proxy)
docs/               MAP.md · MAP.generated.md · design-notes.md · orders.md · SECURITY.md · public-sud-api.md · ui-split-plan.md · AUDIT.md
scripts/            supervisor.mjs · gen-map.mjs · ui-shots.mjs · doc-templates/
```

## License

Proprietary: internal tool. All rights reserved.
