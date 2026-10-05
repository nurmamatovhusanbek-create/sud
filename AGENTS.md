# AGENTS.md — start here

**Sud tizimi**: a private, localhost, single-operator Next.js app that looks up Uzbek companies, court cases, bills,
published court orders and fills legal documents. This file is the *rules*; the *map* is `docs/`.

## 0. Work fast: read the map, not the code

1. Open **`docs/MAP.md`** (≈10 KB): layers, feature → files → tests, «one concept in several places», state/pools, change recipes.
2. `grep` **`docs/MAP.generated.md`** for the file you will change → who imports it (blast radius), tests that cover it, routes, env vars, storage keys, events.
3. Open only the files those name (use `Read` with `offset`/`limit`; don't read whole big files: `sections/cases.tsx`, `settings-view.tsx`, `court-case.ts`, `billing.ts` are large).
4. Area-specific *why*: `docs/design-notes.md` (pizza, report, drawer, documents, scraping…), `docs/orders.md` (published orders), `docs/SECURITY.md`, `docs/public-sud-api.md`.
5. After moving/adding files, routes, env vars, storage keys or events: **`bun run map`** and commit `docs/MAP.generated.md`.

## 1. First principles (don't fight these)

- **Localhost-first, single operator.** Private power tool with sensitive scraped data: dense and useful for one expert over friendly for the public.
- **Same-origin client.** All data via `/api/*`; fonts self-hosted; **no external scripts/CDNs/trackers**. The tight CSP in `next.config.ts` depends on it — bring an external asset same-origin, never loosen the CSP.
- **Perimeter (background jobs exist now).** Listens on `127.0.0.1` only; every API route is `guard()`-wrapped (Host check → cross-site check on EVERY method, GET included, because GETs scrape → token → rate limit; refusals and privileged calls are recorded for Settings › Xavfsizlik); dangerous doors (`settings/update`, worker list, Tor) are `privileged` (header `x-sud-action`). **Nothing starts by itself:** loading, refreshing or switching pages/tabs never queues or scrapes; work starts from a click or an opt-in setting. Details/threat model: `docs/SECURITY.md`. A test fails if a route forgets `guard()`.
- **No server database.** Server state is in-memory + three deliberate on-disk stores under `~/.sud-tizimi` (published orders; worker health history `worker-health.json`; daily company snapshots `snapshots/<STIR>.json`, which expire after 24 h and are swept after 7 days). The orders cache and the health history are never deleted by the app. What must persist across loads lives in the browser (`localStorage` registry keyed by STIR). Don't add a DB unless the owner asks.
- **Types are enforced** (`ignoreBuildErrors: false`). Red `bun run typecheck` = broken build; fix the file, don't suppress.
- **Uzbek UI.** Native phrasing; `oʻ`/`gʻ` use `ʻ`/`ʼ` (not straight apostrophes), guillemets `«»`, no em dash. Money/dates via the app's formatters, not `toLocaleString`.
- **Two owner UI rules:** no «choosing glow» / inset glow (crisp focus only); «less info is useful info» — compact cards, match existing tile sizes.
- **Tokens, not hex.** Colors are CSS variables (`globals.css`); theme via `data-theme` (`next-themes`, default light).

## 2. Always verify before you finish

```bash
bun run typecheck                        # must be clean
bun run lint                             # must be 0 problems
bun test src/core src/lib src/server     # pure logic, scrapers (network mocked), security, route guards
bun run map:check                        # docs/MAP.generated.md is current (else: bun run map)
```
Never pipe these through `| tail` inside an `&&` chain before committing — `tail` hides the exit code.

**Live scraping does not work in a sandbox** (sud.uz / orginfo / public.sud.uz are blocked, workers not configured). Verify UI/flows by seeding
`localStorage` (`page.addInitScript`), mocking `/api/*` (`page.route(...).fulfill()`), or pointing a service at a local mock
(`PUBLIC_ORDERS_API=http://localhost:PORT`). A failed live fetch here proves nothing. Playwright + Chromium are preinstalled
(`/opt/pw-browsers/...`); never run `playwright install`. Document editor: run `next dev`, open Hujjatlar, fill `[data-fk]`, click `.dprev .slot`, compare the download with the preview.
Sandbox dev server: `bun run dev:once`; free the port with `fuser -k 3000/tcp` (never `pkill -f`).

## 3. Where things are (one line each — the full table is `docs/MAP.md` §2)

| Concern | Start at |
|---|---|
| Won/lost/pending, win rate, pizza | `core/classify`, `core/rates`, `core/status`, `proto/pizza-geometry` |
| Money, dates, number-to-words, penalty math | `core/billing-format`, `core/dates`, `core/pretenzia` |
| API envelope / validation | `core/envelope`, `core/schemas`, `lib/api-types` |
| Client state, watchlist registry, enrichment | `lib/store/app-store`, `lib/registry`, `lib/enrich` |
| Shell, nav, ⌘K | `shell/app-shell`, `shell/command-palette` |
| Company report PDF («Hisobot») | `lib/report/*` (model tested; render only draws) |
| Slide-over drawer | `proto/drawer` + `.drawer*/.dw-*` in `prototype.css` |
| `.docx` forms, live preview, templates | `lib/documents/*`, `views/doc-editor`, `proto/doc-preview`, `scripts/doc-templates` |
| Talabnoma (demand letters) | `lib/pretenzia/*`, `views/pretenzia-view` |
| Scrapers, worker routing | `lib/{billing,court-case,orginfo,chamber,stats}`, `lib/net/worker-fetch`, `cf-worker-pool` |
| Published court orders | `lib/public-orders/*`, `core/public-orders` → `docs/orders.md` |
| API routes, middleware, security | `app/api/**`, `server/{middleware,security,config}` → `docs/SECURITY.md` |
| Petition prefill from a case | `lib/documents/from-case`, `core/translit` |

Both document APIs need their templates traced into the standalone build (`outputFileTracingIncludes` in `next.config.ts`) — add new templates there too.

## 4. Gotchas that will bite you

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
- **The sidebar's column and its drawer share ONE breakpoint (1080px, `prototype.css`).**
  `.app-frame` drops to a single column and `.side` becomes an off-canvas drawer (hamburger
  + click-away `.side-scrim` + Escape) in the same `@media` block. They were once split
  across 1080/820, so between those widths the sidebar had no column *and* no drawer and
  landed on top of the page — the "breaks at half screen" bug (half of 1920 = 960). If you
  touch either rule, keep them together, and test 1080 / 960 / 820 / 700, not just phone
  and desktop.
- **Performance rules (each one was measured, not guessed).**
  - **Never put `backdrop-filter` (or any blur) over a page that has a running animation.** The drawer
    scrim had `backdrop-filter: blur(2px)` on top of the sidebar's always-running status pulse: the
    browser re-blurred the whole viewport every frame and the app fell from 60 → ~25 fps whenever a
    panel was open (worst frame 83 ms). Use a plain semi-opaque scrim.
  - **Anything that runs forever may animate only `transform` and `opacity`.** The pulse used to animate
    `box-shadow`, which can't be composited, so the sidebar repainted every frame for the life of the
    tab (4.3% of the main thread + 60 restyles/s while *idle*; now 0.2%). Same rule for spinners and shimmers.
  - **Every `setInterval`/listener needs a cleanup on every exit path** (`use-resource.ts` skipped
    `clearInterval` on its abort branch → a 500 ms timer re-rendering the owning list forever).
  - `bun run dev` runs the dev build of React, roughly 2× slower on interactions than `bun run start`;
    judge performance on a production build. (`next build` needs Google Fonts, which sandboxes block —
    to measure here, stub the two `next/font/google` imports in `layout.tsx` temporarily and revert.)
  - Measure with Playwright + CDP `Performance.getMetrics` (TaskDuration, RecalcStyleCount, LayoutCount)
    and a frame-gap sampler, A/B-ing CSS with `page.addStyleTag`. Beware: a `requestAnimationFrame`
    sampler makes the browser tick every animation each frame — compare like with like.
- **Hearing dates from sud.uz are `dd.mm.yyyy` — never compare them as strings** (`'10.01.2023' < '15.12.2022'`).
  Use `hearingKey` / `byHearingDate` / `pickUpcoming` in `sections/cases.tsx`; «next hearing» must also be
  in the future (a past hearing still marked scheduled is not «next»).
- **Never hedge (duplicate) a request that consumes a single-use token — pin it.** `fetchViaWorkers`
  re-sends any call slower than `hedgeMs` (900 ms for billing) through a second worker and takes the
  first answer. That is right for read-only lookups and wrong for billing's search, which spends the
  captcha token: the duplicate burns it, and its instant «Failed captcha check» can beat the original.
  Every failing search in the field took 1.1–1.7 s (over the hedge); every captcha call that worked took
  under it. A captcha session (PoW → analyze → search) therefore runs on ONE worker via
  `opts.worker` (`pickWorker(triedWorkers)`), unhedged, and a rejected token retries on a different
  worker. Court-case/jadval calls are idempotent GETs and are fine to hedge. (`net/__tests__/worker-fetch-pin.test.ts`)
- **The VLM (math-captcha reader) is configured by env**: `VLM_API_KEY` + `VLM_BASE_URL` (+ optional
  `VLM_TOKEN`), falling back to the SDK's `.z-ai-config` file. It only runs when recaptcha.sud.uz
  *demands* a math challenge; when the service issues a token directly the VLM is never involved.
- **A scraper must never return an upstream error body as if it were data.** billing.sud.uz answers
  rejected searches with HTTP 400/422 and a JSON body (`{ requestStatus: … }`, no `content`).
  `searchBillsByInn` once returned that body, so `getFullBillData` did `[...search.content]` and crashed
  with «Spread syntax requires ...iterable not be null or undefined», hiding the real reason. Validate
  the shape (`isSearchResponse`), keep the upstream's message (`rejectionReason`), and fail loudly with it.
  Scraper tests mock `fetchViaWorkers` (`src/lib/__tests__/billing-search.test.ts`) — copy that pattern.
- **Validate the shape of every raw `fetch()` response before storing it.** An error body (401 with
  `APP_API_TOKEN` set, 429, 500) is valid JSON with no data fields; `settings-view` once did
  `setData(json)` and then `data.workers.length`, which white-screened the whole Settings page.
- **Stale `.next` types** can break `typecheck` after you delete a page/route. Clear with
  `rm -rf .next/dev/types .next/types` and re-run.
- **Never commit secrets.** Network captures the owner pastes may contain live cookies
  or keys — read them, act on them, but never store or commit them.
- **Print windows (report, themed PDF).** The window is written with `document.open/write`, which
  **removes event listeners** — check for CSP/network problems from outside (Playwright popup
  `console`/`requestfailed`), not with a listener inside the popup. Fonts: `@font-face` URLs are relative to
  the **stylesheet**, not the page (dev emits `../media/…`), so `report/fonts.ts` resolves each rule against its
  own `sheet.href`; resolving against the page 404s, keeps `document.fonts.ready` pending forever and the print
  dialog never opened. `printIntoWindow` therefore caps the font wait (`FONT_WAIT_MS`). Keep
  `@page { background }` set or the margin band stays white in dark mode; `@bottom-right` page counters are
  Chrome/Edge 131+ only. In e2e tests block `window.close` in the popup (it closes itself after printing).
- **`bun run dev` runs under a supervisor** (`scripts/supervisor.mjs`) that restarts on
  crash; `dev:once` / `start:once` run the raw server if you need clean logs. The supervisor starts
  `next dev` with the **same Node that runs it** (`process.execPath`), not `bun x next`: under Bun's
  runtime on Windows Next's HMR WebSocket fails with «Error handling upgrade request … upgrade requires
  a Request object» (spammed by every open tab after an update restart). `bun` still does install/build.

---

## 5. Git workflow

- Develop on the branch the owner names for the task (currently
  `claude/gifted-volta-d1wpww` on `nurmamatovhusanbek-create/sud`). Create it from the
  latest default branch if it doesn't exist.
- Commit with clear, scoped Conventional-Commit messages
  (`feat(pretenzia): …`, `fix(launcher): …`, `chore(lint): …`).
- Push with `git push -u origin <branch>`. **Don't open a PR unless asked.** The owner
  runs locally (`bun run dev` on Windows) and fast-forwards `main` themselves.
- If the branch's PR was already merged, restart the branch from the latest default
  branch for follow-up work — don't stack new commits on merged history.
