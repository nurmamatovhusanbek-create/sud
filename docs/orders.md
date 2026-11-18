# Published court orders («Qarorlar») — feature guide

Upstream facts (endpoints, speeds, gotchas): [public-sud-api.md](./public-sud-api.md). Where each file sits in the
app: [MAP.md](./MAP.md). Security of the job endpoints: [SECURITY.md](./SECURITY.md).

## Files

| Layer | File | Job |
|---|---|---|
| Pure | `src/core/public-orders.ts` | row compaction, labels, multipart PDF parser, `splitDecisions`, **`planCheck`** (when to look again), **`isOngoingFirstInstance`**, `orderJobCase` + `caseSignature` |
| Server | `src/lib/public-orders/source.ts` | upstream calls (`searchCase`, `searchLegacyCase`, `fetchOrderFile`); direct by default, `PUBLIC_ORDERS_VIA_WORKERS=1` → workers |
| | `engine.ts` | `lookupCase(deps, job)` — I/O injected; 3 instances in parallel; keeps only rows whose case number equals the job's |
| | `company-job.ts` | the queue: `planCases` (DETECT, free), `enqueueCases` (SCRAPE), pause/resume/cancel/`retryFailed`; `globalThis.__publicOrdersJob`; `MAX_QUEUE` |
| | `store.ts`, `data-dir.ts` | shard files + `checked.jsonl` in `~/.sud-tizimi/public-orders` (`PUBLIC_ORDERS_DIR`); `cacheStats` |
| API | `app/api/public-orders/{fetch,status,orders,file,cache,import,library}` | `fetch`: `{action: start|plan|pause|resume|cancel|retry}`; `import`: the hand-over of a PDF (below) |
| | `lib/registry.ts` | `meta.orderCases` (compact case list) written whenever stats are read → Kuzatuv can DETECT without scraping |
| UI | `proto/case-orders.tsx` | the case drawer: published orders from the local records + the per-case «Tekshirish» (live; blocked while the site's firewall refuses scripts) |
| | `views/orders-settings.tsx` | Settings › Qarorlar: the cache and backup numbers only |
| | `views/orders-view.tsx`, `proto/order-handover.tsx` | the **Qarorlar page** (sidebar, below Statistika; surface `orders`): filter bar like Sud ishlari (search, court type, instance, download state: Yuklangan / Yuklanmagan / Mavjud emas / Hammasi), `.lrow` list, shared `ListPagination`; server-side filter + paging (`core/public-orders` `searchLibrary`; `GET /library?q&status=saved|gone|never|all&court&instance&page&size` = `store.allOrders` + `pdf-store.listPdfs` + `pdf-store.syncDownloads`); «Yuklangan · size · date» when the PDF is on disk; click = open (fetched if missing, same hand-over as the drawer); orders come in through the HAR hand-over below and the case drawer's check (the typed-number search card was removed: public.sud.uz refuses scripts); «Yuklab olish» / «Hammasini yuklab olish» save the PDFs (`downloadPublicOrderPdf`: the server stores them, nothing opens); each row has an explicit button (**Ochish** / **Yuklab olish** / **Qayta yuklash**), rows are not clickable |
| | `proto/case-orders.tsx` | drawer cards «Eʼlon qilingan / qilinmagan» |
| | `sections/cases.tsx` | «Qarorlar · N» button, drawer wiring, `orderJobCase` |

## Rules (each one was a bug or an owner decision)

1. **Only cases the owner cares about** (Kuzatuv companies, a Sud ishlari list, one drawer). No full-library crawl (laptop/disk).
2. **A published order is permanent.** An instance with a stored order is never asked again; all four (first, appeal, cassation, taftish) stored = done for good.
3. **Re-check only when it can matter:** the case signature changed (status/result — e.g. appealed), or a publication-lag back-off elapsed (3 d, 14 d, 45 d, then wait). A failed search is retried after 10 min and is **never** recorded as «none».
4. **Still heard in the first instance (no result, «ish yurituvda» / «koʻrib chiqilmoqda») ⇒ no decision ⇒ not queued.** Appeal / cassation / supervision ⇒ checked (its first-instance order exists). Unrecognised wording ⇒ checked. A hand «Tekshirish» overrides.
5. **Nothing starts by itself and nothing nags.** Opening/refreshing/switching pages or tabs never queues or scrapes. DETECT (`plan`) is free and only shows a count («Qarorlar · N», «N ta ish tekshirilishi kerak»). SCRAPE runs from a click or the opt-in idle check.
6. **The pill exists only while scraping**; ✕ hides it for that run (sessionStorage); paused/failed/finished leave no pill — one toast at the end (with «Qayta urinish»); a paused queue is continued from Kuzatuv or Settings.
7. **Pause really pauses:** state flips at once, the case in flight finishes, the queue keeps its order, resume continues with the same counters. Automatic feeders send `keepPaused` so they cannot undo a pause.
8. **The cache is never deleted by the app** (no clear button, no DELETE route). It lives outside the project; writes only append (newer line wins on read); files are `0600`, dir `0700`.
9. **One shape, one signature:** every caller builds jobs with `orderJobCase` (status + result). Two shapes ⇒ screens keep «changing» each other's cases.
10. **One status poll** (`use-orders-job.ts`); local reads (`status`, `cache`, `orders`) are exempt from the scrape rate limit, `plan/start/...` are not.
11. **Searches are slow** (≈10 s per `case_number`+`instance`, a minute+ without instance) ⇒ background only, one case at a time, 3 instance searches in parallel. Never hedge/duplicate them.
12. **A PDF may need a person («Qoʻlda yuklash»).** public.sud.uz now accepts a download only with a token from a SOLVED human challenge (`public-sud-api.md`). When every automatic route is refused, `GET /file` answers `409 manual_required` and the automatic route rests for 30 min (`ManualDownloadRequired`, no more captchas burned; `&retry=1` = the card's «Avtomatik qayta urinish»). The order card then offers: open public.sud.uz, save the PDF there, pick it → `POST /api/public-orders/import?id=<pdf id>` (raw body, up to 100 MB: `guard({maxBodyBytes})`; only a real `%PDF-` is kept, a site-wrapped multipart file is unwrapped) → stored in `files/` exactly like an automatic download, so every later click is served from disk. The id comes from the card the person picked, never from the file. Listing/search and the case database are unaffected.
13. **Every PDF the person opens is kept, forever** (`files/<pdf id>.pdf`; the file route writes it on the first download, the import route on a hand-over), and the Qarorlar page shows exactly which ones are on disk. **Deleting a saved PDF is noticed:** `files/` alone cannot say whether a file ever existed, so every save appends a line to `downloads.jsonl` (pdf id, size, time, the court's file name; newest line wins; never deleted by the app), and the page lists a file that is in the log but not on disk as **«Mavjud emas»** (its old size and date kept); a PDF already on disk when the log started gets a `seen` line the first time the page is read, so deleting THOSE is recognised too. Clicking such a row downloads it again from the stored order data (the row's `pdfId`) and the state returns to «Yuklangan». The background check stores only the small order rows, never PDFs (one captcha per PDF would turn a check into a crawl). Searching is a local read: typing never reaches public.sud.uz.
14a. **A download must really reach the server, and the server must say whether it kept the file.** `GET /file` answers `Cache-Control: private, no-store` and the client fetches with `cache: 'no-store'` (every JSON read of the app too): a browser-cached PDF used to answer a later click («Yuklab olish» / «Qayta yuklash») WITHOUT the server seeing it, so the file was never (re)saved and the order could not move to «Yuklangan». The response carries `X-Order-Saved: 1|0` (+ `X-Order-Save-Error`); the loader reports `saved` (a failed write is NOT swallowed any more: the PDF is still returned, the page says it was not kept and why). `pdf-store.writePdf` retries the rename (Windows antivirus holds a fresh file: EPERM / EBUSY), falls back to a copy, and verifies the size. On the Qarorlar page, **«Barchasini yuklash (N)»** (Yuklanmagan view; «Barchasini qayta yuklash» in Mavjud emas) collects the orders of the current filters across ALL pages, downloads them one by one, re-reads the lists and counts after each, stops at the first order that needs a person or the first file the server could not keep, and has «Toʻxtatish».
14. **Two back ends.** Every check asks the library (after 2024, 4 instance searches) AND the pre-2024 back end (one `caseNumber` search; `searchLegacyCase`), because one case may have orders in both. Pre-2024 orders get ids `old-<type>-<n>` (stored like any order; `isOrderFileId`/`orderFilePath` accept only that shape). **Criminal** is never crawled and has no company link: the person types a case number on the Qarorlar page (the «public.sud.uz dan qidirish» box, court picked from the number's first digit) and only that case is looked up. Criminal PDFs are scans (no text layer) and name defendants: keep it lookup-by-number.
15. **Metadata has a protected second copy** (`lib/public-orders/meta-backup.ts`, scheduled by `meta-backup-runner.ts`). The order index (`shards/*.jsonl`), the check records and the download log are mirrored to the OS app-data folder (Windows `%LOCALAPPDATA%\SudTizimi\orders-backup`, macOS `~/Library/Application Support/SudTizimi/…`, Linux `~/.local/share/sud-tizimi/…`; `PUBLIC_ORDERS_BACKUP_DIR` overrides, `off` disables; with `PUBLIC_ORDERS_DIR` set there is no backup unless that variable is given): `latest/` ≈ 15 s after any write, plus `daily/<date>/` (7 kept). The mirror never deletes and never replaces a file with a smaller one (the files are append-only: smaller = damaged). At the first use of the data folder, a metadata file that is **missing or empty is restored** from `latest/`; existing files are never overwritten. So deleting `~/.sud-tizimi/public-orders` by accident loses only the PDFs, which then show «Mavjud emas» and re-download. The PDFs are not copied. To really wipe the cache, delete both folders (Settings › Qarorlar shows both paths).
16. PDFs are anonymised, rows carry no parties/STIR; only look up cases the owner opened/watches.

## Flow

```
drawer «Tekshirish» ─► POST /fetch {start,cases}   (the Kuzatuv / list bulk checks and the idle auto-check were removed)
                                              planCases (planCheck + ongoing filter)
                                              └─► queue ─► loop: lookupCase ─► source ─► store
a person-saved HAR / PDF ─► POST /import-har | /import ─► files/ + shards (the way new orders come in while the site refuses scripts)
```

## Hand-over by HAR (how an order gets in while the site refuses scripts)

For the person, step by step (the same text is in the app: `HarHowTo` in `proto/order-handover.tsx`):

1. In YOUR browser open public.sud.uz, press **F12** › **Network** (keep it open), then search the case again (the search answer must be in the log too: it carries the case number, court and instance) and open the order.
2. Network toolbar › **Export HAR (sanitized)**. If the importer says the file has no contents, export **with sensitive data** instead (older Chrome: «Save all as HAR with content»).
3. Qarorlar › **HAR fayldan yuklash** › pick that one file.

What the importer does (`lib/public-orders/har-import`, `POST /import-har`): reads ONLY each entry's URL path and response body; stores every order file under the id in its own path, and adds the order RECORDS from the browser's own search answers in the same file, so each file lands on a card. It never reads cookies, tokens or headers and sends no request to any site; the file itself is local and not kept (`*.har` is in `.gitignore`). Limits: 256 MB per file, at most 500 order files per HAR (`MAX_HAR_FILES`); Next's own body cap is raised to 300 MB in `next.config.ts` (`proxyClientMaxBodySize`, tested in `server/__tests__/body-limit.test.ts`: the default 10 MB cut a body silently).
A file with no matching record is reported to the person and in dev.log (`[orders-har]`).

**Tozalash:** in «Yuklanmagan» / «Mavjud emas» tick orders to download them, clear the ticked, or clear the rest. Cleared ids sit in `hidden.json` (`hidden-store`); the order records stay. A search finds a cleared order again (badge «Tozalangan», «Qaytarish», «Yuklab olish»); a downloaded order is never hidden.

## Tests
`core/__tests__/public-orders.test.ts` (policy) · `lib/public-orders/__tests__/{engine,company-job,store,data-dir,order-file,order-pdf,import-route,library}.test.ts`.
Live scraping does not work in the sandbox: e2e uses a mock upstream (`PUBLIC_ORDERS_API=http://localhost:PORT`) and
mocked `/api/stats` (see AGENTS §1).
