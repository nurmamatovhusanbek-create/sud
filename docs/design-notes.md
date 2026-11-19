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

**Where:** `src/components/proto/pizza-geometry.ts` (pure model) · `OutcomeBoard` in `proto/primitives.tsx` (the radial `Pizza` is gone from the app; `pizzaModel` stays only for the PDF report) · `.ob2*` / `.ob-strip` / `.st` in `prototype.css`

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

### Counting numbers, copyable identifiers, receipts from a court the case API lacks
- **`CountUp` retargets from what is on screen.** Invoices stream in one by one (target 1, 2, 3, 4, 5 while a count is running). The old counter only remembered where a count STARTED, so each cancelled count restarted from there and the figure read «1-2-1-2-3-1-2-3-4». `lib/count-tween` (pure: `countAt`, `countDuration`) is the maths; the component stores the CURRENT unrounded value every frame (`fromRef`) and the next target continues from it. A step of a few units takes ~250-450 ms, a big jump 750 ms. Test: `lib/__tests__/count-tween.test.ts` (monotonic 1 → 5 at several arrival gaps). Both looks use the same component; `Dial` already did this.
- **A case number copies itself on click** (`ui-custom/copy-text`, `.copy-id` in `prototype.css`): case rows in Sud ishlari, Statistika/Overview and Qarorlar, and the drawer title. The click stops at the number (the rest of the row still opens the case), Enter/Space work, the toast says «Ish raqami nusxalandi». Hover is a surface step, never a glow. Use `CopyText` for any new place that prints a case number.
- **MILITARY (billing) has no case-API court.** `courtTypeForCase(billingCode, caseNumber)` (`core/billing-format`): a known billing code wins; MILITARY or unknown is settled by the case-number prefix (1- criminal, 2-/3- civil, 4- economic, 5- administrative), and only when that says nothing does the opener fall back to economic. Test: `core/__tests__/court-type.test.ts`.

### Change colors, spacing, tokens, dark mode

**Where:** `src/app/globals.css` + `src/app/prototype.css`

**Token-driven.** Define colors as CSS variables; the theme switches on `data-theme` on `<html>` (own `lib/theme`, set before first paint by the inline script in `lib/theme-boot`; light by default, no system mode). Don't hardcode hex in components.

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

### Fill one document for many rows («Jadvaldan»), PDF, ZIP

**Where:** `views/doc-bulk.tsx` · `lib/documents/bulk.ts` (read csv/xlsx, match columns by field label or key, rows → values; pure) · `bulk.server.ts` + `api/documents/generate-bulk` (one .docx per row, numbered, one zip, max 300 rows) · `lib/xlsx-grid.ts` (the minimal xlsx reader, shared with `pretenzia/parse.ts`)

Each row is laid over the form's values (what is shared is typed once) and checked with the same `validate.ts` checks; nothing blocks. **PDF** = `print-render.ts`: the same `fillXml` as the download, rendered by docx-preview off-screen and printed by the browser (the window is opened inside the click). **«Barchasi · ZIP»** zips a combined category's documents client-side. Drafts / saved profiles / checks: `drafts.ts`, `profiles.ts`, `validate.ts` (all pure, storage injected).

### Write a document in the new Latin alphabet (2026) or Cyrillic: «Yozuv» switch

**Rule:** the new alphabet changes exactly four letters, both ways: `Gʻ gʻ → Ğ ğ`, `Oʻ oʻ → Ö ö`, `Sh sh → Ş ş`, `Ch ch → Ç ç`. The other 24 letters and the tutuq belgisi (`ʼ`, a separator) are unchanged. Everything in the app and in the templates is written in the OLD alphabet; the choice (old / new, remembered in the browser: `lib/documents/script-pref`, key `sud-doc-script`) is sent with each request and the server remembers nothing.

**Where:** `core/uz-alphabet.ts` (the ONE converter: pure, returns `Edit[]` so the docx step can map them onto Word runs; never write a second one, never `.replace(/sh/…)` in a component) · `lib/documents/script.ts` (`convertWordXml`, `applyScriptToZip`, `valuesForScript`, `resolveScript`) · wired into `fill.server` (download + ZIP + spreadsheet), `print-render` (PDF), `proto/doc-preview` (live page), `pretenzia/fill.server` (Uzbek talabnoma only) and the three routes (`script` in the body, `parseScript`). UI: the `Yozuv` control in `views/doc-editor` and `views/pretenzia-view`. Tests: `core/__tests__/uz-alphabet` (the alphabet chart, fuzz), `lib/documents/__tests__/script` (every shipped template, every document end to end), `lib/pretenzia/__tests__/script`, `core/__tests__/translit`.

