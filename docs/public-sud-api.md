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
| `GET /public/onStream/<pdf.id>` | The order file. **Not** the row `id` (that returns 0 bytes). Response is `multipart/form-data`-wrapped: `--boundary\r\nContent-Disposition: form-data; name="file"; filename="…"\r\nContent-Type: application/octet-stream\r\nContent-Length: N\r\n\r\n<N bytes of %PDF>\r\n--boundary--`. Cut the PDF out by `Content-Length`. |

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
- **Date-window list = fast** (probe #4): 50–240 ms per page of 100, ~219 rows/s sequential, 3 parallel pages tolerated.
  Whole-year and case-number combinations are slow or return nothing useful. So `lib/public-orders/engine.ts` crawls one
  DAY at a time (`startDate = endDate`), newest first, until 60 empty days in a row; each day is checked against the API's own total.
- The date filter's exact meaning (publication vs decision date) is **unverified** — the known order (decided 12 May 2026) was not
  inside 11–19 May for its court. It does not matter for a full crawl (every order sits in some day window), only for guessing a window.
- Index: `data/public-orders/shards/*.jsonl` (512 shards by FNV hash of the case number) + `state.json` (progress). Delete the folder to reset.

## Update: per-case download is the default, the full crawl is optional
The full crawl is disk-heavy (~200 B a row: ~40 MB economic, ~90 MB civil, ~15 MB administrative) and was not wanted on the owner's laptop.
The default is now `lib/public-orders/company-job.ts`: only the cases the user asks for are looked up (`case_number` + `instance`, ~10 s each,
3 instances in parallel, one case at a time), in the background, with a «checked» marker per case. The API is called directly from the machine
(`PUBLIC_ORDERS_VIA_WORKERS=1` to use the workers).
