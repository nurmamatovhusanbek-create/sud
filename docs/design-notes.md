# Design notes — why each area is built the way it is

Moved out of AGENTS.md so agents read only the area they are changing. Structure and cross-references: [MAP.md](./MAP.md).

Each entry: **what you want to change → where → why / gotchas.**


## 🧩 CODE — domain logic & data layer

### Change how cases are won/lost/pending, or the pizza breakdown

**Where:** `src/core/classify.ts`, `src/core/status.ts`

**Pure functions, unit-tested.** `classifyOutcome` is role-aware (granted: plaintiff win / defendant lose · rad etilgan: plaintiff lose / defendant win · qaytarilgan: neutral for both) and is the ONLY copy — `lib/stats.ts` imports it; never re-inline it. Add/adjust a test in `src/core/__tests__/`. Keep them side-effect-free.

### Change the **win rate**

**Where:** `src/core/rates.ts` (`winRate`, `winRateText`)

The ONE definition: **won ÷ (won + lost)**, `null` (shown «–») when nothing is decided. Neutral and in-progress cases are not in the base. KPI cards, the pie detail, the per-court bars, the watchlist meta and the PDF report all call it — never inline `win / total` again. Always print the base («N ta hal qilingan ishdan»).

### Change the Statistika pie («radial stack»)

**Where:** `src/components/proto/pizza-geometry.ts` (pure model) · `Pizza` / `PizzaDetail` / `PizzaKey` in `proto/primitives.tsx` · `.cband` / `.cnum` / `.st` / `.pie-key` in `prototype.css`

One circle = 100% of cases; a wedge's radius is that slice's own 100%, stacked hub→rim: yutgan · yutqazgan · neytral · jarayonda. **Every case is drawn** (bands sum to the pill total — tested). Status = fill density in the slice's hue (solid · tint · hatch · dashed), never a new hue. Counts are tiny mono numbers printed only where the band is ≥ `MIN_LABEL_THICKNESS`. A clear channel (`wedge.split`) parts the decided bands from the undecided ones (neytral + jarayonda) so they read as their own zone. Paint constants live in `PIZZA_PAINT` and are shared with the PDF — change them once. **Report typography stays light** (max weight 700, body/values 500): heavier text ate the space between figures. The win rate is a number beside the chart, not a radius.

### Change money/date formatting or number-to-words

**Where:** `src/core/billing-format.ts`, `src/core/pretenzia.ts`

Money is in **tiyin** (1 sum = 100 tiyin) for exact integer math. RU *and* UZ number-to-words live here (UZ "ming" drops "bir").

### Change the penalty / demand-letter math

**Where:** `src/core/pretenzia.ts` (`computeClaim`, `delayDays`, `paymentClause`)

0.4%/day, capped at 50% of debt, **inclusive** delay-day count, 5-banking-day grace. Golden-tested against real letters — update the test if you change a rule.

### Change the API request/response envelope or validation

**Where:** `src/core/envelope.ts`, `src/core/schemas/`, `src/lib/api-types.ts`

Zod schemas define the shape crossing `/api`.

### Change client-side state (which section/surface is shown)

**Where:** `src/lib/store/app-store.ts` (Zustand)

`WORKSPACE_NAV` and `SectionKey` live here.

### Change the watchlist / recently-viewed registry

**Where:** `src/lib/registry.ts`, `src/lib/use-registry.ts`, `src/lib/enrich.ts`

localStorage `sud-registry-v1`. Writes dispatch `sud:registry-changed`; `useRegistryVersion` re-renders on it. `enrichCompany(stir, force)` refreshes stats+hearings.


## 🎨 UI — components & design system

### Touch the shell / navigation / ⌘K

**Where:** `src/components/shell/app-shell.tsx`, `command-palette.tsx`

Nav is `WORKSPACE_NAV` + the "Tizim" group (Hujjatlar, Sozlamalar).

### Edit a data section

**Where:** `src/components/sections/` (`bills`, `cases`, `hearings`, `profile`, `overview`)



### Edit a full-surface view

**Where:** `src/components/views/` (`launcher`, `watchlist`, `documents-view`, `doc-editor`, `pretenzia-view`, `settings-view`)

The launcher is the home surface.

### Change a slide-over panel (case detail, receipt, worker)

**Where:** `src/components/proto/drawer.tsx` + the `.drawer*` / `.dw-*` block in `prototype.css`; callers: `openCaseDetail` (`sections/cases.tsx`), `openReceipt` (`sections/bills.tsx`), `openWorker` (`views/settings-view.tsx`)

