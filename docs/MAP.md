# MAP — where things live, and what else you must touch

Read this file **first**, then open only the files it names. The generated companion
[`MAP.generated.md`](./MAP.generated.md) is the reverse index («who imports this file?»), route/env/storage/event
tables — `grep` it instead of reading source. Regenerate it with `bun run map` (CI-style check: `bun run map:check`).

Workflow for any change: **(1)** find the feature in §2 → **(2)** check §3 for duplicated logic you must change in
lockstep → **(3)** `grep "<file>" docs/MAP.generated.md` for the blast radius → **(4)** edit → **(5)** run the tests
named in §2 → **(6)** update the docs named in §6 → `bun run typecheck && bun run lint && bun test src/core src/lib src/server`.

## 1. Layers (imports only point downward)

```
components/  views · sections · shell · proto(UI kit) · company        ← React, 'use client'
   │  use
lib/ client half: api-client · registry · enrich · orders-watchlist · use-orders-job · use-registry · cache · store/app-store
   │  fetch('/api/*')  — the ONLY way client code reaches data (same-origin, CSP)
app/api/**/route.ts   every route = guard(handler, opts)   ← src/server/{middleware,security,config,envelope}.ts
   │
sources/index.ts      adapters (stats, company-info, court cases, upcoming hearings) — timing + zod shape check
   │
lib/ server half: stats · court-case · orginfo · chamber · billing · jadval… · public-orders/* · documents/* · report/*
   │  network
lib/net/worker-fetch.ts (scheduler: hedge, lanes, pins) · cf-worker-pool.ts (round-robin URLs) · health-registry.ts
   │
core/                 PURE functions (no I/O, no React): classify · rates · status · dates · billing-format · pretenzia ·
                      public-orders · translit · trend · envelope · schemas   ← unit-tested in core/__tests__
```
`core/` imports nothing from lib/components. `lib/*` server files never import components. Client files never import
`server/*` or server-only libs (`'server-only'` guards several).

## 2. Feature index — feature → files → tests → docs

| Feature | UI | Client lib | API route(s) | Server / core | Tests |
|---|---|---|---|---|---|
| **Shell / navigation / ⌘K** | `shell/app-shell`, `shell/command-palette` | `store/app-store` (`WORKSPACE_NAV`, `SectionKey`, `GlobalSurface`) | – | – | – |
| **Launcher (home)** | `views/launcher` | `registry`, `enrich` | `stats`, `upcoming-hearings`, `company-info` | – | `lib/__tests__/registry-hearings` |
| **Company header + report («Hisobot» PDF)** | `company/context-bar` | `report/generate` → `report/{model,render,doc,fonts}` | `stats`, `company-info` | `core/{rates,status,trend,dates}` | `report/__tests__`, `core/__tests__` |
| **Logo / brand mark** | `proto/brand-mark`, `shell/app-shell`, `proto/drawer` | – | – | `core/brand-mark` (also `lib/print`, `report/render`, `public/logo.svg`) | `core/__tests__/brand-mark` |
| **Gauges (rating, worker/overall health)** | `proto/primitives` (`Dial`, `WORKER_ZONES`, `HEALTH_ZONES`), `sections/profile`, `views/settings-view` | – | – | `proto/dial-geometry` (also used by `report/render`) | `core/__tests__/dial`, `report/__tests__` |
| **Overview / Statistika (pizza)** | `sections/overview`, `proto/primitives` (Pizza…), `proto/pizza-geometry` | – | `stats` | `lib/stats`, `core/classify`, `core/rates` | `core/__tests__/{classify,rates,pizza}` |
| **Sud ishlari (cases list + drawer)** | `sections/cases`, `proto/drawer`, `proto/case-orders` | `api-client` | `court-cases`, `court-cases/export` | `lib/court-case*`, `sources` | – |
| **Majlislar (hearings)** | `sections/hearings`, `views/watchlist` (alerts) | `registry` (`hearingMetaPatch`, `futureUpcoming`, `upcomingOf`) | `upcoming-hearings`(+export) | `sources` (upcoming) | `lib/__tests__/registry-hearings` |
| **To'lovlar (bills)** | `sections/bills`, `bills-helpers` | `bills-cache`, `hooks/use-stream` | `bills`(+export) | `lib/billing`, `core/billing-format` | `lib/__tests__/billing-search`, `net/__tests__` |
| **Kompaniya profili (orginfo + chamber)** | `sections/profile` | `api-client` | `company-info`, `company` | `lib/orginfo`, `lib/chamber` | `lib/__tests__/orginfo-fetch` |
| **Kuzatuv (watchlist)** | `views/watchlist`, `views/orders-control` | `registry`, `orders-watchlist` | – | – | – |
| **Published court orders (Qarorlar)** | `proto/case-orders`, `shell/orders-loader`, `shell/orders-auto-check`, `views/orders-control`, `views/orders-settings` | `orders-watchlist`, `use-orders-job`, `api-client` | `public-orders/{fetch,status,orders,file,cache}` | `lib/public-orders/*`, `core/public-orders` | `core/__tests__/public-orders`, `lib/public-orders/__tests__/*` — **details: [orders.md](./orders.md)** |
| **Documents (visa/IIO/court .docx)** | `views/documents-view`, `views/doc-editor`, `proto/doc-preview`, `proto/letterhead` | `api-client` | `documents/{generate,template}` | `lib/documents/{registry,fill.shared,fill.server,from-case}`, `core/translit` | `lib/documents/__tests__` |
| **Talabnoma (demand letters)** | `views/pretenzia-view` | `lib/pretenzia/{parse,render}` | `pretenzia/generate` | `lib/pretenzia/fill.server`, `core/pretenzia` | `core/__tests__/pretenzia` |
| **Settings (update, workers, health, orders panel)** | `views/settings-view`, `views/orders-settings` | `api-client` (`privilegedHeaders`) | `settings/*`, `tor-status` | `workers-config`, `health-registry`, `tor`, `version-server` | `server/__tests__/security` |
| **Themed PDF export** | – | `print` (`buildPrintDoc`) | – | – | – |
| **Security (host/CSRF/privileged)** | – | `api-client` headers | all | `server/{security,middleware,config}` | `server/__tests__/{security,routes}` — **[SECURITY.md](./SECURITY.md)** |

