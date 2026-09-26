# AGENTS.md — guide for the next agent (or developer)

You're about to change **Sud tizimi**. This file tells you *where* things live and,
more importantly, *why* they're built the way they are — so you can pick up a request,
land it in the right place, and not re-break things that were hard to get right.

Read the [`README.md`](./README.md) for the product picture. This file is the map for
making changes.

---

## 0. First principles (don't fight these)

- **Localhost-first, single operator.** This is a private power tool, not a public app.
  It handles sensitive scraped legal/financial data. Bias toward "useful and dense for
  one expert" over "friendly for the public".
- **The client is 100% same-origin.** All data comes through `/api/*` (same host).
  Fonts are self-hosted by `next/font`. There are **no external scripts, no CDNs, no
  third-party trackers**. Keep it that way — the tight CSP in `next.config.ts` depends
  on it, and it's the app's main security control.
- **No server database.** Server state is in-memory only (caches + worker health).
  Anything that must persist across page loads lives in the **browser** (`localStorage`
  registry, keyed by STIR). Don't add a DB unless the owner asks.
- **Types are enforced.** `ignoreBuildErrors` is `false`. If `bun run typecheck` is red,
  the build is broken — fix the file, don't suppress.
- **Uzbek is the UI language.** Use native Uzbek phrasing and the correct typography:
  `oʻ`/`gʻ` use the tutuq belgisi `ʼ`/`ʻ` (not straight apostrophes), guillemets `«»`
  for quotes, no em dash. Money and dates use the app's own formatters, not `toLocaleString`.

## 1. Always verify before you finish

```bash
bun run typecheck      # must be clean — types are enforced at build time
bun run lint           # must be 0 problems
bun test src/core      # pure-core math/logic tests (pretenzia penalty, classify, status, pizza)
```