**Why it is built this way (each one was a bug found by a test):**
- **Word splits words across runs** (`Oʻ`+`zbekiston`, `O`+`’`+`zbekiston`, `S`+`h`), and templates spell the modifier several ways (`ʻ ‘ ’`). So a paragraph's runs are ONE text stream; an edit lands in the run of its first character and the consumed characters leave the others. Paragraph ends, line breaks, tabs, pictures and field characters are boundaries. Only the text inside `<w:t>` changes; every tag/attribute/untouched run stays byte for byte.
- **`{{placeholders}}` are opaque** (a key such as `{{short_name}}` must never be converted) and the template and the values are converted in two separate steps. In the preview the markers are added AFTER, so the field keys inside them are safe.
- **Typed text is first normalised to the old alphabet**, then derived (Cyrillic names, initials, dates), then converted once; so a name typed `Şuhrat` gives the same Cyrillic as `Shuhrat`, and `core/translit` only ever sees one spelling. `с`+`ҳ` (Исҳоқ) keeps a tutuq (`Isʼhoq`) so it is not read as the digraph `ш`.
- **Not Uzbek words are never touched:** e-mail, links, domains, codes (`SH123`, `AA1234567`) and numbers like `SH-12/2026` / `PF-5712`; `5-chi` and `Oʻzbekiston-2030` ARE words. English documents (declared `lang: 'en'`, or text that reads as English: the operator's own templates) get NO conversion in either direction (`should`/`which`/`Chief`, a Turkish surname such as `Özdemir`).
- **New → old:** a plain `s`+`h` in a token that already has a new letter is two letters and gets the tutuq (`Öshoq → Oʻsʼhoq`). A digraph is upper-case in an upper-case word (`ŞARTNOMA → SHARTNOMA`), and title-case for initials (`Ş.A. → Sh.A.`).

**Cyrillic («Кирилл»).** Third choice of the same switch, shown only for a document with `DocDef.cyrillic` (the four court petitions `court_*`) and for the Uzbek talabnoma (`pretenzia/fill.server`, `lang === 'uz'`; the Russian talabnoma and every other document ignore it, and a saved «cyr» shows as the old alphabet there: `effectiveScript`). **Interpretation:** «talabnoma group» = the Talabnoma section (`talabnoma-uz.docx`); `visa3_talabnoma` and `iio2_royxat` carry the word in their names but belong to the visa / IIO groups, so they have NO Cyrillic version; one flag per document turns it on if the owner wants them. Same machinery as the alphabet change: `editsToCyr` in `core/uz-alphabet` (edits, so the docx step maps them onto Word runs), same protected tokens, English untouched, values typed in any script are normalised to the old alphabet first. Rules that are not a letter table: `oʻ gʻ sh ch → ў ғ ш ч` (any capitalisation); `yoʻq` is `й+ў+қ`, not `ёʻқ`; `ya yo yu ye → я ё ю е`; `e` is `э` at the start of a word and after a vowel, `е` after a consonant; the tutuq is `ъ` between letters and `ʼ` between `s` and `h` only says «two letters» (`Isʼhoq → Исҳоқ`); `ts → ц` between vowels / at the start (`federatsiya`, `Tsentr`); loan-word prefixes `ob sub pod pred raz iz in kon ad` + `y` + vowel get the `ъ` the Latin spelling leaves out (`subyekt → субъект`); a token with a letter that has no Cyrillic (`c` outside `ch`, `w`) is a brand and stays whole (`Wi-Fi`, `Coca-Cola`). A suffix on a number (`10:00ga`, `5ta`) and on a code (`SH-12/2026-sonli`) IS converted (`CODE_CYR`, `CODE_TAIL`). Tests read it back with the app's own reverse converter (`translit.uzCyrToLat`): hand-picked words, a fuzz, every Cyrillic template paragraph. **Known limits:** `ts` between two vowels is always `ц` (`otsa` would read `оца`); `-tsiya` words are spelled `ц` in Cyrillic, but Latin `inyeksiya` has `ks` (`инъексия`); Russian-spelling names (`Ю`, `Щ`, `Ы`, `Ь`) are not produced.

**Known limits (documented in the tests, not hidden):** one capital `Ş`/`Ç` cannot remember whether it was `Sh` or `SH` when it is alone or in an initials token (`SH.` comes back `Sh.`, a bare `CH` word comes back `Ch`); a name typed in the new alphabet with no marker letter in its token (`Ishoq`) is read as the old digraph. **Decision to confirm with the owner:** abbreviations follow the letter rule, so `MChJ` becomes `MÇJ`; a legal-entity name quoted from a register may need to stay as registered.

### Own templates («Oʻz shablonlarim»)

**Where:** `lib/documents/custom.ts` (pure: `scanTemplate` puts every `{{marker}}` Word split across runs back into ONE run, lowercases it, reports unreadable ones; `registerCustomDocs` puts the docs and their fields into the registry) · `custom.server.ts` (`~/.sud-tizimi/templates`, validation) · `api/documents/custom` · `views/custom-templates.tsx`

A key the catalog (`FIELDS`) knows keeps its label, default, example and checks; any other key is a plain text field labelled after the key. The client loads the saved list into the registry on opening Hujjatlar; the server registers them (`ensureCustomRegistered`) before it reads or fills a `custom_…` id. Everything else (preview, drafts, checks, PDF, «Jadvaldan») works unchanged because it goes through `docById` / `FIELDS`. The route is in `next.config.ts` `outputFileTracingIncludes` only for the built-in templates: custom ones are read from disk at run time.

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

**Talabnoma parties (akt-sverka):** `lib/pretenzia/parse.ts` `findParties` reads BOTH companies and their legal forms from the sheet's header (`между … и …`, or the two `По данным … сум` cells) through `core/legal-forms` (AO, OOO, SP OOO, CHP, IP, GUP, GU, SP; JS `\\b` does not work between Cyrillic letters, so forms use lookarounds). `lib/pretenzia/constants.ts` `resolveParties` decides what the letter says: typed > the sheet > the sample, and the sample's legal form and ADDRESS are used only for the sample company (the sheet carries no address, so another debtor gets an empty one and the view asks for it). The templates write the form from `{{debtor_form}}` (`АО «…»` / `«…» AJ` became `{{debtor_form}}`).

**Bilingual forms and derived values (Tijorat siri):** `ts1_buyruq` and `ts2_kelishuv` are Russian | Uzbek side by side (every paragraph is a cell of a 2-column table), filled from ONE form (a combined category, like visa and IIO). Most values appear twice in different forms, so the user types one input and `lib/documents/derive.ts` (`withDerived`, called by the server fill AND the preview) adds the spellings: `<date>_dmy/_ru/_uz`, terms in words in the right Russian case (`ruCount`, `ruBrv`, `uzCount`), Cyrillic names (`core/translit` `uzLatToRu`), initials, `sc_company_ru_q`. A derived key can be a placeholder only, or also a form field (`emp_name_ru`): what is typed wins, the derived text is its hint. In the preview a derived spot is wrapped with its INPUT's key, so a click opens that input (`markXml(…, fieldOf)`). Placeholder keys may contain digits (`kc_1_name`). A document can name its own `requireKey` / `nameKey` (the order needs its number, the agreement the employee; the file is named after it). Rules and wording are tested against the real documents' sentences in `__tests__/secret.test.ts` / `derive.test.ts`.

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

### Change the **score** (rating, worker health, overall health) — the Dial
**Where:** app paint `Dial` in `proto/primitives.tsx` (+ `.score*` / `.meter` in `prototype.css`) · call sites `sections/profile` (rating), `views/settings-view` (overall `HEALTH_ZONES`, per worker `WORKER_ZONES`) · the PDF report still draws the old gauge from `dial-geometry.ts` / `gauge()` in `lib/report/render.ts` (print keeps its own outcome hues; its tests `core/__tests__/dial.test.ts` stay).

**Unslop chart rules, applied (owner, Nov 2026, after the Premium look went two-colour: the pizza and the gauge were the last coloured things; a first pass of plain ranked bars was rejected as «not visually appealing, and the needed info is not there on first look»).** The rule the second pass follows: **the answer first, the breakdown second, no legend to decode.** `OutcomeBoard` is a HERO (a huge tabular win rate; ONE thick strip of every case: won solid · lost tint · neutral hatched · in progress dashed outline; four stat columns under it that are the legend AND the numbers: status icon, count, share, and a chip of the segment's fill) plus TILES (one per court type / category, each with its own composition drawn to 100 % so slices compare by SHAPE, plus its own win rate). Picking a tile re-aims the hero («Ishlarni koʻrish» follows it); picking it again goes back to «all». Never rank a share as bare bars in a big empty card; never put a number only on a segment (a 1-px segment must not be the only place a figure lives). The win rate is the ONE app-wide definition (`core/rates`: won ÷ (won + lost)). The per-court win-rate bars (`WrRows`) were removed: the tiles carry it. `Dial` is a big number over a RULER of hairline ticks that light up to the value (taller ticks at the zone limits and every 5th; limits also printed under the big one); it keeps its props, the count-up (rAF 1300 / 800 ms, reduced-motion = final value, keyed by `id`) and `zones` (keep them equal to the badges/dots beside it: workers < 60 dead · 60–89 slow · ≥ 90 healthy, overall ≥ 80). One accent per chart: ink on neutral steps; no threshold colours (the rating badge is ink; the NUMBER is the signal). Do not bring back a pie, a ring or a coloured band in Premium; Moviy has no separate chart.

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

**Four instances, each with its own judge (Nov 2026).** The instances are first, appeal, cassation and **Taftish** (`HearingStage` has `inspection`; the court's text is «Тафтиш» and the case status calls it «Назорат»; the library enum is INSPECTION, `CASSATION_REPEATED` counts as cassation). `stageOfInstance` is the ONE reader of an `instance` text; `reviewOf(raw, stage)` takes that instance's `reviews[]` entry (the latest of several); `stageOfRow` is the stage a ROW is in (a row of jadval.sud.uz can itself be an appeal row). `getCaseDetails` returns `firstInstance`, `appellate`, `cassation` and `inspection`, each `InstanceData` with its OWN `court`, `judge`, hearings (from its own rows only) and decision; the drawer's «Instansiyalar» track shows the four with each one's court and judge, «Sudya · <instance>» is the judge of the instance the case is in NOW, and a decision without a PDF names its instance's court and judge. The list row (`hearingFields`) uses the picked hearing's judge, or the current instance's when no hearing is known; the merge of the two APIs takes the court WITH the hearing. A review without a judge shows none, never the first one's. The old first-instance-for-all bug was the first instance's top-level `responsible` read for every instance (rows, the no-hearing row, the merge). Not verified live (sud.uz is unreachable from the sandbox): the exact Cyrillic text of the Taftish `instance`; the matcher takes «Тафтиш» and «Назорат». Tests: `core/__tests__/hearing-pick.test.ts`, `lib/__tests__/case-instances.test.ts`.

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

**Waiting for an update to finish (`lib/update-wait.ts`).** An update restarts the server, and often TWICE: `git pull` changes a file Next watches (`next.config.ts`) so the dev server restarts itself, then the supervisor cycles it again after `bun install` (the sentinel is deleted within a second, so it is no signal). A request in flight during either restart is cut off. So the Updates tab never treats a cut connection as a failure, and never treats «something answered» as done: it waits for a server whose **commit moved**, whose **start time is new** (`GET /api/settings/version` → `local.bootedAt`) and which keeps answering from that one process for four polls in a row; if nothing changes for ~9 s it concludes the request really failed («Tarmoq xatosi»). The first update that carries this fix still runs the OLD screen once; every later one uses it.

## Ishga tushirish: oʻzi skrab qilmaydi

Ilova ochilganda (launcher, Kuzatuv) hech qanday sud/orginfo soʻrovi ketmaydi: kartalar registry keshidagi maʼlumotni koʻrsatadi. Yangilash faqat bosish bilan boshlanadi: kartadagi tugma, Kuzatuvdagi «Yangilash» (hammasi, navbat bilan) yoki launcherdagi «Yangilash». Ochilishda faqat mahalliy chaqiruvlar qoladi (`settings/health`, `public-orders/status`). Kompaniya ochilganda `keepIdentityWarm` yengil company-info oʻqiydi, bu foydalanuvchi harakati. Test: `src/lib/__tests__/no-launch-scraping.test.ts`.


## Koʻrinish (the look, Nov 2026)

The interface was redone with the method of **unslop** by Damir Sokolovsky ([@heydamir](https://x.com/heydamir), https://github.com/heydamir/unslop, CC BY 4.0): audit the slop first, set a direction from the product, then fix spacing, colour, icons, copy, type, layout, details and motion in that order. Credit kept here as the licence asks.

**Direction.** Product: a private desk tool for one Uzbek lawyer to look up companies, court cases, bills and hearings and to produce documents. Character: exact, calm, a little dry (a clerk's desk, not a start-up). World: a legal office, paper and ledgers: surfaces stay neutral graphite, the content carries the colour. Moment: the next hearing (amber marker when it is inside 7 days) and the won/lost chart. Signature: identifiers (STIR, case numbers) in IBM Plex Mono, tabular.

**What changed (through the tokens in `globals.css`, then `prototype.css`).** Navy-tinted ramp to graphite (light and dark); sidebar from a blue gradient with a glowing active item to a neutral surface with a hairline, the active row a surface step; logo tile flat; all tracked all-caps label rules removed; weights 700/800 to 600 (small text 500); negative tracking on small text removed; half-pixel and sub-12px sizes onto the scale; radii onto 8/10/12/14/20; hover lifts removed; entrance 300 ms with an 8 px rise; counts as quiet mono text, not pills; KPI tiles numbers-only (no icon tile, no solid fill); card-header and document-tile icons without coloured tiles; «warning» is amber (it was blue, so «pending» looked like «info»); the launcher headline lost its two-tone colour and trailing period; the sidebar status line is derived from the real worker state.

**Rules for new UI.** Colour means something or it is not there. One accent. No gradient, glow, blur or colour wash. Sentence-case labels at 12 px or more. Equal things have equal sizes, on the 4 px grid. A card is for an independent thing: no filled block inside a card inside a page (the hearing list is rows on the page). Text must be true (no default «healthy»).

**Structure pass (second step of the same look).** Not only colour: (1) company cards became one **ledger** (`.ccards` is a single surface, `.ccard` a row: name and STIR, rating, next hearing; a column header `.ccards-head`; the row folds below 1080 px, never turns back into a card); (2) the four KPI tiles became one **summary strip** (`.kpis` is one surface divided by hairlines, two columns on a phone); (3) status is a **dot and a word**, not a coloured capsule (`.badge`, `.lt`); (4) segmented controls are **flat text options** with a surface step for the active one (no capsule inside a capsule); (5) one primary action per view (Kuzatuv: «Kompaniya qoʻshish» is primary, «Yangilash» and «Tozalash» are ghost); (6) the alert banner that repeated the hearing list under it was removed (the amber marker on the row says it); (7) the eyebrow above each hero title is hidden (the sidebar already names the page). Rule: a list of things with the same fields is a table, not a wall of cards.

## Koʻrinish uslublari (Premium / Moviy)

Two looks, chosen in Settings › Koʻrinish (default «Premium»). Mechanism: `lib/look` + `LOOK_BOOT_SCRIPT` put `data-look` on `<html>` before paint; `app/look-premium.css` re-points the tokens (light and dark) and restyles under `[data-look='premium']`; the markup is shared with «Moviy».

**History, so it is not repeated.** «Tinch» (graphite, hairlines) was judged flat and tiring. Attempt 1, «Yorqin» (six rotating pastel hues on tiles, chips and monograms): *a mess; more colours is not a premium look and gives no identity*. Attempt 2 (serif titles, ivory canvas, brass accent, ornament): *not our font; it reads as a product or beauty site, and we are a legal/registry tool*. «Premium» is the third approach: identity from precision, not decoration.

- **Materials: two colours.** Ink `#111114` (sidebar, primary buttons, monograms) and near-white (white surfaces `#FFFFFF` on a faintly grey canvas `#F4F4F5`, never a pure-white page). **No blue and no accent hue, in either theme** (owner, Nov 2026: «two colors seems fine, no need for dark blue on both themes»): selection, links, focus rings, tab underlines and the sidebar marker are ink (white in dark mode); the tile icon gradient runs graphite to ink (light) or light to mid graphite (dark). Statuses are an ink dot and a word. The distribution chart and the scores are ink too (see “Change the score”).
- **Type.** IBM Plex Sans (400/500/600, self-hosted, SIL OFL) for the interface; IBM Plex Mono for identifiers (STIR, case numbers) and figures; every figure `tabular-nums`, so columns of numbers align like a ledger. Page titles 600 with -0.02em tracking, 28-36 px. See the `ʻ` rule in AGENTS.md.
- **Shapes.** Radii 8 (controls, monogram), 10, 12 (cards), 16; hairline borders; one soft shadow level; no ornament, no gradient, no blur.
- **Structure** is the calm one: ledger rows for companies, one stat strip, dot-and-word statuses, flat underlined options. Only skin and type differ.
- **Dark mode** uses the GRAPHITE ramp of the unslop tokens (heydamir/unslop, CC BY 4.0), not a tinted navy: deepest `#0F0F10` (the sidebar), page `#141415`, card `#19191B`, raised `#232325`, text `#EDEDED` / `#A1A1A6` / `#85858B`, hairlines at text 8 %, positive `#4CC38A`, negative `#E5484D`. Depth comes from surface STEPS and hairlines; the primary button is the off-white `#EDEDED` with dark text; there is NO blue: marker, links and focus ring are the off-white. The monogram tile is a raised graphite `#2A2A2E`.

**Structure rules (Nov 2026, after the owner said the shapes and cards were «still not it»).** Seen on the real company page (the report fixtures drive a mocked API: `src/lib/report/__tests__/fixtures.ts`): a stack of identical white boxes, each with an icon beside its title, huge empty-state cards and a tiles row repeating the stat strip, says nothing about what matters. So: (1) a card title is a title, **no icon beside it** (`.card-h .ico` is hidden); (2) a chart and the list that explains it are **one card** (`.pie-split`: pie left; right a clickable section list, or the detail of the selected wedge), never a chart card plus a «nothing selected» card; (3) **empty states are compact** (28 px padding, 40 px icon), they never take the height of a content card; (4) lists are **table rows** (hairline separators, no 4 px gaps, no decorative lead icon on case rows); (5) a toolbar is **two rows**: search and actions, then the filters (`.filterbar.fb-stack` / `.fb-row` / `.fb-actions`); (6) a stat appears **once** (the strip), not again as tiles. Careful when editing CSS with regexes: removing a rule can leave a dangling selector glued to the next one (this once turned `.dash` into a dark-mode-only rule); parse with postcss and look for selectors that span lines.

**Premium: statuses are ink; icons carry meaning (owner decisions, Nov 2026).** (1) In «Premium» EVERY status badge, rating letter and `.p-dot` is the same ink dot next to the word: *colours ruin the vibe*. Semantic status colours remain in «Moviy» and in the semantic tokens (only the badge/dot presentation is overridden). The distribution chart and scores are monochrome bars (see “Change the score”). (2) **Where an icon must be read at a glance it is a SOLID glyph from ONE family** (`ui-custom/solid-icons`: Font Awesome 6 Free «Solid», icons CC BY 4.0 © Fonticons, Inc. (https://fontawesome.com/license/free: this line is the attribution), vendored as path data with its own viewBox; Phosphor fill and Remix fill were rejected as too thin, Font Awesome Solid was the heaviest of five families compared; thin lucide outlines and solid glyphs are never mixed on the same element): every `Kpi` tile takes an `icon` and Premium draws it big (132 px) with a blue-to-ink GRADIENT (`--ico-a` / `--ico-b`, one shared `<linearGradient id="sud-ico-grad">` mounted by the shell via `IconGradientDefs`; flat grey was rejected), vertically centred on the tile’s right edge so that only about half to 60 % shows, FADING OUT toward the edge with a mask (a hard cut at the tile divider looked like a glitch) (the owner wanted half, not the whole icon). **No hairlines between the tiles in Premium (`.kpis` gap 0): the icon marks each tile.** **The visible half must be the half that says what the icon is**: cut at exactly 50 % the asymmetric glyphs dissolved («Jami sud ishlari» gavel), so gavel, wallet and users are mirrored (`svg[data-ico=…]` in `look-premium.css`) so their head / clasp shows; check any new tile’s icon at 2x and add it to that list if its identity sits on the right. «Moviy» hides the icon. New tiles must pass an icon; a new status gets an entry in `STATUS_ICON`, not a colour. (3) Case rows are a table: `.lhead` + `.lrow[data-case]` with columns status icon, case and court, status word (the court's result, else the case status), date, chevron. There is **no claim-amount column: the court site does not give it** (do not add one back without checking the data). An empty status renders an empty cell so columns never shift; below 860 px the row folds.

**Half-icon fade (details).** The mask must reach FULL transparency a little before the tile edge, otherwise a faint tint is left and then chopped (seen on a phone): the icon box is 104 px (`right: -36px`, so ~68 px show), solid to 22 %, transparent at 58 %; **the box must always be SHORTER than the tile (the tile is 132 px high, the icon 104 px): at 132 px the glyphs touched the top and bottom edges and looked flat-cut**; on narrow tiles (≤700 px, the 2 x 2 phone layout) the icon is 84 px, lighter, with its own mask (16 % to 50 %) and stays out of the labels. Keep the narrow `@media` block AFTER the base `.kpi-ico` rule (it once lost to it).

**Dates: one component (owner, Nov 2026: «it looks like some random put in there»).** A hearing date is never laid out by hand («24 Noy 6 kun qoldi» in three type styles on one line). Everything goes through `proto/date-tile.tsx`: `DateTile` (a calendar leaf: month on an ink band, the day big under it, INVERTED when the date is within `NEAR_DAYS` = 7), `daysLabel` («Bugun» / «Ertaga» / «6 kun qoldi»), `HearingWhen` (time in mono over the countdown) and `dateParts` (day, month, weekday, whole days via `core/dates › daysUntil`). Used by the company-list column (`CardStats`, small tile + countdown + weekday), the Kuzatuv «Yaqinlashayotgan majlislar» rows, Majlislar and Statistika «Keyingi majlis» (`.datecard`: tile, court and case, when). Closeness is told by the inverted tile and a heavier countdown, never by a hue or a left bar. A new place that shows a hearing date uses these, not new markup.

**Premium: the only colour left is an ALERT (audited Nov 2026; tick and dots made ink on the owner's request).** A scan of every screen in both themes for any element painting a hue found only: the bell badge (red) and an overdue amount (red text); both stay, because each means «this needs you». State dots are ink and told apart by SHAPE (`look-premium.css` §12): good = solid, partly = half filled, bad / off = hollow ring; the sidebar status dot (`.sysstat[data-state]`) follows the same shapes in white, and the semantic `--status-positive-*` / `--status-warning-*` tokens are ink in Premium (so the «up to date» tick and every `pos`/`warn` text are ink), while Moviy keeps its colours. The notification rows used an amber calendar icon: replaced by the shared `DateTile` + countdown. Counter geometry: a number in a filled chip needs `box-sizing: border-box`, a height that leaves room for the figure PLUS the ring border (20 px chip, 11 px mono text, 2 px ring), `min-width` = height and `line-height: 1`; cap at «99+». Audit method: Playwright over every screen, flag any element whose colour/background/border/fill/stroke has saturation > 0.18, and any badge/counter whose text overflows its box or sits more than 1.5 px off its centre.

**Hisobot (PDF) follows the look (owner, Nov 2026), and the premium edition has its OWN STRUCTURE (second feedback: «the structure did not change at all, details did»).** `buildReportDoc(model, { look })` picks the edition; the app passes `getLook()` (`lib/report/generate`). **calm** = `lib/report/render.ts`, the original navy «Dossier» (rail on the left, pizza, dial, outcome hues), UNCHANGED and the default when no look is given, so its tests still guard it. **premium** = `lib/report/render-ink.ts`, verdict first, facts last, no rail: PAGE 1 is a full-bleed ink MASTHEAD (name, status, STIR, the rating as a number over a 51-tick ruler), «Xulosa» (the four key figures), then the outcome board (win rate, one strip of every case, four stat columns, per-court tiles) BESIDE «Diqqat» (what needs the reader now: the coming hearings as calendar leaves and the payments); then months beside the result wording, category tiles, the latest cases as a real TABLE with columns (Holat · Tomon · Rol · Ish raqami · Sana · Summa), and the registry facts as an appendix («Kompaniya maʼlumotlari», three columns + owners with share bars) at the END. One ink, outcomes told apart by fill (solid / tint / hatch / dashed), sentence-case labels, IBM Plex Sans (Plus Jakarta Sans behind it for ʻ ʼ) and Plex Mono, the logo as a one-ink watermark. When there are no hearings and no bills the board takes the whole row (no empty column). The two editions share the model, the escaping and the helpers exported from `render.ts`, nothing else: they are separate files because a print document draws different charts and has a different skeleton, and the model is the single source of the numbers. Tests: `render.test.ts` (calm), `render-ink.test.ts` (premium: reading order, no hue, strip and stat columns reconcile with the cases, ruler lit to the score, leaf near / not, table columns, weights ≤ 600, escaping). Check both with a REAL PDF (`page.pdf` + `pdftoppm`), not a screenshot: a full-page screenshot stretches `position: fixed` parts.

**Running header on pages 2+ (both editions).** `renderInkRunHead` / `renderReportRunHead`: company name · STIR on the left and «Hisobot · date» (ink) / «Kompaniya hisoboti» (navy) on the right, at the top of every printed page after the first. Mechanism: a `position: fixed` element repeats on every printed page, so page 1 HIDES it instead of the CSS skipping page 1 (`@page :first` margin boxes would need the company name inside a CSS string, i.e. escaping for CSS and for the `<style>` element): in the ink edition the opaque, positioned, higher-z-index masthead covers it; in the navy edition `.rp-cover` (an ABSOLUTE strip in the page colour over the first top margin, from the rail's edge to the right, so the rail keeps its colour) does. Two traps, both tested: the `@media print { .rp-runhead { position: fixed } }` rule must come AFTER the base `position: absolute` rule (equal specificity: the later one wins; the header silently never repeated when it came first), and the header must sit BEFORE the masthead in the document. The header text is escaped HTML; no company data goes into CSS.

**Motion in the black edition (Premium) (owner, Nov 2026: «premium, loading counting up, sliding and all»).** ONE file, `app/motion-premium.css`, declares every animation and transition of this look; it follows the unslop guide §9 and AGENTS.md. What moves, and why: (1) **one entrance per page**: cards rise 10 px with a fade in order (≤ 300 ms of stagger), stat tiles rise in turn and their big corner icons SLIDE in from the edge a beat later, the first 10 list rows rise one after another; (2) **figures count up**: `CountUp` on the Statistika tiles, the outcome board (win rate, per-status counts, tile totals; a pick TWEENS from the old figure), the rating in the company list, `Dial` (the ruler lights as it counts); keyed ones remember their value so a revisit does not replay; (3) **charts draw themselves**: the outcome strip is wiped open left to right (`clip-path`, re-keyed per slice so a pick replays it), month bars grow from the baseline (`scaleY`, stagger by index); (4) **indicators slide**: ONE element per group moved with `transform` only (`lib/use-thumb` measures the active button; the sidebar mark and its pill, the Settings tabs, the filter segment), PLACED on load (`.thumb-ready` turns transitions on after the first measurement) and animated on later changes; (5) **overlays** rise a few px from where they open (command palette, bell popover, badge), the drawer slides, the scrim only fades; (6) **loading**: the card's bar is revealed by `clip-path` (not width; `scaleX` gave it a square leading edge on a rounded track), the percentage counts with it, the active phase slides in, a finished phase's check pops, a quiet ink sweep runs over the bar and the skeletons (these are LIVE, so they may loop). Rules kept: only `transform`, `opacity` and (one-off) `clip-path` in keyframes; transitions NAME their properties and never touch layout (the old `flex-grow` transition on the outcome strip and the width transition of the loading bar were layout animations: removed); one easing curve and the `--dur-1..4` tokens; no bounce, no glow, no blur; entrances use `backwards` fill, so with motion off nothing is hidden. **Gate:** the last block of the file turns it ALL off for «Animatsiya: off» and for «auto» while the system asks for reduced motion (spinners keep turning); «on» overrides the system; script motion asks `motionReduced()`. Measured: with motion on a company page starts ~35 animations and animates only transform / opacity / clip-path / colours; reduced+auto and off start 0; a settled page runs 0 animations (0 style recalcs, 0 layouts in 3 s). Guard: `lib/__tests__/motion-css.test.ts` (keyframe and transition properties, token easing, no blur, only the two live loops, every rule scoped to the look, the gate, `backwards` fills, transform-only indicators). Moviy keeps the original motion in `prototype.css`. A new motion in Premium goes into `motion-premium.css` and passes that test.

**Docked detail (Sud ishlari, Toʻlovlar) instead of a slider (owner, Nov 2026: «court case info slider is still a slider»).** A case or a receipt is LIST + DETAIL: you step through them. On a screen ≥ 1360 px (`DOCK_QUERY` in `proto/drawer.tsx`) `openProtoDrawer(…, { dock: true, rowKey, nav })` DOCKS the detail as a column beside the list: below the topbar, no scrim, nothing dims, the page's scroller gets a right margin (`<html data-dock="open">`, `--dock-w`, `--topbar-h`), the open row is marked (`.lrow.sel`: ink bar, `useDockedRowKey()`), the header carries a position counter and ↑ ↓ buttons, and ↑ ↓ / k j step through the page's rows (not while typing), Esc closes; it is not modal (focus stays on the list). The detail swaps with a short fade-and-rise (`.drawer-swap`, re-keyed per row). Below 1360 px, and for every drawer that does not ask for `dock` (worker health, orders, ⌘K results), it stays the slide-over, now in ink (`look-premium.css` §13: `--dw-a` ink, neutral scrim, ink logo tile; it had kept the navy accent pair and a blue heading colour in dark). The rule: a drawer that is part of a list the reader walks through docks; a drawer that is an interruption slides.

**Print documents follow the look too.** `lib/print.ts`: `palette(dark, look)`, `currentLook()` (reads `<html data-look>`; without a DOM the original navy sheet, so tests keep guarding it), `buildPrintDoc(title, body, dark, look, fontFaceCss)`; the premium sheet is the same skeleton in ONE ink (`INK_OVERRIDES`: Plex type, weights ≤ 600, sentence-case labels, no tracked caps) and `printHtml` hands the print window the app's @font-face rules. The premium Hisobot's `inkTheme` is derived from the same `palette(dark, 'premium')`, so there is ONE premium print palette. Hisobot's «tayyorlanmoqda» and error pages use it as well. Tests: `lib/__tests__/print-look.test.ts`.

**No red left in Premium.** The `--status-negative-*` tokens are ink as well (the bell badge, an overdue amount, error text, the `alert.err` icon). What sat on a solid status colour must read on ink: error / success / warning toasts use `--accent` / `--accent-contrast` (they were white text on a now-light dark-mode colour), solid badges use `--accent-contrast`. Moviy keeps its colours.

**Loading line.** `lib/net-activity` counts the requests `api-client.request()` has in flight; `useBusy()` is true only after 220 ms and stays at least 420 ms (no flash); the shell draws a 2 px line under the topbar (`.topload`: a bar sweeping with `transform`, LIVE so it may loop; with motion off or reduced it is a steady half-opacity line). It only WATCHES requests a person started; nothing starts by itself.

**Phone (390 px).** The Kompaniya tab stacks below 900 px (the inline `1.5fr 1fr` is overridden with `!important` on `.prof-grid`), a hearing row keeps its time and countdown under the court name (`.datecard .dc-when`), `.card-h` wraps.

**Row highlights are rounded (owner: «sharp corner on case statuses when everything is round cornered»).** The Premium table rows had `border-radius: 0` and a `border-bottom`, so hover and the docked-detail selection were hard rectangles (with a square-ended bar) inside round cards. A `.lrow` is still a table row with a hairline between rows, but it bleeds 8 px past the text column with `--r-md`, the hairline is its `::after` (aligned with the header's line) and steps out of the way of a highlighted row and the one above it (`:has(+ .lrow:hover / .sel)`), and the selected marker is a 3 × 22 px rounded pill, not an inset shadow. Rule: a highlight is always rounded; never put a bottom border on an element that has a radius (the border curves with it).

**Square corners audit (Nov 2026).** Measured, not eyeballed: every element that paints a fill or a full border and has radius 0, on every screen and open overlay (static scan), plus every hover target's computed radius (dynamic scan). What is square ON PURPOSE: the sidebar and the docked detail pane (flush edge panels), the stat-tile cells (clipped by their rounded `.kpis` card), underline tabs (`.seg`, `.set-tabs`: no paint), bars that stand on a baseline (month bars are round on top only), the document preview paper, and the Moviy thumbnail rows in Settings › Koʻrinish. Everything else paints rounded; the last real misses were the row highlights and the loading bar's leading edge. A new surface that paints needs a radius from the scale; a highlight on a row inside a padded card is a rounded pill.

**Tinch removed, the navy look is back, and it is the WHOLE original (owner, Nov 2026: «remove tinch, get the navy back», then «you did not retrieve all the details of the navy look, take your time and fix it»).** Looks are **Premium** (default) and **Moviy** (`data-look='navy'`, `app/look-navy.css`). «Tinch» is gone; `parseLook('calm')` returns `premium`. The first restore only re-applied the declarations the unslop commit changed AND nothing touched later, so Moviy was old colours on new layouts and missed many details (KPI icon cards, the pizza, the gauge, company cards, rows, the sidebar rhythm). The second, complete pass: (1) **CSS**: the whole of `db29c3d`'s `globals.css` (tokens, `@layer base`, utilities) and `prototype.css` is scoped under `:root[data-look='navy']` with postcss (`[data-theme='dark'] x` → `:root[data-look='navy'][data-theme='dark'] x`; `html` → the root itself; old keyframes renamed `nv-*`; the `@layer` wrappers are KEPT, otherwise the old `* {border-color}` outranked Tailwind utilities and a pagination border was wrong). (2) **Neutralisers**: a newer base rule that sets a property on a selector the original also had, where the original did not set it (`.ccard` as a grid, `.badge::before` dot, `.lt` mono font …), is cancelled with `unset` at ZERO extra specificity (`:where(:root[data-look='navy']) …`, so any original rule still wins), generated by diffing selector by selector; `display`, `position`, `transform` and pseudo-elements are written out by hand at the top of the file; `!important` rules (`.p-card > .datecard`) are re-declared with `!important`. (3) **Markup** that the original had and the others do not, brought back with `useLook()` (or `getLook()` outside components): `Kpi` (outline icon chip beside the label, `ink` tile; `classic` overrides the icon twin), `Dial` (`proto/classic.tsx` `ClassicDial`: the hairline needle gauge), `Pizza`/`WinRing`/`PizzaDetail`/`PizzaKey` (same file) with the mini court cards and the «Sud turi boʻyicha yutuq» rows in Statistika, `CardStats` (day + month + «N kun qoldi»), the Launcher hero (eyebrow, gradient words), outline «Yangilash»/«Kompaniya qoʻshish» buttons, case rows (gavel tile, status badge, amount) and the one-row filter bar in Sud ishlari, the Kompaniya tab's rating card (200 px gauge, category badge), `DateTile`/`HearingWhen` (the big day over the month, the plain time), the Kuzatuv «N ta majlis 7 kun ichida» alert and card wrapper, the bell popover rows (icon chip, `dd.mm`), `ScrapeProgress` (width fill, no percentage), Health labels (uppercase), `Seg` (the thumb slides with left/top/width/height) and slide-over drawers for cases and receipts (no docking, no ↑ ↓). (4) Deliberate differences from the original: the sidebar status line says what the workers are really doing (the original always said «sogʻlom»), the extra Settings tab «Koʻrinish», copy-on-click case numbers, grouped claim amounts, the thin load line under the top bar. **Method, so the next change does not drift:** check out `db29c3d` into a worktree (`.orig-navy`, `turbopack.root` pointing at the repo), run both apps on mocked data (`:3001` original, `:3000` current, `look=navy`) and diff the computed styles of both DOMs element by element (a script that walks both trees and prints the properties that differ), plus screenshots in light and dark at 1440, 960 and 700. Do not regenerate the file; edit it by hand. The Hisobot in this look is the navy «Dossier» (`lib/report/render.ts`, `look: 'navy'`, also the default when no look is given) and the generic print sheet is the navy sheet (`palette(dark, 'navy')`).

**Print documents are checked by RENDERING them (Nov 2026).** The app writes each print document into a popup with `document.open/write` and closes it 400 ms after `print()`, so a test harness cannot screenshot the popup. Stub `window.open` in the page (an object with `document.open/write/close`, `focus`, `print`, `close`, `addEventListener`, `readyState: 'complete'`) to capture the HTML the app writes, then `document.write` it into a SAME-ORIGIN page (web fonts are CORS-sensitive: from `about:blank` they do not load) and take `page.pdf()` / a screenshot. Done for Hisobot (both editions), the cases list, a case detail and a receipt in both looks. Found and fixed this way: receipts and the bills list printed «12 Sept 2026, 10:00» (`billing-format.formatDate` used `toLocaleString('en-GB')`: an English month in an Uzbek document; now `dd.mm.yyyy HH:MM`), and bare claim amounts printed ungrouped (`formatClaimAmount`: «1000000» → «1 000 000», already-formatted and text values untouched).

**«courtType notoʻgʻri» (Nov 2026).** billing.sud.uz names a court type with its own codes (`ECONOMIC`, `CITIZEN`, `ADMINISTRATIVE`, `CRIMINAL`, `MILITARY`); the case API takes `economic` / `civil` / `criminal` / `administrative`. A receipt's «open the case» sent the billing code through the `sud:open-case` event and the API refused it. `core/billing-format › normalizeCourtType` is the ONE translation (case-insensitive, either vocabulary, `null` for what has no equivalent: MILITARY, unknown); the event listener in `sections/cases.tsx` falls back to `economic` on null, and `api-client` `searchCases` / `getCaseDetail` normalise as a second line of defence. The route itself stays strict. Test: `core/__tests__/court-type.test.ts`.

**Outcome board is a control, not a picture (owner, Nov 2026: «hard to get what is below the big bar … make them active»).** In Statistika (Premium) each of the four counts has a swatch bar on top that is the SAME fill as its segment in the strip (the legend is matched by pattern, not by position: the old tiny swatch at the right of each label was removed); pointing at a count (or a segment) steps the other segments back (`data-hot`). A click on a count or a segment opens Sud ishlari with that outcome (and the picked court type / category): `OutcomeBoard onOutcome` → `goCasesFiltered(court, query, outcome)` → one-shot `caseOutcomeFilter` in the store (like `caseCourtFilter`, applied then cleared; it also resets the side filter, and the court filter when no slice is picked). The list shows a removable chip «Natija: Jarayonda ×»; the filter uses `classifyOutcome(side ?? 'plaintiff', result)`, the same class the board counts. «Ishlarni koʻrish» is `btn-xs`. Moviy keeps its pizza (no outcome click).

**The instance track is not a fixed chain (owner, Nov 2026: «appeal is about a month, cassation up to six, you can skip appeal, taftish comes after whichever it is … so it does not look like broken logic»).** `core/instance-track` (`buildTrack`, tested in `core/__tests__/instance-track.test.ts`) gives every step a state: **done** (a record), **skipped** («Oʻtkazilgan»: no record but a LATER instance has one; the complaint was not filed there, drawn as a hollow dashed dot with the line jumping over it), **open** (no record, the filing window counted from the latest ruling is running: «N kun qoldi», an inked ring), **closed** («Berilmagan»: window over, neutral: a missed term can be restored for a good reason, so «too late» is never claimed), **none** («Hali yoʻq»: still being heard, or taftish which has no window). The step the case is in now (`general.currentInstance`) gets an outer ring. The windows are ESTIMATES for the hint only: appeal 1 month, cassation 6 months (12 for administrative cases: Kun.uz, Jan 2021, reports a year there), counted from the latest ruling of the instances before; the day of a ruling is the instance's last hearing (the case data's own «decision date» is the registration date). The figures come from the owner; an automated web search did NOT confirm them from lex.uz (checked Nov 2026), so they live in two constants (`APPEAL_MONTHS`, `cassationMonths`) and the tooltip says «taxminiy» and that the court can restore a missed term. Nothing is blocked or hidden by them.