Style/tokens: `app/globals.css` (tokens, dark) + `app/prototype.css` (all component CSS: `.drawer*/.dw-*`, `.ccard`, `.kpis`,
`.orders-loader`, `.dedit*/.dprev*`, `.cband/.cnum`…). Never hardcode hex in components.

## 3. One concept, several places — change ALL of them

| Concept | Where it lives (every copy) | Rule |
|---|---|---|
| **Company status (active/liquidated)** | read: `stats.ts`(orginfo) → `enrich.ts` / `views/watchlist.tsx` `enrichCompany` / `sections/overview.tsx` / `sections/profile.tsx` → `registry` `meta.status`. Interpreted (regex) in `views/launcher.tsx` (`isKnownActive/Inactive`), `shell/command-palette.tsx` (`isKnownActive`), `company/context-bar.tsx` (`statusLabel`), `core/status.ts` (`companyStatusFamily`) | 4 interpreters: change wording in all. A missing status = «not read yet», never «inactive». Writers must not clobber a known value with undefined. |
| **Company enrichment (stats+hearings → registry meta)** | `lib/enrich.ts` (launcher refresh) **and** a local copy `enrichCompany` inside `views/watchlist.tsx` (throws, forced runs sequential) **and** `sections/overview.tsx` (~line 678) and `sections/hearings.tsx` (hearings only) | What they write: `cases`, `orderCases`, `winRate`, `status`, `rating`, `score`, `upcoming`+`nextHearing*`. Keep field sets identical; use `hearingMetaPatch` / `orderCasesPatch` from `registry.ts`. |
| **Upcoming hearings** | write: `hearingMetaPatch` (registry) from enrich/watchlist/hearings; read: `futureUpcoming`/`upcomingOf`/`daysUntilIso` in launcher KPI + card, `shell/app-shell` bell, `views/watchlist` alerts/list | Only hearings ≥ today count. An EMPTY server answer is never written (server swallows failures). One hearing per company was the old bug: always use the list. |
| **Win rate / outcome** | `core/rates.ts` (`winRate`), `core/classify.ts` (`classifyOutcome`) — imported by stats, overview, watchlist, enrich, report, pizza | Never re-inline. |
| **Order job case shape + signature** | `core/public-orders.ts` `orderJobCase` / `caseSignature` — used by `orders-watchlist.ts` and `sections/cases.tsx` | ONE shape or screens ping-pong «changed». |
| **Ongoing-first-instance rule** | `core/public-orders.ts` `isOngoingFirstInstance` — used by `company-job.ts` (`planCases`) and `sections/cases.tsx` (drawer note) | – |
| **Hearing date `dd.mm.yyyy` ordering** | `sections/cases.tsx` (`hearingKey`, `pickUpcoming`), `core/dates.ts`, `sources/index.ts` (upcoming iso) | Never compare as strings. |
| **Court-type names** | `lib/court-case-types.ts` (`CourtType`), `lib/stats.ts` (`COURT_TYPE_MAP`, `StatsCourtType`), `core/public-orders.ts` (`PUBLIC_COURT_OF` → ECONOMIC/CIVIL/ADMINISTRATIVE) | lowercase in the app, UPPERCASE for the public library. |
| **Money / Uzbek formatting** | `core/billing-format.ts` (tiyin math, words), `core/dates.ts`; UI `sections/bills-helpers.ts` | Not `toLocaleString`. |
| **Auth / privileged headers** | `lib/api-client.ts` `authHeaders()` / `privilegedHeaders()`; server `server/middleware.ts` `guard` | Every client fetch to `/api` sends `authHeaders()`; dangerous doors add `x-sud-action`. |
| **Worker routing (3 paths)** | (a) `lib/net/worker-fetch.ts` scheduler (hedged, lanes, pinned captcha) — billing, chamber, court-case; (b) `cf-worker-pool.ts` `createWorkerPool().nextProxyUrl` round-robin — orginfo (worker first, then direct fallback); (c) `court-case.ts` races workers itself via `OriginHealthPool`. Public orders: direct by default (`PUBLIC_ORDERS_VIA_WORKERS=1` → (a)) | Don't hedge token-consuming calls (billing search). `cloudflare-worker/proxy.js` must allow every host. |
| **localStorage registry** | `lib/registry.ts` (`sud-registry-v1`); event `sud:registry-changed`; hook `use-registry.ts` | All meta writes go through `patchMeta`. |
| **Server status of the orders queue** | `lib/public-orders/company-job.ts` (globalThis holder) → `/status` → `lib/use-orders-job.ts` (ONE shared poll) → pill / Kuzatuv / Settings / case list | Add consumers via the hook, never a new poll. |

