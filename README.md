<div align="center">Sud Billing Lookup
A legal-intelligence platform for Uzbekistan — aggregates court cases, payment receipts, hearings, company profiles, and contractor ratings from government portals into one company-centric workspace.
Next.js 16 · React 19 · TypeScript · Tailwind v4 · shadcn/ui
</div>

Overview
Sud Billing Lookup takes a company's STIR (9-digit tax ID) and pulls everything the Uzbek legal system knows about it — payment receipts, court cases with full history, upcoming hearings, the company profile, and its contractor rating — from billing.sud.uz, jadval.sud.uz, orginfo.uz, chamber.uz and related portals. Requests are proxied through health-tracked Cloudflare Workers so the operator's IP is never exposed, with PoW/captcha solving, a TLS-fingerprint bypass, and Tor fallback for hostile endpoints.
It is a desktop power tool for a small expert team: dense, keyboard-driven, and optimized for scanning.

Design note. The interface is being rebuilt under the "Monochrome Signal" design system — a monochrome chrome where color appears only to signal status (paid/overdue, win/lose, healthy/dead). The full redesign spec, tokens, and an interactive prototype live in docs/.

Features
Toʻlovlar (Bills) — search billing.sud.uz by STIR or single kvitansiya; results stream in progressively (PoW captcha → fetch → enrich) and render as styled receipts with full payment status, court, and case links. Excel export.
Sud ishlari (Cases) — search by STIR / PINFL / case number across economic, civil, and administrative courts. Full case detail: judge, hearings timeline, decisions, and appellate/cassation instances, with plaintiff/defendant cross-links. PDF export.
Sud majlislari (Hearings) — monitor scheduled hearings across three court types; each renders as a docket ticket linked to its case.
Kompaniya (Profile) — company profile from orginfo.uz (address, director, status, capital, founders, OKED) plus the chamber.uz contractor rating (0–100 score, AAA–D category).
Statistika (Overview) — win/lose/pending classification, trend chart, outcome donut, win-rate by court, and side-by-side company comparison.
Kuzatuv (Watchlist) — multi-company monitoring with hearings-due-soon alerts.
Settings — self-update from GitHub, Cloudflare Worker management, and a live health dashboard (per-worker success gauges, sparklines, request timelines).

Architecture
Important: this is a persistent, stateful, multi-process service — not serverless. It relies on a long-lived Node process (in-memory caches + worker-health state), a curl child process for a TLS-fingerprint bypass, and optional Tor / headless-Chrome side-processes. Deploy to a VM / Render / Fly / self-host, not Vercel/edge functions.

Browser (SPA)
   │  /api/*
Next.js server ── lib/ scrapers (billing, court-case, orginfo, chamber, jadval2)
   │              ── proxy pool + per-origin worker health  ── in-memory caches
   ├─ curl (TLS-fingerprint bypass → jadval.sud.uz)
   ├─ Tor SOCKS5 (billing.sud.uz IP block)          } optional side-processes
   └─ headless Chrome (ihamkor.uz)                   }
        └── Cloudflare Worker pool (cloudflare-worker/proxy.js) → *.sud.uz / orginfo / chamber

Getting started

Prerequisites
Node 18+ or Bun
Git, curl (preinstalled on Windows 10+, Linux, macOS)
A free Cloudflare account (for the proxy workers)

1. Clone & install
git clone https://github.com/nurmamatovhusanbek-create/sud-billing-lookup.git
cd sud-billing-lookup
bun install        # or: npm install

2. Deploy the Cloudflare Worker proxy
Create a Worker at dash.cloudflare.com → Workers & Pages → Create, paste the contents of cloudflare-worker/proxy.js, and Deploy. Copy its URL. Repeat for 3–4 workers for load-balancing. Use your own workers — do not rely on third-party fallbacks.

3. Configure the environment
Copy the template and fill it in. All settings are read through src/server/config.ts.
cp .env.example .env

Key variables:
Variable | Purpose
---|---
CF_WORKER_URLS | Comma-separated list of your Cloudflare Worker URLs
CF_WORKER_SECRET | Shared secret the app sends and proxy.js checks
APP_API_TOKEN | Bearer token guarding the app's own API routes (required in production)
VLM_API_KEY | Captcha-solver (VLM) key — rotate any previously committed key
RETRY_TIERS_MS, DEFAULT_TIMEOUT_MS, WORKER_DEAD_* | Resilience tuning
CACHE_BACKEND, CACHE_TTL_* | memory (single-node) or kv (multi-node) + TTLs
ALERT_WINDOW_DAYS | "Hearings due soon" window for watchlist alerts

See .env.example for the full list. There is no DATABASE_URL — the app is stateless (Prisma was removed).

4. Run
bun run dev        # http://localhost:3000

Verify
Open the app, search STIR 302678824, and confirm bills, cases, and profile load.

Scripts
bun run dev         # dev server (port 3000)
bun run build       # production build (standalone) — enforces types
bun run start       # run the production server
bun run lint        # eslint
bun run typecheck   # tsc --noEmit (type errors are NOT suppressed)

Configuration & security
Secrets live in .env only. Never commit credentials. If a key was ever committed, rotate it and purge it from history.
API routes are expensive (they drive live scraping). Set APP_API_TOKEN and keep rate-limiting on in production.
Type safety is enforced at build time (ignoreBuildErrors is off). Run bun run typecheck before deploying.

Deployment
Target a persistent host (Render / Fly / a VM). Add your env vars, build, and run the standalone server:
bun run build
NODE_ENV=production bun .next/standalone/server.js

Keep the app warm (e.g. an uptime pinger on free tiers). On Linux, jadval.sud.uz may return fewer cases than on Windows due to TLS-fingerprint differences; all other sources are unaffected.

Project structure
src/
  app/            page.tsx (UI) · layout.tsx · api/ (route handlers)
  components/     ui-custom/ · settings/ · shared/ (+ shadcn ui/)
  lib/            billing · court-case · orginfo · chamber · jadval2 · stats · court-map
                  cf-worker-pool · health-registry · workers-config · tor · cache
  server/         config.ts  (typed env surface)
cloudflare-worker/ proxy.js   (allow-listed CORS proxy)
docs/             the rebuild kit (see below)

The rebuild kit (docs/)
This repo ships a complete, phased plan to rebuild the system — safety, architecture, and UI — with guidance an agent (or a developer) can execute end-to-end:
File | What it is
---|---
SUD-00-MASTER-PLAN.md | Start here — the execution order (P0→P7) and how the docs fit together
SUD-SYSTEM-REBUILD-BLUEPRINT.md | Whole-system audit + target architecture (every layer)
SUD-CODE-ARCHITECTURE-GUIDE.md | Client/data-layer refactor (store, typed API client, useResource, states)
SUD-REDESIGN-GUIDE.md + sud-design-tokens.css | The Monochrome Signal UI spec + ready-to-use design tokens
sud-prototype.html | Interactive target UI — open in a browser
SUD-UZBEK-TEXT-GUIDE.md | Native-Uzbek phrasing & typography (oʻ/gʻ=ʻ, tutuq=ʼ, «», no em dash)
P0-RUNBOOK.md + p0-hardening.patch | The security/build-safety first commit

Roadmap
P0 security & config → P1 pure tested core → P2 infra toolkit → P3 source adapters → P4 server envelope → P5 client data layer → P6 UI overhaul → P7 ops. See the master plan for details and acceptance criteria.

License
Proprietary — internal tool. All rights reserved.
