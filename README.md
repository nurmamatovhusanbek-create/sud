<div align="center">

# Sud tizimi · by Nurmamatov

**A legal-intelligence workspace for Uzbekistan** — aggregates court cases, payment
receipts, hearings, company profiles and contractor ratings from government portals,
and turns them into ready-to-file `.docx` and themed PDF documents, all from a
single company-centric console.

Next.js 16 · React 19 · TypeScript · Tailwind v4 · Bun · Plus Jakarta Sans / IBM Plex Mono

</div>

> **New here? Read [`AGENTS.md`](./AGENTS.md) first.** It maps the whole codebase by
> concern (code · UI · documents · scraping · security) so you — human or agent —
> can find the right place to make a change and understand *why* it is built the way
> it is.

## Overview

Sud tizimi takes a company's **STIR** (9-digit tax ID) — or a PINFL, case number or
kvitansiya — and pulls everything the Uzbek legal system knows about it from
`billing.sud.uz`, `jadval.sud.uz`, `orginfo.uz`, `chamber.uz` and related portals.
Requests are proxied through health-tracked Cloudflare Workers so the operator's IP is
never exposed, with PoW/captcha solving, a TLS-fingerprint bypass, and Tor fallback for
hostile endpoints.

It is a desktop power tool for a small expert team: dense, keyboard-driven (`⌘K`),
localhost-first, and optimized for scanning. Everything a company touches — bills,
cases, hearings, profile, rating — lives on one screen, and the documents you'd normally
draft by hand (demand letters, court motions, visa/IIO packets) are generated from that
same data.

**Design note.** The interface runs the "Sud Signal" design system — one brand hue
(indigo → blue) over a navy ink and an indigo canvas, with color used *semantically*:
green for won/paid, rose for lost/overdue, brand blue for pending/info (no orange).
Type is Plus Jakarta Sans for UI and IBM Plex Mono for figures. Everything is
token-driven (`src/app/globals.css` + `prototype.css`, bridged to Tailwind v4 via
`@theme inline`) and fully dark-mode aware (`data-theme` on `<html>`, via `next-themes`).

## Features

**Home / Launcher** — the landing surface: recently viewed and watched companies as
cards, with per-card refresh, refresh-all, and *Tozalash* (clears searched companies
only, never the watched ones). Search from here or `⌘K` anywhere.

**Toʻlovlar (Bills)** — search `billing.sud.uz` by STIR or single kvitansiya; results
stream in progressively (PoW captcha → fetch → enrich) and render as styled receipts
with full payment status, court and case links. Excel export.

**Sud ishlari (Cases)** — search by STIR / PINFL / case number across economic, civil
and administrative courts. Full case detail: judge, hearings timeline, decisions and
appellate/cassation instances, with plaintiff/defendant cross-links (party STIRs are
resolved by name against `orginfo`). App-themed PDF export.

**Majlislar (Hearings)** — monitor scheduled hearings across three court types; each
renders as a docket ticket linked to its case.

**Kompaniya (Profile)** — company profile from `orginfo.uz` (address, director, status,
capital, founders, OKED) plus the `chamber.uz` contractor rating (0–100 score, AAA–D).

**Statistika (Overview)** — win/lose/pending classification, trend chart, and the
interactive "pizza" chart (by court type or case category) that breaks the total into
its four statuses. Plus win-rate by court and side-by-side company comparison.

**Kuzatuv (Watchlist)** — multi-company monitoring with hearings-due-soon alerts,
persisted client-side (localStorage registry, keyed by STIR).

**Hujjatlar (Documents)** — a document engine that fills `.docx` templates from the
company/case data and your input:
- **Viza hujjatlari, Ichki ishlar, Sud arizalari** — form-driven letters and motions;
  fill the shared fields once, generate every document in the category; each supports a
  letterhead/header picker.
- **Talabnoma (akt-sverka asosida)** — upload an *Акт сверки* `.xlsx`, the app detects
  every debtor contract, you pick which ones, and it generates a demand letter per
  contract with the penalty math auto-computed to the tiyin (0.4%/day, capped at 50% of
  the debt, inclusive delay-day count, 5-banking-day grace). **Russian and Uzbek** output
  via a language switch at the end of the flow; multiple contracts come back as a ZIP.

**Sozlamalar (Settings)** — self-update from GitHub, Cloudflare Worker management, and a
live health dashboard (per-worker success gauges, sparklines, request timelines).

## Architecture

> **Important:** this is a persistent, stateful, multi-process service — *not*
> serverless. It relies on a long-lived Node process (in-memory caches + worker-health
> state), a `curl` child process for a TLS-fingerprint bypass, and optional Tor /
> headless-Chrome side-processes. Deploy to a VM / Render / Fly / self-host — **not**
> Vercel/edge.