## 4. State & pools — where data lives

| Store | Lifetime | Key / holder | Who writes |
|---|---|---|---|
| Browser `localStorage` | permanent | `sud-registry-v1` (companies+meta), `sud-orders-auto` (idle switch, default off), `sud-orders-auto-last`, `sb-cache-v168:*` (5-min response cache, `lib/cache.ts`; partial answers are not cached) | registry / orders-watchlist / use-resource |
| Browser `sessionStorage` | tab session | `sud-orders-pill-hidden` (run id whose pill was hidden) | orders-loader |
| Zustand `app-store` | page | active company, section, surface, `docPrefill` | components |
| Server memory (`globalThis`) | process | `__publicOrdersJob` (queue), health pools (`__sudHealthPools`, live cooldowns only), `__sudHealthStore` (request history, mirrored to disk), metrics | company-job / cf-worker-pool / health-store |
| Worker health history (disk) | `~/.sud-tizimi/worker-health.json` (0600; `WORKER_HEALTH_FILE`) | hourly buckets 35 d → daily buckets forever + last 300 raw records per worker×origin; flushed every 15 s and on exit | `lib/health-store` (server) · `lib/health-span` (pure, also read by Settings) · `/api/settings/health` |
| Server module caches | TTL | stats 60 s (`stats.ts`), court cases 10 min (`court-case.ts`), orginfo TIN 24 h (`orginfo.ts`), bill status 3 min, `middleware.coalesce` (in-flight only), rate-limit buckets | libs |
| Disk (outside repo) | permanent, **never deleted by the app** | `~/.sud-tizimi/public-orders/{shards,checked.jsonl}` (`PUBLIC_ORDERS_DIR`) | `public-orders/store.ts` |
| Disk (repo) | – | `workers.json` (worker URLs, via settings), `.sud-restart` sentinel, `dev.log` | workers-config / update route |

Custom events, storage keys, env vars, holders: full tables in `MAP.generated.md`.

## 5. Change recipes

| You are asked to… | Touch | Also |
|---|---|---|
| Add an API route | copy a sibling; wrap in `guard()`; `runtime='nodejs'`, `dynamic='force-dynamic'`; client function in `api-client.ts` (send `authHeaders()`) | `bun run map`; `routes.test.ts` fails if unguarded. Dangerous action → `{privileged:true}` + `privilegedHeaders()` + add to `PRIVILEGED` in `routes.test.ts`. |
| Show a new company field on cards | write it in ALL enrichment copies (§3) + `CompanyMeta` in `registry.ts` | launcher `CompanyCard`, watchlist card |
| Change a status/outcome rule | `core/*` + its test | check the 4 status interpreters (§3) |
| Add a new persistent client value | `registry.ts` meta (per company) or a `sud-*` localStorage key (per browser) | list in MAP.generated (auto) |
| Add a background job | never start on load/refresh: DETECT is free (`plan`), SCRAPE only from a click or the opt-in idle check; pill only while running | [orders.md](./orders.md) rules |
| Add an env var | read via `server/config.ts` (typed) | `.env.example`; `bun run map` |
| Add/rename a `.docx` template | `documents/registry.ts` fields ⇄ `{{key}}`s; `next.config.ts` `outputFileTracingIncludes` | `scripts/doc-templates/verify-templates.mjs` |
| Uzbek UI text | native phrasing, `ʻ/ʼ`, «», no em dash | – |
| Move/rename files | fix imports | `bun run map` (index goes stale otherwise) |

## 6. Docs to keep in sync

`AGENTS.md` (rules, short) · this file (structure, §3 duplication table) · `MAP.generated.md` (`bun run map`) ·
`orders.md` (orders feature) · `SECURITY.md` (threat model) · `public-sud-api.md` (upstream API facts) · `README.md` (product).