One shared sheet, styled after the themed PDF (navy masthead, eyebrow + title block, accent section labels with a rule, zebra rows, accent-soft key figure). Open it with `openProtoDrawer(title, content, sub, { eyebrow, badges, footer })` and build the body from `DwSection` / `DwKv` / `DwFig` so every panel matches. `DwKv` **drops rows with no value** — never render a «-» row. New panels get the look for free; don't hand-style a one-off.

### Change colors, spacing, tokens, dark mode

**Where:** `src/app/globals.css` + `src/app/prototype.css`

**Token-driven.** Define colors as CSS variables; the theme switches on `data-theme` on `<html>` (via `next-themes`, `defaultTheme=light`, `enableSystem=false`). Don't hardcode hex in components.

### Lay out a responsive card grid

**Where:** reuse the `.kpis` / `.ccards` breakpoints

**Grid gotcha (learned the hard way):** `repeat(N, 1fr)` = `minmax(auto, 1fr)`, so non-wrapping content (company names, STIRs) forces horizontal overflow off-screen. Use `minmax(0, 1fr)` **and** `min-width: 0` on the items.

### Change the **company report** («Hisobot», PDF)

**Where:** `src/lib/report/` — `model.ts` (pure: raw data → report model, tested) · `render.ts` (model → HTML sections) · `doc.ts` (page shell, `@page`, theme) · `fonts.ts` · `generate.ts` (`openCompanyReport`, called from `company/context-bar.tsx`)

