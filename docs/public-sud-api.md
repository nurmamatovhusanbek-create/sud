# public.sud.uz — the public court-order library (what we learned)

Found by reading the site's own network traffic and JavaScript (`scripts/explore-public-sud*.mjs`).
The sandbox cannot reach these hosts (egress policy), so everything below comes from the owner's
captures; treat unlisted behaviour as **unknown**.

**Base:** `https://adolatapi1.sud.uz` — anonymous JSON API (CORS from `https://public.sud.uz`, no token, no cookie).

## Endpoints
| Call | Notes |
|---|---|
| `GET /publications/list?size&page&court_type=` | `court_type` = `ECONOMIC` (~184k orders) · `CIVIL` (~429k) · `ADMINISTRATIVE` (~64k) · `CRIMINAL` (empty). `size` max **100** (larger is clamped). |
| …extra filters (from the site's own form) | `case_number`, `category_id`, `court_id`, `startDate` / `endDate` (`YYYY-MM-DD`), `document_type_id`, `instance` (`FIRST` `APPEAL` `CASSATION` `CASSATION_REPEATED`), `judge_id`, `is_movable_property` (had no visible effect). Administrative also sends `withCreated=true`. |
| `GET /publications/courts?claim_type=` · `/categories?claim_type=` · `/document_types` · `/judges/<courtId>` | Dictionaries. Names are `{uz, uz_cyr, ru, qq}`. Administrative/criminal have no category list. |
| `GET /publications/count_by_court_type?court_type=` · `count_by_instance` · `count_by_regions` · `count_by_years` · `count_by_categories` | Cheap aggregates. |
| `GET /public/onStream/<pdf.id>` | The order file. **Not** the row `id` (that returns 0 bytes). Response is `multipart/form-data`-wrapped: `--boundary\r\nContent-Disposition: form-data; name="file"; filename="…"\r\nContent-Type: application/octet-stream\r\nContent-Length: N\r\n\r\n<N bytes of %PDF>\r\n--boundary--`. Cut the PDF out by `Content-Length`. **Needs a captcha token** since late 2026: `?recaptcha_token=<t>`, else HTTP 403 `{"message":"Каптча тасдиқланмади"}`. The token comes from recaptcha.sud.uz (siteKey `site_1842e42b6e31fb21ac22c681def0e326`, action `download`; same PoW → analyze → math-picture API as billing, see `getCaptchaToken(…, PUBLIC_DOWNLOAD_CAPTCHA)`). It is single-use and possibly tied to who asked: ONE route mints it and sends the download, unhedged: first this machine itself (Origin/Referer `https://public.sud.uz`, like the page), then up to two different workers on a refusal (`public-orders/order-file.ts`; the server log prints `[orders-file] … HTTP 403: <body>` and `[captcha] analyze result: score=…`). Needs, when the risk analysis asks for the picture, a VLM key (Settings › Captcha). The list/search endpoint stays open. **Nov 2026 change (seen in a real browser capture + our server log):** the page now sends a different, richer `signals` object (`mouse.avgSpeed/curvatureVariance…`, `keyboard.keystrokeCount`, `timing.pageLoadToTokenRequest`, `fingerprint.canvasHash/webglRenderer`, `botFlags`, `pow:{solved:false}`), its `analyze` answers with a picture challenge, and the token that opens the file is the one `challenge/solve` returns. Our analyze returned `score≥0.95` and a token WITHOUT a challenge, but `onStream` then answers 403 «Каптча тасдиқланмади» (direct and via workers alike): a token that never went through a solved challenge is no longer accepted for downloads. The file itself now arrives as `application/octet-stream` with `Content-Disposition: attachment; filename=<court's name>.pdf`. We do NOT fake a person's mouse/keyboard signals to get a challenge-free token; the app hands the download to the person (see orders.md «Qo‘lda yuklash»). |

## A list row
`id`, `case_number`, `instance`, `court_names{…}`, `categories[{…}]`, `responsible_judge_name`, `speaker_judge_name`,
`document_type_name{…}`, `hearing_date` (null in samples), `pdf{ id, name, mime_type, size }`, and
`result` — a **fixed enum**: `FULFILLED` · `PARTIALLY_FULFILLED` · `REFUSED` · `RETURNED` · `UNCONSIDERED` · `CASE_ENDED`.
Maps 1:1 onto `core/classify.ts` (granted / rad etilgan / qaytarilgan / ko'rmasdan qoldirilgan / tugatilgan).
`instance` is per order, so one case can have several rows (first instance, appeal, cassation).

## Gotchas
- **No parties, no STIR in rows — and the PDFs are anonymised** (names shown as «ХХХХХХХ» / `*****`, case numbers partly masked).
  A company can only be linked through a case number we already have from the court-case lookups. Do not bulk-harvest the library.
- **`case_number` alone is a full scan: 75–112 s** (repeat calls are not faster). Never call it interactively.
  Narrow it (`court_id`, a date window, `instance`) — see probe #3 for which combination is fast.
- List pages take ~1–2 s at size 30–100; counts 0.1–2.6 s; a PDF 0.1–0.2 s.
- Dates are ISO here (`YYYY-MM-DD`), unlike the `dd.mm.yyyy` from jadval.sud.uz.

## What we built on it
Only the orders of the cases the owner cares about are fetched (no library copy: the full day-by-day crawl was measured at ~40–90 MB
per court type and was dropped). `lib/public-orders/engine.ts` (`lookupCase`) asks `case_number` + `instance` (~10 s) for FIRST, APPEAL,
CASSATION and INSPECTION (the site's «Taftish», added Nov 2026: a supervisory order was never found before) in parallel, in the background, and keeps only rows whose case number equals the case's (the search is a «contains»).
The policy lives in `core/public-orders.ts` (`planCheck`, unit-tested):
- **A published order is permanent.** Once an instance has one it is never asked about again; when all four are stored the case is done for good.
- A case is re-checked only when its **signature** (status + result + hearing date) changes, e.g. it was appealed, or by a
  publication-lag back-off (3 d, 14 d, 45 d after the last fruitless check, then it waits for a change).
- A failed search is an error retried after 10 minutes, never a false «no orders».
- A case still heard in the first instance (no result, status «ish yurituvda» / «koʻrib chiqilmoqda» or none) has no decision, so it is not queued at all (`isOngoingFirstInstance`); one in appeal / cassation / supervision is, because its first-instance order exists. Anything unrecognised is checked (conservative).
- The queue can be paused (the case in flight finishes, the rest keeps its order), resumed (same counters) or cancelled; Settings › Qarorlar shows and controls it.
- Who triggers it: only an explicit action — the **Kuzatuv** page («Qarorlarni tekshirish»), Sud ishlari «Qarorlar», a drawer's «Tekshirish» (forced) — or the opt-in «Boʻsh vaqtda avto» switch (default OFF; runs after 3 min without input, at most every 6 h, only while the app is open). Opening / refreshing / switching pages never starts anything. The number of cases that would need a look is a free local call (`plan`).
- Storage: `~/.sud-tizimi/public-orders/shards/*.jsonl` (512 shards by FNV hash of the case number) + `checked.jsonl` (one record per case), outside the project on purpose. **It is never deleted by the app**, only appended to (a newer line wins on read); an older in-project `data/public-orders` is copied over once.
- Order PDFs: `files/<pdf id>.pdf` next to the shards, written after the first download (only a real `%PDF-`, temp file + rename, 0600), never deleted. A published order never changes, so each file costs ONE captcha, ever; `GET /api/public-orders/file` serves it from disk. Fresh downloads go through one queue (one captcha session at a time, 2 s gap) and a second request for the same order joins the running one (`lib/public-orders/order-pdf.ts`, `pdf-store.ts`). The Settings › Qarorlar numbers count the shards only, not these files.
- The API is called directly from the machine (`PUBLIC_ORDERS_VIA_WORKERS=1` to use the workers).
- The date filter's meaning (publication vs decision date) is **unverified**; nothing depends on it now.

## Two systems: «2024 dan keyingi» and «2024 dan avval» (both supported since Nov 2026)
public.sud.uz serves cases decided before 2024 and after it from DIFFERENT back ends (seen in browser captures, Nov 2026; response bodies were not
in the captures; the row shapes below were probed live with a throw-away script):

| | after 2024 («new») | before 2024 («old») |
|---|---|---|
| list | `GET /publications/list?court_type=ECONOMIC|CIVIL|ADMINISTRATIVE` (`case_number`, `instance`) | civil: `GET /publication-proxy/api/civil/publication/page?size&page&court_type=CIVIL` · administrative: `GET /publication-proxy/unauthorized/administrative/conflict?type=17&size&page&court_type=ADMINISTRATIVE` · economic: (capture pending) · criminal: `GET /publication-proxy/criminal/findAll?size&page&court_type=CRIMINAL` (the `data` field is a JSON string) |
| file | `GET /public/onStream/<uuid>?recaptcha_token=` (octet-stream, multipart-wrapped PDF) | `GET /publication-proxy/api/file/civil/<claimId>/?recaptcha_token=` · `…/api/file/administrative/<claimId>/<type>?…` · `…/api/file/criminal/<claimId>/?…` (plain `application/pdf`) |
| ids | uuid | numeric `claimId` (NOT `id`/`alteredId`) |
| captcha | pow → analyze (action `download`) → solve → token | the same recaptcha.sud.uz service |

The page route `/report/ECONOMIC_NEW` is only the page's address: `court_type=ECONOMIC_NEW` is HTTP 500 on `/publications/list`, and `SUPERVISION` is HTTP 400 as an
`instance`; valid `instance` filters are FIRST, APPEAL, CASSATION, CASSATION_REPEATED, INSPECTION (the site's «Taftish»). A 2025 case
(`4-1102-2502/3291`, a supervisory order) is in the NEW system and is found through `instance=INSPECTION`, which our lookup did not ask for before.

**Pre-2024 adapter (built from the probed rows).** All four lists accept `caseNumber=<exact>` (verified live: 1 row for a single case). Rows: `claimId`
(numeric), `caseNumber`, `dbName` (court), `judge`, `category`/`claimCategory`, `instance` (int 1..4 = first, appeal, cassation, taftish: 1 and 3 seen, the rest by analogy),
`result` (an enum such as `PARTIALLY_FULFILLED`, `CASSATION_REJECTED`); civil adds `fileData{id,name,size}`; **economic keeps the file id inside
`attachmentsList[].fileData.id`** (NOT the claimId); criminal's `data` is a JSON string. File keys → ids `old-<type>-<key>`: economic = that attachment's file id,
civil / criminal = `claimId`, administrative = `claimId-17` (`core/public-orders` `orderFilePath` is the ONE place that maps an id to a path). The pre-2024 file answers a plain
`application/pdf`; the economic one needed a second picture attempt in the capture, which `getCaptchaToken`'s retry loop covers. **Criminal**: the list + `caseNumber` filter were
verified live; the file path `/api/file/criminal/<claimId>/` comes from the owner's own client (it was not in the browser captures), so the first criminal download is the real test.
Criminal has no library rows, so only the pre-2024 endpoint is asked for it. `lookupCase` asks both systems for every case (a case can have its first instance before 2024 and its appeal after).