```
Browser (SPA, client-only state: Zustand + localStorage registry)
   │  /api/*  (same-origin; guarded: bearer auth → per-IP rate-limit → coalesce)
Next.js server ── src/sources + src/lib scrapers (billing, court-case, orginfo,
   │              chamber, jadval2, stats)
   │           ── proxy pool + per-origin worker health ── in-memory caches
   │           ── document engine (JSZip .docx fill; pretenzia math core)
   ├─ curl (TLS-fingerprint bypass → jadval.sud.uz)
   ├─ Tor SOCKS5 (billing.sud.uz IP block)        } optional side-processes
   └─ headless Chrome (ihamkor.uz)                 }
        └── Cloudflare Worker pool (cloudflare-worker/proxy.js) → *.sud.uz / orginfo / chamber
```

The whole client is same-origin (API on `/api`, fonts self-hosted by `next/font`, no
external scripts). Response security headers (a tight CSP, `X-Frame-Options: DENY`,
`nosniff`, `Referrer-Policy`, `Permissions-Policy`, `noindex`) are set in
`next.config.ts`; API responses are `Cache-Control: no-store`.

## Getting started

**Prerequisites:** Node 18+ or Bun · Git · curl (preinstalled on Windows 10+/Linux/macOS)
· a free Cloudflare account (for the proxy workers).

```bash
# 1. Clone & install
git clone https://github.com/nurmamatovhusanbek-create/sud.git
cd sud
bun install                    # or: npm install

# 2. Deploy the Cloudflare Worker proxy
#    dash.cloudflare.com → Workers & Pages → Create → paste cloudflare-worker/proxy.js
#    → Deploy → copy the URL. Repeat for 3–4 workers. Use your OWN workers.

# 3. Configure the environment (all knobs read through src/server/config.ts)
cp .env.example .env

# 4. Run
bun run dev                    # http://localhost:3000
```

Key env variables (see `.env.example` for the full list):

| Variable | Purpose |
|---|---|
| `CF_WORKER_URLS` | Comma-separated list of your Cloudflare Worker URLs |
| `CF_WORKER_SECRET` | Shared secret the app sends and `proxy.js` checks |
| `APP_API_TOKEN` | Bearer token guarding the app's own API routes (**required in production**) |
| `VLM_API_KEY` | Captcha-solver (VLM) key — rotate any previously committed key |
| `CACHE_BACKEND`, `CACHE_TTL_*` | `memory` (single-node) or `kv` (multi-node) + TTLs |
| `ALERT_WINDOW_DAYS` | "Hearings due soon" window for watchlist alerts |

There is no `DATABASE_URL` — the app keeps no server database. Watchlist/registry state
lives in the browser (`localStorage`).

**Verify:** open the app, search STIR `302678824`, confirm bills, cases and profile load.

## Scripts

```bash
bun run dev         # dev server on :3000 (via a supervisor that restarts on crash)
bun run build       # production build (standalone) — enforces types
bun run start       # run the production standalone server
bun run lint        # eslint
bun run typecheck   # tsc --noEmit (type errors are NOT suppressed)
bun test src/core   # pure-core unit tests (classification, status, pizza, pretenzia math)
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

## Deployment

Target a persistent host (Render / Fly / a VM). Add your env vars, build, and run the
standalone server:

```bash
bun run build
NODE_ENV=production bun .next/standalone/server.js
```

Keep the app warm (e.g. an uptime pinger on free tiers). On Linux, `jadval.sud.uz` may
return fewer cases than on Windows due to TLS-fingerprint differences; other sources are
unaffected.

## Project structure

```
src/
  app/            page.tsx · layout.tsx · globals.css · prototype.css · api/ (route handlers)
  components/
    shell/        app-shell (nav) · command-palette (⌘K)
    sections/     bills · cases · hearings · profile · overview
    views/        launcher · watchlist · documents-view · pretenzia-view · settings-view
    proto/        shared prototype-styled widgets (e.g. letterhead picker)
    company/ · ui/ · ui-custom/
  core/           pure domain: classify · status · billing-format · pretenzia (math) · schemas · __tests__
  lib/
    documents/    template registry + server-side .docx fill + templates/*.docx
    pretenzia/    xlsx parse (client) · render values · fill.server (docx + ZIP)
    store/        Zustand app-store (nav/surface state)
    net/ · domain/ · registry · enrich · print (themed PDF) · scraper libs (billing, court-case, …)
  sources/        source adapters
  server/         config.ts (typed env surface)
  infra/ · hooks/
cloudflare-worker/  proxy.js (allow-listed CORS proxy)
scripts/            supervisor.mjs (dev/start) · doc-templates/ (build & verify .docx templates)
```

## License

Proprietary — internal tool. All rights reserved.