Split on purpose: put logic in `model.ts` and cover it in `report/__tests__/`; `render.ts` only draws. A failed source is recorded in `model.notes` and shown **in place** — never print a zero for missing data. Sections with no data source are omitted, not faked. **The report never names its data sources** (owner's call): no footer credit, no `orginfo`/`sud.uz` in failure notes. **Colors:** outcomes have one hue each (teal won · vermilion lost · indigo in progress · slate neutral), validated for color-blind separation in light and dark with the dataviz validator; the navy `ramp` is only for magnitude/shares. Don't reuse an outcome hue for something else. **Layout («Dossier», chosen by the owner after four concepts; the old card-based layout was dropped as «cheap»):** no cards. A navy rail (left cell) carries identity, gauge, facts, founders, contacts, codes; the analysis (right cell) carries key figures, pizza, results, months, latest cases, hearings, payments. Both are cells of ONE table row so each paginates on its own; `thead` only reserves the top margin (no brand line at the top: the owner removed it), `.rp-bg` (rail colour), `.rp-wm` (the logo as a 6,5% watermark behind the analysis column, bleeding off the bottom-right corner, never over text-heavy contrast) and `.rp-pin` (footer) are `position: fixed` in print so they repeat, and `@page { @bottom-left }` paints the rail colour in the margin band (Chrome/Edge 131+; elsewhere a thin paper strip). Sections are ruled rows, never boxed; keep new sections to hairlines + numerals. The pie sits on the paper, so its strokes/hub use `t.surface`. Rail text always uses `t.rail.tone` (the page tones are too dark on navy). The signature chart is the SAME pizza as Statistika: `pizza()` in `render.ts` draws `pizzaModel()` from `components/proto/pizza-geometry.ts` (one geometry, two paints — never fork the maths for print).. `generate.ts` opens the print window **first** (synchronously in the click, or popup blockers reject it), then gathers data with a per-source timeout.

### Add a "themed PDF" export

**Where:** `src/lib/print.ts`

`buildPrintDoc(title, body, dark)` renders an app-themed sheet that adapts to the active theme; uses `print-color-adjust: exact` so brand colors survive "Save as PDF".

**Two UI rules the owner has stated explicitly — honor them:**
- **No "choosing glow" / no inner (inset) glow.** Don't add hover background-glows on
- **"Less info is useful info."** Prefer compact cards. When adding a card, match the

## 📄 DOCUMENTS — the `.docx` engine

### Add/edit a form-driven document (visa, IIO, court)

**Where:** `src/lib/documents/registry.ts`

Declares each document (id, template, fields) and each category (label, shared field groups). The editor, its live preview and the download all pick a new document up automatically — every field in `fields` must have a `{{key}}` in the template (and vice versa), or the form and the page disagree. Give fields a `placeholder`: it is what an empty spot shows on the page.

### Change how templates are filled

**Where:** `src/lib/documents/fill.shared.ts` (the substitution) · `fill.server.ts` (download: reads template, swaps letterhead, zips)

Trivial `{{key}}` string replace inside `word/document.xml` via JSZip. **The substitution is isomorphic on purpose:** the server download and the browser live preview both call `fillXml`/`markXml` from `fill.shared.ts`, so the preview can never drift from the file. Change fill behaviour there, never in only one side.

### Change the document editor (form ↔ live page)

**Where:** `src/components/views/doc-editor.tsx` (form, sections, doc switcher, downloads) + `src/components/proto/doc-preview.tsx` (live render) + `.dedit*` / `.dprev*` in `prototype.css`

Split view: fields left, the REAL .docx template rendered right (via `docx-preview`), filled as you type. Click a value on the page → its field focuses; focus a field → its spots highlight. Combined categories (visa, iio) share one form and get a doc switcher + «Barchasi»; court docs get one doc with sectioned fields (`sectionsFor` in the registry).

### Change how the preview is drawn

**Where:** `doc-preview.tsx`

Pipeline per change (debounced): template zip → `markXml` wraps each value in private-use sentinels (U+E000–E002) → letterhead swap → `docx-preview` renders **off-screen** → sentinels become `<span class="slot" data-k>` → DOM swapped in (no flicker, scroll kept). Empty spots show the field's example text (`placeholder`) in italics; the real download still leaves them blank. Slot tints are fixed light colors because the paper is always white, even in dark mode.

### Serve a template to the preview

**Where:** `src/app/api/documents/template/route.ts` (`GET ?id=`)

Guarded like every route; id is validated against the registry (path-traversal ids 404). Returns the raw, unfilled template only.

### Work on the **Talabnoma** (akt-sverka → demand letters) flow

**Where:** `src/lib/pretenzia/` (`parse.ts` client xlsx reader · `render.ts` values · `fill.server.ts`) + `src/components/views/pretenzia-view.tsx` + API `src/app/api/pretenzia/generate/route.ts`

`parse.ts` reads the xlsx client-side and finds debtor contracts; `render.ts` builds RU/UZ values; `fill.server.ts` picks the template by language (`pretenzia.docx` / `talabnoma-uz.docx`), fills, and returns one `.docx` or a ZIP.

### Build or repair a `.docx` template

**Where:** `scripts/doc-templates/` (`build-*.mjs`, `verify-templates.mjs`) → outputs to `src/lib/documents/templates/`

**Placeholders get split across XML runs by Word.** The build scripts do "span surgery": collapse run-fragmented `{{key}}` back into a single run so the fill step can replace it. Run `verify-templates.mjs` after building — it checks every placeholder is present and reachable. Don't hand-edit the binary `.docx`.

**IIO forms (rebuilt 2026-10 from the owner's updated originals).** `iio1_kafolat` (guarantee letter) and `iio2_royxat` (temporary-registration request) are built by `build-iio.mjs` from `iio-specs.mjs`, which locates every value by PLACE (table cell, label, marker) instead of by value, so the repo holds no personal data; `verify-iio.mjs` reads the values back out of the original and proves the round trip. The visa and court builders were converted to the same by-place specs (`specs.mjs`) with a byte-identity check against the previously shipped templates: no personal value is written down anywhere in `scripts/`. The registration request gained what the real form has and ours lacked: outgoing number and date, district header (`district_office`, «MvaPB» now rides with it on one line), entry date, stay address, housing provider and phone, and the responsible person's name, passport and two phones (`resp_*`). Visa validity is ONE free-text line (`visa_issuer`, «Kim bergan va muddati»; `visa_from`/`visa_to` are gone) and no-visa reads «–» by default. `TabDef.defaults` lets a category override a field's default: the IIO guarantee letter's «Ish joyi, lavozimi» cell is «<company> ishlash uchun». **Every template is scrubbed** (`xml-edit.mjs` `scrubPackage`): Word's first-page preview image (it showed the original names and passport numbers, readable) and the author names are removed; `lib/documents/__tests__/templates.test.ts` enforces that, plus placeholders ⇄ registry fields one to one, and no passport- or phone-like text. Known gap in the owner's form: row 10 of the registration request («30 kun») has no caption in the original; we kept it as is.

### Add a letterhead/header image picker

**Where:** `src/components/proto/letterhead.tsx`

Shared `useLetterhead()` hook + `LetterheadRow`; swaps `word/media/image1.png` (blank transparent PNG / uploaded / keep template's). Reused by both the visa docs and Talabnoma.

**Banner geometry:** every template's banner is ONE inline picture in a first-page header, page-wide and top-flush (negative indents, header distance 0; `scripts/doc-templates/banner.mjs`). The swap is `lib/documents/banner.ts` (`applyLetterhead`), shared by the downloads, Talabnoma and the preview: new PNG in, picture height = page width × PNG height/width, so it is never stretched and always touches both page edges. Don't go back to anchored pictures: docx-preview ignores `relativeFrom="page"`, so any anchor renders differently in the preview than in Word.


## 🌐 SCRAPING — sources, network, workers

### Fix/extend a scraper

**Where:** `src/lib/billing.ts`, `court-case.ts`, `orginfo.ts`, `chamber.ts`, `jadval2`, `stats.ts` (+ `src/sources/`)

These were ported carefully; match upstream shapes and keep them typed. `court-case` party STIRs aren't returned by the API — they're resolved by name against `orginfo` (see the `PartyRow` pattern in `cases.tsx`).

### Change proxying / worker health / Tor

**Where:** `src/lib/cf-worker-pool.ts`, `health-registry.ts`, `workers-config.ts`, `tor.ts`

Requests go through health-tracked Cloudflare Workers so the operator IP is never exposed. Workers are the owner's own (`CF_WORKER_URLS`); never wire in third-party fallbacks. **orginfo.uz exception:** the shared worker sends a JSON/CORS fingerprint (Origin `my.sud.uz`, `Accept: application/json`) that suits jadval.sud.uz but makes orginfo's HTML site answer HTTP 500, so `proxy.js` gives `orginfo.uz` a navigation-style header set, and `orginfo.ts` retries a failed worker attempt DIRECT from the machine (`ORGINFO_DIRECT_FALLBACK=0` forbids it; low volume, results cached 24 h). A fetch that fails THROWS (never `''` = «not found») so the profile can say why it is empty; `scripts/probe-orginfo.mjs` shows worker vs direct status.

### Add/adjust an API route

**Where:** `src/app/api/**/route.ts`

Every route must call `guard()` (bearer auth → per-IP rate-limit → coalesce) and set `runtime='nodejs'` + `dynamic='force-dynamic'`. Copy an existing route as the template.

### Prefill a court petition from a scraped case

**Where:** `src/lib/documents/from-case.ts` (`caseToDocValues`) · `core/translit.ts` (Cyrillic → Latin) · the drawer's «Hujjat tayyorlash» buttons in `sections/cases.tsx` · `docPrefill` in `store/app-store.ts` · `DocEditor initialValues`

The forms need court, judge, case number, claimant, subject and next hearing — all already in the case detail, so **no library or PDF is needed**. Only real fields of the target document are emitted (tested against the registry); what only the user knows (representative, address, reason, phone) stays empty.

### Change the **gauge** (rating, worker health, overall health) — the Dial

**Where:** geometry `src/components/proto/dial-geometry.ts` (pure, tested in `core/__tests__/dial.test.ts`) · app paint `Dial` in `proto/primitives.tsx` (+ `.dial*` in `prototype.css`) · PDF paint `gauge()` in `lib/report/render.ts`. Call sites: `sections/profile` (rating, `band`), `views/settings-view` (overall `HEALTH_ZONES`, per worker `WORKER_ZONES`).

One instrument scale everywhere («Sirkul · Asbob», picked by the owner from four concepts): 270° of 51 hairline ticks (26 when < 130 px), a longer tick every 20 points, numerals 0 · 50 · 100, ticks lit up to the value, a needle (long tick + pointer) at the value. `zones` (`[upTo, band][]`) colour the limits: workers < 60 dead · 60–89 slow · ≥ 90 healthy, overall ≥ 80 healthy; keep them equal to the badges/dots next to the gauge. The rating has no zones (the score → AAA…D mapping is unknown), only its band. **Motion:** the needle sweeps once on mount and glides from the old value to a new one (rAF, 1300 / 800 ms, nothing loops, reduced-motion = final state); keyed dials (`id`) remember their value across remounts. **Never** fork the maths: change `dialGeom`, both paints follow. The old 22-dash `ArcGauge` and the segmented `Ring` are gone.

### Change the **logo** («Hukm»)

**Where:** the ONLY source is `src/core/brand-mark.ts` (four 90° wedges with radii 22 · 18,2 · 14,4 · 10,6 on a 48 grid around an open hub: the Statistika radial stack as a growing spiral; owner picked it from six concepts). Drawn by `proto/brand-mark.tsx` (sidebar `.brand .logo` and drawer `.drawer-mast .logo`, both on the brand-gradient tile, `tile` variant), `brandMarkSvg()` (print header `lib/print.ts`; the report watermark `renderReportWatermark`) and `public/logo.svg` (favicon, swaps to the dark paint by `prefers-color-scheme`; `favicon-32.png` + `apple-touch-icon.png` are the tile version for non-SVG browsers/iOS, rendered once from `brandMarkSvg('tile')` on the brand gradient with rounded corners). Browsers cache the tab icon for days: the `?v=` suffix in `app/layout.tsx` metadata must be bumped whenever the mark changes. Variants are fixed paints from the tokens: `light` (navy · brand-600 · brand-400 · brand-300) on white, `dark` on navy, `tile` white at four opacities. **Never** hand-edit `public/logo.svg` or paste another path: change `core/brand-mark.ts`, rewrite the favicon (`FAVICON_SVG`; `core/__tests__/brand-mark.test.ts` fails when the file differs). No generic icons (shield, scales) for the brand.

### Which side is the company on (plaintiff / defendant)

**One definition:** `assignRoles()` in `core/classify.ts`, used by BOTH `lib/stats.ts` (side → win/lose/neutral, classified AFTER all courts are pooled) and the Sud ishlari filter «Ikkala tomon · Daʼvogar · Javobgar · Noaniq» (`sections/cases.tsx`, `sideOf`, computed over the whole loaded list, not the search results). **Why not name matching:** (1) `nameMatches()` matches any two MChJs (the expansion «mas'uliyati cheklangan jamiyati» alone is ≥ 2 shared words); (2) the courts write Cyrillic («ПРОКАБ» МЧЖ), the registers Latin (PROCAB MChJ), and the spelling differs beyond script (c/k, q/k, x/h, b/p…), so the company did not match itself (field report: out of 100 cases 0 plaintiff, 3 defendant). **How it decides:** every case was found by the company's TIN, so the company is a party of nearly every case: its spelling is the one name present in ≥ 60 % of the cases (and ≥ 2) — LEARNED from the list, script- and spelling-proof (`partyTokens`: Cyrillic→Latin, legal-form words dropped, vowel-less folded skeleton). Order of trust per case: a 9-digit TIN in the party text → the learned name → the known company names (only as a tie-break between unrelated recurring names, or when nothing could be learned) → unknown. Spellings of one name («PROCAB» / «PROCAB GROUP») count as the same company; the company on BOTH sides, or on neither, is unknown. **Never guessed:** `null` = «Noaniq» (the chip appears only when > 0, so the three counts add up to the list); stats keeps the old default (plaintiff) for the win/lose maths. Only the 40 most frequent exact names are scored against the list (keeps it O(cases × 50), ~165 ms at 1500 cases). The filter also narrows PDF print and the «Qarorlar» check (not the Excel export, which is server-side by STIR). Tested in `core/__tests__/classify.test.ts` (100-case Cyrillic scenario, recurring counterparty, ties, blanks); a 20-run random simulation (typos, blanks, third parties) gave 0 wrong sides.

### Worker health history (Settings → Holat: Bugun / 7 kun / 30 kun / Barcha)

**Bug fixed:** the history lived only in the pool's memory (a 500-record ring per origin × worker): every server restart (the dev supervisor restarts on crash and HMR rebuilds re-created the pool) emptied it, and a busy worker pushed older requests out, so the long spans could never reach back. **Now:** `OriginHealthPool.pushHistory` also calls `recordRequest` (`lib/health-store.ts`): per worker × origin it keeps COUNTS per hour (ok · fail · summed ms) for 35 days, rolled up into per-day counts after that and kept (≈ 40 bytes a day, so «Barcha» is all time), plus the last 300 raw records for the drawer and the bars. One JSON file `~/.sud-tizimi/worker-health.json` (0600, atomic write, `WORKER_HEALTH_FILE` overrides; flushed 15 s after a change and on `exit`; damaged/garbage rows are skipped; a worker removed in Settings drops its history, nothing else is ever deleted). `/api/settings/health` now lists every CONFIGURED worker (also unused ones) with `buckets` as `[start, width, ok, fail, ms]` tuples; the page computes every figure for the chosen span from them with `spanTotals` (`lib/health-span.ts`, pure) and falls back to the raw records for an older server. The registry (`health-registry`) is on `globalThis` so a route bundle never sees an empty copy. Span edges are accurate to a bucket (an hour up to 35 days, a day beyond). Tests: `lib/__tests__/health-store.test.ts`.


## Hearings of a case in appeal (`core/hearing-pick`)

jadvalapi rows hold the **first-instance** hearing at the top level and one nested `reviews[]` entry per appeal /
cassation, each with its own `hearing_date`, `hearing_time`, `responsible` and `court`. Reading only the top level
meant a case that went to appeal kept its old date and an appeal hearing set for today never reached «upcoming
hearings» (case 4-1001-2621/42935, defendant TIN 309922239). `pickHearing` takes the earliest hearing that is today
or later across the top level and all reviews (else the latest past one); the row then carries that hearing's court,
judge and `hearingStage`. When jadval.sud.uz and jadvalapi both answer, the row that still knows a hearing ahead wins.
The upcoming filter now compares the local calendar day (`toISOString` shifted «today» by the UTC offset).
Test: `lib/__tests__/upcoming-appeal.test.ts`.

## Daily snapshots (`lib/snapshot-store`)

A company used to be scraped again whenever the 5 min browser cache or the 60 s / 10 min server memory had lapsed, and
every server restart emptied the server ones. Now `stats`, `company-info` and the court lists (`mode=tin`) go through
`viaSnapshot` in their routes: a part younger than 24 h is read from `~/.sud-tizimi/snapshots/<STIR>.json` and no site is
touched; older (or missing) is scraped and replaces it; `force=1` (the hard refresh) scrapes regardless. Upcoming hearings
are deliberately not a part: they stay live (5 min).
Rules: only COMPLETE answers are stored (`storable`: stats without court errors and with a found company, info without
`partial`, a court list that is not `incomplete`); a failed refresh keeps the old snapshot; a plain open whose re-scrape
fails serves the expired one flagged `stale` (meta `stale`); a forced stats scrape drops that company's `court:` parts
(the lists must not be older than the stats beside them); `force` also drops orginfo's 24 h memory (`forgetCompany`), or
the «fresh» answer would be the old one. The STIR is the file name, so exactly 9 digits. Files and parts unrefreshed
for 7 days are deleted (hourly sweep, mtime). Responses carry `meta.fetchedAt` / `meta.cached` / `meta.stale`.
Tests: `lib/__tests__/snapshot-store`, `lib/__tests__/snapshot-routes`.

### Hard refresh and the age label

The header's circle button and the R key run `hardRefreshWithToast`: forced stats (which refills the server's court-list /
orginfo memory and, when complete, retires the older info / court / bills snapshots), then the live hearings, then the event
`sud:company-refreshed`, on which the active section re-reads (`reload()`: no second scrape). The toast says how it went:
«Yangilandi» · «…lekin majlislarni olib boʻlmadi» · «Yangilab boʻlmadi … eski maʼlumot qoldi» (an incomplete stats answer is a
failed refresh: nothing is stored and the registry meta keeps its numbers). Stats, company info and court lists use
`useResource({ persist:false })`: the server's snapshot is the only copy, so there is nothing in the browser to hide a refresh
done elsewhere. Sections report `meta.fetchedAt` to `lib/data-age`; the header shows «Yangilandi 3 soat oldin» (the OLDEST part;
the tooltip lists each; «· eskirgan» when the sites failed and a past-day snapshot is shown).

### Bills in the snapshot

`/api/bills?inn=` replays a fresh stored list as the SAME NDJSON stream (meta · bills · done; `meta.cached`, `meta.fetchedAt`,
`done.fetchedAt`), so there is no captcha and no scrape inside the day; `&force=1` always scrapes. A live scrape is stored
(`lib/bills-snapshot`, the final list after the retry round) only when no bill is left with a TRANSIENT error (a definitive
HTTP 4xx/5xx for one receipt is a stable fact and does not block it). If the live scrape fails before anything was sent and an
older snapshot exists, that is replayed with `stale:true`. A forced, complete stats scrape retires the bills snapshot, so the
header's hard refresh makes the next Bills open (or the open one, immediately) scrape. Removing a company in the app calls
`DELETE /api/snapshot?tin=` and its file goes. Tests: `lib/__tests__/bills-snapshot`, `snapshot-routes`.