**Live scraping does not work in a sandbox** (the sud.uz / orginfo endpoints are
blocked, and the Cloudflare workers aren't configured). To verify UI or flows that need
data, **seed `localStorage`** via Playwright `page.addInitScript`, **mock the API** with
`page.route(...).fulfill()`, or render a component against fixture data — don't conclude
a feature is broken just because a live fetch failed here. Playwright + Chromium are
preinstalled (`/opt/pw-browsers/...`); never run `playwright install`.

---

## 2. Where to make a change — grouped by concern

### 🧩 CODE — domain logic & data layer

| You want to… | Go to | Why / notes |
|---|---|---|
| Change how cases are won/lost/pending, or the pizza breakdown | `src/core/classify.ts`, `src/core/status.ts` | **Pure functions, unit-tested.** Add/adjust a test in `src/core/__tests__/`. Keep them side-effect-free. |
| Change money/date formatting or number-to-words | `src/core/billing-format.ts`, `src/core/pretenzia.ts` | Money is in **tiyin** (1 sum = 100 tiyin) for exact integer math. RU *and* UZ number-to-words live here (UZ "ming" drops "bir"). |
| Change the penalty / demand-letter math | `src/core/pretenzia.ts` (`computeClaim`, `delayDays`, `paymentClause`) | 0.4%/day, capped at 50% of debt, **inclusive** delay-day count, 5-banking-day grace. Golden-tested against real letters — update the test if you change a rule. |
| Change the API request/response envelope or validation | `src/core/envelope.ts`, `src/core/schemas/`, `src/lib/api-types.ts` | Zod schemas define the shape crossing `/api`. |
| Change client-side state (which section/surface is shown) | `src/lib/store/app-store.ts` (Zustand) | `WORKSPACE_NAV` and `SectionKey` live here. |
| Change the watchlist / recently-viewed registry | `src/lib/registry.ts`, `src/lib/use-registry.ts`, `src/lib/enrich.ts` | localStorage `sud-registry-v1`. Writes dispatch `sud:registry-changed`; `useRegistryVersion` re-renders on it. `enrichCompany(stir, force)` refreshes stats+hearings. |

### 🎨 UI — components & design system

| You want to… | Go to | Why / notes |
|---|---|---|
| Touch the shell / navigation / ⌘K | `src/components/shell/app-shell.tsx`, `command-palette.tsx` | Nav is `WORKSPACE_NAV` + the "Tizim" group (Hujjatlar, Sozlamalar). |
| Edit a data section | `src/components/sections/` (`bills`, `cases`, `hearings`, `profile`, `overview`) | |
| Edit a full-surface view | `src/components/views/` (`launcher`, `watchlist`, `documents-view`, `pretenzia-view`, `settings-view`) | The launcher is the home surface. |
| Change colors, spacing, tokens, dark mode | `src/app/globals.css` + `src/app/prototype.css` | **Token-driven.** Define colors as CSS variables; the theme switches on `data-theme` on `<html>` (via `next-themes`, `defaultTheme=light`, `enableSystem=false`). Don't hardcode hex in components. |
| Lay out a responsive card grid | reuse the `.kpis` / `.ccards` breakpoints | **Grid gotcha (learned the hard way):** `repeat(N, 1fr)` = `minmax(auto, 1fr)`, so non-wrapping content (company names, STIRs) forces horizontal overflow off-screen. Use `minmax(0, 1fr)` **and** `min-width: 0` on the items. |
| Add a "themed PDF" export | `src/lib/print.ts` | `buildPrintDoc(title, body, dark)` renders an app-themed sheet that adapts to the active theme; uses `print-color-adjust: exact` so brand colors survive "Save as PDF". |

**Two UI rules the owner has stated explicitly — honor them:**
- **No "choosing glow" / no inner (inset) glow.** Don't add hover background-glows on
  clickable sections or `inset` accent shadows on focus. Plain, crisp focus states only.
- **"Less info is useful info."** Prefer compact cards. When adding a card, match the
  existing tile sizes (doc tiles / KPI cards), don't invent a bigger one.

### 📄 DOCUMENTS — the `.docx` engine

The app fills Word templates server-side and streams them back.

| You want to… | Go to | Why / notes |
|---|---|---|
| Add/edit a form-driven document (visa, IIO, court) | `src/lib/documents/registry.ts` | Declares each document (id, template, fields) and each category (label, shared field groups). Fields render automatically in `documents-view.tsx`. |
| Change how templates are filled | `src/lib/documents/fill.server.ts` | Trivial `{{key}}` string replace inside `word/document.xml` via JSZip. |
| Work on the **Talabnoma** (akt-sverka → demand letters) flow | `src/lib/pretenzia/` (`parse.ts` client xlsx reader · `render.ts` values · `fill.server.ts`) + `src/components/views/pretenzia-view.tsx` + API `src/app/api/pretenzia/generate/route.ts` | `parse.ts` reads the xlsx client-side and finds debtor contracts; `render.ts` builds RU/UZ values; `fill.server.ts` picks the template by language (`pretenzia.docx` / `talabnoma-uz.docx`), fills, and returns one `.docx` or a ZIP. |
| Build or repair a `.docx` template | `scripts/doc-templates/` (`build-*.mjs`, `verify-templates.mjs`) → outputs to `src/lib/documents/templates/` | **Placeholders get split across XML runs by Word.** The build scripts do "span surgery": collapse run-fragmented `{{key}}` back into a single run so the fill step can replace it. Run `verify-templates.mjs` after building — it checks every placeholder is present and reachable. Don't hand-edit the binary `.docx`. |
| Add a letterhead/header image picker | `src/components/proto/letterhead.tsx` | Shared `useLetterhead()` hook + `LetterheadRow`; swaps `word/media/image1.png` (blank transparent PNG / uploaded / keep template's). Reused by both the visa docs and Talabnoma. |

Both document APIs need their templates traced into the standalone build —
see `outputFileTracingIncludes` in `next.config.ts`. If you add a template a route
reads at runtime, add it there too or production won't find it.

### 🌐 SCRAPING — sources, network, workers

| You want to… | Go to | Why / notes |
|---|---|---|
| Fix/extend a scraper | `src/lib/billing.ts`, `court-case.ts`, `orginfo.ts`, `chamber.ts`, `jadval2`, `stats.ts` (+ `src/sources/`) | These were ported carefully; match upstream shapes and keep them typed. `court-case` party STIRs aren't returned by the API — they're resolved by name against `orginfo` (see the `PartyRow` pattern in `cases.tsx`). |
| Change proxying / worker health / Tor | `src/lib/cf-worker-pool.ts`, `health-registry.ts`, `workers-config.ts`, `tor.ts` | Requests go through health-tracked Cloudflare Workers so the operator IP is never exposed. Workers are the owner's own (`CF_WORKER_URLS`); never wire in third-party fallbacks. |
| Add/adjust an API route | `src/app/api/**/route.ts` | Every route must call `guard()` (bearer auth → per-IP rate-limit → coalesce) and set `runtime='nodejs'` + `dynamic='force-dynamic'`. Copy an existing route as the template. |

### 🔒 SECURITY

`next.config.ts` owns the headers: a tight **CSP** (only relaxed in dev for HMR:
`unsafe-eval`, `ws:`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
`Permissions-Policy`, COOP, `X-Robots-Tag: noindex`, and `Cache-Control: no-store` on
`/api/*`. If you add an external origin (script, image, font, fetch), the CSP will
block it — the correct move is almost always to **bring it same-origin** (self-host it),
not to loosen the CSP. `guard()` on every API route is the second layer. `APP_API_TOKEN`
is required in production.

---

## 3. Conventions & gotchas that will bite you

- **Lint — React Compiler advisory rules are intentionally off** (`eslint.config.mjs`:
  `set-state-in-effect`, `refs`, `use-memo`, `exhaustive-deps`, `purity`,
  `react-compiler`). They flag *correct* patterns here (hydration guards like
  `useEffect(() => setHydrated(true), [])`, and `useRef(fn).current` memoization). Don't
  "fix" those patterns to appease a rule; don't re-enable the rules.
- **`useSyncExternalStore` snapshots must be stable** — never return a fresh object per
  call (it spins into an infinite re-render). See `useTabCountsSafe` in `app-shell.tsx`
  for the cached-snapshot pattern.
- **Hydration:** `reactStrictMode` is off on purpose (double-invoke would double real
  scrapes). Re-enable only after request de-duplication exists.
- **Stale `.next` types** can break `typecheck` after you delete a page/route. Clear with
  `rm -rf .next/dev/types .next/types` and re-run.
- **Never commit secrets.** Network captures the owner pastes may contain live cookies
  or keys — read them, act on them, but never store or commit them.
- **`bun run dev` runs under a supervisor** (`scripts/supervisor.mjs`) that restarts on
  crash; `dev:once` / `start:once` run the raw server if you need clean logs.

---

## 4. Git workflow

- Develop on the branch the owner names for the task (currently
  `claude/gifted-volta-d1wpww` on `nurmamatovhusanbek-create/sud`). Create it from the
  latest default branch if it doesn't exist.
- Commit with clear, scoped Conventional-Commit messages
  (`feat(pretenzia): …`, `fix(launcher): …`, `chore(lint): …`).
- Push with `git push -u origin <branch>`. **Don't open a PR unless asked.** The owner
  runs locally (`bun run dev` on Windows) and fast-forwards `main` themselves.
- If the branch's PR was already merged, restart the branch from the latest default
  branch for follow-up work — don't stack new commits on merged history.
