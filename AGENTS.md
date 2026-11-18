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
- **No server database.** Server state is in-memory + three deliberate on-disk stores under `~/.sud-tizimi` (published orders, the order PDFs under `public-orders/files/` and their download log `public-orders/downloads.jsonl`, with a protected SECOND copy of that metadata (not the PDFs) in the OS app-data folder, `%LOCALAPPDATA%\SudTizimi\orders-backup` on Windows — see `docs/orders.md` rule 15; worker health history `worker-health.json`; daily company snapshots `snapshots/<STIR>.json`, which expire after 24 h and are swept after 7 days), plus the operator's own files: `vlm.json` (captcha reader keys, 0600) and `templates/` (own .docx templates). The orders cache (including the download log) and the health history are never deleted by the app. What must persist across loads lives in the browser (`localStorage` registry keyed by STIR). Don't add a DB unless the owner asks.
- **Types are enforced** (`ignoreBuildErrors: false`). Red `bun run typecheck` = broken build; fix the file, don't suppress.
- **Uzbek UI.** Native phrasing; `oʻ`/`gʻ` use `ʻ`/`ʼ` (not straight apostrophes), guillemets `«»`, no em dash. Money/dates via the app's formatters, not `toLocaleString`.
- **Three ways to write Uzbek.** The app and its templates are written in the OLD Uzbek Latin alphabet; documents can be produced in the new (2026) one (`Gʻ Oʻ Sh Ch → Ğ Ö Ş Ç`, nothing else changes) or, for the documents that opt in (`DocDef.cyrillic`: the four court petitions and the Uzbek talabnoma), in Cyrillic. ONE converter, `core/uz-alphabet`, and one docx step, `lib/documents/script` (Word splits words across runs: never replace text per run or with a regex in a component). English documents are never converted. Details and the bugs behind each rule: `docs/design-notes.md` › «Yozuv».
- **Animations follow the system unless the operator overrides them.** Windows with «Show animations» off, remote desktop and battery saver make Chrome report `prefers-reduced-motion: reduce`, which silences every animation and count-up («none of the animations work»). The sidebar button «Animatsiya» (`lib/motion`: auto → on → off, saved in `localStorage['motion']`, put on `<html data-motion>` before paint by `MOTION_BOOT_SCRIPT`) overrides it. Any new reduced-motion CSS must be `:root:not([data-motion='on'])`-gated (and honour `[data-motion='off']`), and script-driven motion must ask `motionReduced()`, never `matchMedia` directly. Tests: `lib/__tests__/motion.test.ts`. **Premium's motion lives in ONE file, `app/motion-premium.css`** (page entrance, sliding indicators via `lib/use-thumb`, strips and bars that draw themselves, overlays, the loading card; count-ups through `CountUp`): keyframes animate only `transform` / `opacity` / `clip-path`, transitions name their properties and never touch layout, easing and time come from the tokens, only live things loop, entrances end in the natural state (`backwards` fill), and its last block is the motion gate. A new Premium animation goes there and must pass `lib/__tests__/motion-css.test.ts`; see `docs/design-notes.md` › «Motion in the black edition».
- **Two owner UI rules:** no «choosing glow» / inset glow (crisp focus only); «less info is useful info» — compact cards, match existing tile sizes.
- **Two looks, one set of screens.** Settings › Koʻrinish picks the look (`lib/look`, `localStorage['look']`, `<html data-look>` set before paint by `LOOK_BOOT_SCRIPT`): **«Premium» (the default)** is `app/look-premium.css`: a precise, technical identity for a legal/registry tool: solid INK sidebar and primary buttons, crisp cool-white surfaces on a faintly tinted canvas (never a pure-white page), **TWO colours only, near-white and ink, in both themes: no blue and no accent hue** (selection, the active-page marker, links, focus rings and tab underlines are ink, white in dark; statuses are an ink dot and a word), IBM Plex Sans for the interface and Plex Mono for identifiers and figures, always tabular. **Not allowed in this look (each was tried and rejected by the owner): a blue or any accent hue, a serif, a warm ivory/brass «hospitality» palette, ornaments, and a rotating palette of decorative hues** (KPI tiles, nav chips, coloured monograms: «more colours is not premium»). **«Tinch» (calm)** is the graphite hairline look below. A look is tokens plus a CSS layer scoped by `[data-look='…']`, NEVER a second copy of a screen (the «Yangi»/«Yashil» forks were reverted for exactly that): a new component must read tokens and work in both. Light/dark (`data-theme`) and animations (`data-motion`) are independent of the look. The original navy look is in git history only (before the unslop commits).
- **Uzbek `ʻ` / `ʼ` (U+02BB-02BC) must come from Plus Jakarta Sans, not IBM Plex Sans**: Plex's own glyph is twice as wide («To ʻlovlar», «ro ʻyxati»), so those two code points are deliberately NOT in the Plex `@font-face` unicode-range (`fonts.css`). Check any new UI font by measuring `oʻ` against `o`, not by eye on a short word.
- **The look (Nov 2026 «unslop» pass).** Graphite surfaces and text from ONE neutral ramp (`--ramp-*`, hairline borders at 8% alpha), the brand blue as the only accent (selection, links, focus), colour only where it MEANS something: green won/paid, rose lost/overdue, amber pending/due soon (`--status-warning-*`), blue info. No gradients, glows or coloured shadows; no tracked all-caps labels; weights 400/500/600 (never 700+); sentence case; radii on the scale (controls 8-10, cards 12-16); hover = a surface or border step, never a lift; one easing curve; KPI tiles are a label, a figure and what it compares to (no icons, no fills). A copy line must be true: the sidebar status says what the workers are doing now (`.sysstat[data-state]`), never «sogʻlom» by default. Method and rules: `docs/design-notes.md` › «Koʻrinish».
- **UI changes are checked with `bun run ui:shots`** (docs/ui-split-plan.md M0): it shoots every screen at 3 widths × light/dark from MOCKED API data with motion off and a fixed clock, compares with the accepted run (`-- --accept`) and exits 1 on any change; a split or refactor commit must print «0 piksel farq». **A component may not import data or domain modules** (`src/lib/ui-boundary.rules.json`): ESLint flags it, the ratchet test lists today's exceptions and they may only shrink.
- **Tokens, not hex.** Colors are CSS variables (`globals.css`); theme via `data-theme` (own `lib/theme`, set before first paint by the inline script in `lib/theme-boot`; default light; do not bring back next-themes: its inline <script> makes React 19 log an error on every load).

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
    judge performance on a production build. (Fonts are self-hosted: `src/app/fonts.css` + `src/app/fonts/*.woff2`,
    so `next build`/`next dev` need no network. Never go back to `next/font/google`: it downloads at compile time
    and a failed download breaks the whole dev server with «next/font/google queries have exactly one entry».)
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
- **«unable to verify the first certificate» on a DIRECT sud.uz request** = the host sends only its own certificate, not the intermediate (Chrome downloads the missing one itself; Node does not). Direct calls (orders list/PDF, billing/captcha direct route) go through `lib/net/chainFetch`: only after that exact error it reads the leaf's AIA «CA Issuers» URL (public hosts only, size/time capped), accepts an issuer only if it really signed the certificate below, and retries with Node's roots plus those intermediates. Trust is never widened and certificate checking is never turned off — never «fix» this with `NODE_TLS_REJECT_UNAUTHORIZED=0` or `rejectUnauthorized: false`. Test: `net/__tests__/chain-fetch.test.ts` (builds a real broken chain with openssl). A new direct `fetch` to a sud.uz host should use `chainFetch` too.
- **«HTTP 500» from adolatapi1.sud.uz with a body `"Web Page Blocked!" … "attack_ID"` is the site's firewall (WAF) refusing us**, not a server error and not a missing case (it blocked every instance and the pre-2024 search at once). `lib/public-orders/waf` recognises it, the error says so (IP and attack_ID), and the FIRST block pauses all direct requests for 15 min (a circuit breaker: each further request can only lengthen the block). The repaired TLS request (`chain-fetch`) sends the same header set as Node's own fetch (accept-encoding/-language, sec-fetch-mode) and decodes gzip/deflate/br, because a firewall judges a bare `https.request` by what it lacks. Tests: `public-orders/__tests__/{waf,source-waf}.test.ts`.
- **Every request to the court-orders API is paced: ONE starts every 10 s** (`lib/public-orders/pace` → `lib/net/pacer`, in `source.ts` `fetchUpstream` and the PDF `download`; direct and worker routes alike; `PUBLIC_ORDERS_MIN_GAP_MS`, `0` = off). The site's firewall blocks bursts and one case check used to fire five searches at once (4 instances + the pre-2024 system). A person opening a PDF (`interactive`) goes before a crawl (`background`). So a check of N cases takes about 5·N·10 s and «Barchasini yuklash» about N·10 s: that is intended; the confirm dialog says so. A new request to that API must go through `ordersPace` too. Tests: `net/__tests__/pacer.test.ts`, `public-orders/__tests__/pace.test.ts`.
- **public.sud.uz shows some orders only in a pop-up (no download button) and refuses scripts (WAF) — the hand-over is a HAR, not a request.** The person opens the order in their own browser with DevTools › Network open, uses Network › «Export HAR (sanitized)» (or «with sensitive data» if the file contents are missing; the older menu said «Save all as HAR with content»), and picks that one file in Qarorlar › «HAR fayldan yuklash» (`POST /api/public-orders/import-har`, `lib/public-orders/har-import`). Each order file in it is stored by the id in its own request path, and the order RECORDS the browser's own search answers in the same HAR (`/publications/list`, the pre-2024 search) are added to the order store, so the file lands on a card (record `pdfId` = the file's id); a file with no record is reported to the person and in dev.log (`[orders-har]`); the manual import (`/import`, one PDF) still exists. Strictly LOCAL: no request to any site, cookies/tokens in the HAR are never read or kept (the URL's `?recaptcha_token=` is not even parsed: only the path). Do not turn this into a replay of the request or of its token. Tests: `public-orders/__tests__/har-import.test.ts`.
- **Qarorlar «Tozalash» clears orders from the lists, never from the store.** In «Yuklanmagan» / «Mavjud emas» the person ticks orders and can download the ticked ones, clear the ticked, or clear the rest (all pages). Cleared ids live in `hidden.json` next to the order store (`lib/public-orders/hidden-store`, `POST /api/public-orders/hidden`); the order RECORDS stay in the shards and the protected copy. `searchLibrary` hides a cleared, not-downloaded order from the lists and counts unless the person SEARCHES (then it shows with a «Tozalangan» badge, «Qaytarish» and «Yuklab olish») or opens the «Tozalangan» view; a downloaded order is never hidden. `hidden.json` is interface state (losing it only brings the orders back), so it is not in the metadata backup. Tests: `public-orders/__tests__/{library,hidden-store}.test.ts`.
- **Form controls share one look.** A dropdown in a filter row is `ui-custom/select-field` (`.f-select`: inset like the search field, same radius, the app's own chevron; `size="tall"` beside a 40 px button, `sm` beside page numbers): never a raw `<select>` with inline styles (the old court select had a different radius, height and a native arrow that crowded its text). Heights: `.btn` 40, `.btn-sm` 34, `.btn-xs` 28, `.f-search` 38. **One row, one height (owner rule): a button beside a field is exactly as tall as the field, and the ROW sets it, not the button's own class**: hero search 48 (`.hero-search .btn`), filter rows 38 (`.filterbar .btn`, `.fb-row .btn`, `.f-search`, `.f-select`, `.sortsel`), company header actions 42 (`.ctx-actions .btn`, the round `.circ`); list-row kebab 34 like the `.btn-sm` beside it. A new row of controls gets a line at the end of `prototype.css` («ONE ROW, ONE HEIGHT»); a `.btn-xs` is for text, never beside a field. Audit by measuring in Playwright: every `.btn`/`.circ` against any field on the same line (a wrapper hides siblings: compare by position, and measure the OUTER box of a `<label>` select, not its inner `<select>`). A row of buttons inside a card gets `flexWrap: 'wrap'`. The company-card hover tools (`.ccard-tools`) are absolutely positioned in the corner, never in the header's flow (in flow they stole 58 px and wrapped the STIR). Long lists show pagination ABOVE the list as well (`<ListPagination top …>`), so nobody scrolls just to turn a page.
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
  **Start-up speed** (`scripts/boot-helpers.mjs`, tested): the supervisor runs `bun install` only when `package.json`/`bun.lock` changed since the last good install (stamp `node_modules/.sud-install-stamp`) — a needless install rewrites `node_modules` and Turbopack then «waits for the filesystem to settle» on every start. After Next is listening it also requests `/` and the two local API calls itself (never a scraping route), so the first page is compiled before the browser asks (35 s on Windows, tab stuck on the spinner) and it prints `[supervisor] tayyor: …`. Open the browser after that line.
  **Windows launcher:** ONE file, `Sud.bat` (double-click, or the Desktop shortcut it can create). App not running: it starts `bun run dev` through Git Bash when installed (that is where the owner has bun/node on PATH; else plain cmd) HIDDEN (no window; `scripts/sud-start.sh`; `Sud.bat window` shows a minimized «Sud tizimi server» window instead), waits until the page answers, then opens the browser at `http://localhost:3000` (NOT 127.0.0.1: the browser keeps the watchlist/settings per origin, so another address shows an empty app). App running: a 4-second menu, Open (default) / Stop / Log (`dev.log`, written by the supervisor, overwritten per start) / make a Desktop shortcut with the app icon (`scripts/sud.ico`; a shortcut, unlike a bare .bat, can be pinned to the taskbar). `Sud.bat stop|shortcut|log` skip the menu. **It stops by itself:** Sud.bat sets `SUD_AUTO_EXIT=1`; every open page pings `POST /api/presence` every 30 s and says «bye» on `pagehide` (`shell/presence-beat`, `server/presence`); the supervisor polls `GET /api/presence` every 15 s and, once no window has been open for 60 s (20 min if a window vanished without a bye; 10 min if it was never opened) and no background order job is running, kills the tree and exits (`shouldStop` in `boot-helpers`; a computer that slept is given a minute). `Sud.bat keep` or a plain `bun run dev` never does this. A second `bun run dev` while one runs just says so and exits (it used to retry on a busy port and print a false «tayyor».) Stop finds the supervisor by its command line (`supervisor.mjs`), so it works with no window. Plain ASCII with CRLF (`.gitattributes`; `lib/__tests__/windows-launcher.test.ts` guards that) — cmd.exe garbles anything else.
  If Next dies at once with `EEXIST … mkdir …\.next\dev` (Windows, usually a OneDrive-synced folder), the supervisor deletes `.next/dev` (dev cache only) and retries twice, then stops and says to move the project out of OneDrive (`scripts/next-cache.mjs`); never loop on it.

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
