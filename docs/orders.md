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
| Client | `lib/orders-watchlist.ts` | Kuzatuv run (`checkWatchlistOrders`), `planWatchlistOrders`, pause/resume, opt-in switch (`sud-orders-auto`, default OFF) |
| | `lib/use-orders-job.ts` | ONE shared status poll for every consumer |
| | `lib/registry.ts` | `meta.orderCases` (compact case list) written whenever stats are read → Kuzatuv can DETECT without scraping |
| UI | `shell/orders-loader.tsx` | the pill: only while scraping; announces the end with a toast |
| | `shell/orders-auto-check.tsx` | opt-in idle watcher (3 min without input, ≤ once / 6 h) |
| | `views/orders-control.tsx` | Kuzatuv button + status line + switch |
| | `views/orders-settings.tsx` | Settings › Qarorlar control panel only (queue, cache numbers) |
| | `views/orders-view.tsx`, `proto/order-handover.tsx` | the **Qarorlar page** (sidebar, below Statistika; surface `orders`): filter bar like Sud ishlari (search, court type, instance, download state: Yuklangan / Yuklanmagan / Mavjud emas / Hammasi), `.lrow` list, shared `ListPagination`; server-side filter + paging (`core/public-orders` `searchLibrary`; `GET /library?q&status=saved|gone|never|all&court&instance&page&size` = `store.allOrders` + `pdf-store.listPdfs` + `pdf-store.syncDownloads`); «Yuklangan · size · date» when the PDF is on disk; click = open (fetched if missing, same hand-over as the drawer); the «Yangi qaror qidirish va yuklab olish» card on top looks ONE typed case number up on public.sud.uz (both back ends) and lists what it found; «Yuklab olish» / «Hammasini yuklab olish» save the PDFs (`downloadPublicOrderPdf`: the server stores them, nothing opens); each row has an explicit button (**Ochish** / **Yuklab olish** / **Qayta yuklash**), rows are not clickable |
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
14. **Two back ends.** Every check asks the library (after 2024, 4 instance searches) AND the pre-2024 back end (one `caseNumber` search; `searchLegacyCase`), because one case may have orders in both. Pre-2024 orders get ids `old-<type>-<n>` (stored like any order; `isOrderFileId`/`orderFilePath` accept only that shape). **Criminal** is never crawled and has no company link: the person types a case number on the Qarorlar page (the «public.sud.uz dan qidirish» box, court picked from the number's first digit) and only that case is looked up. Criminal PDFs are scans (no text layer) and name defendants: keep it lookup-by-number.
15. **Metadata has a protected second copy** (`lib/public-orders/meta-backup.ts`, scheduled by `meta-backup-runner.ts`). The order index (`shards/*.jsonl`), the check records and the download log are mirrored to the OS app-data folder (Windows `%LOCALAPPDATA%\SudTizimi\orders-backup`, macOS `~/Library/Application Support/SudTizimi/…`, Linux `~/.local/share/sud-tizimi/…`; `PUBLIC_ORDERS_BACKUP_DIR` overrides, `off` disables; with `PUBLIC_ORDERS_DIR` set there is no backup unless that variable is given): `latest/` ≈ 15 s after any write, plus `daily/<date>/` (7 kept). The mirror never deletes and never replaces a file with a smaller one (the files are append-only: smaller = damaged). At the first use of the data folder, a metadata file that is **missing or empty is restored** from `latest/`; existing files are never overwritten. So deleting `~/.sud-tizimi/public-orders` by accident loses only the PDFs, which then show «Mavjud emas» and re-download. The PDFs are not copied. To really wipe the cache, delete both folders (Settings › Qarorlar shows both paths).
16. PDFs are anonymised, rows carry no parties/STIR; only look up cases the owner opened/watches.

## Flow

```
click «Qarorlarni tekshirish» (Kuzatuv) ─► checkWatchlistOrders ─► getStats per company ─► POST /fetch {start,cases}
list «Qarorlar · N» / drawer «Tekshirish» ───────────────────────────────────────────────► POST /fetch {start,cases}
                                                                        planCases (planCheck + ongoing filter)
                                                                        └─► queue ─► loop: lookupCase ─► source ─► store
GET /status ◄── use-orders-job (one poll while running) ──► pill · Kuzatuv line · Settings · «Qarorlar · N»
end of run (running→done/error) ─► toast (+ «Qayta urinish» → POST /fetch {retry})
```

## Tests
`core/__tests__/public-orders.test.ts` (policy) · `lib/public-orders/__tests__/{engine,company-job,store,data-dir,order-file,order-pdf,import-route,library}.test.ts`.
Live scraping does not work in the sandbox: e2e uses a mock upstream (`PUBLIC_ORDERS_API=http://localhost:PORT`) and
mocked `/api/stats` (see AGENTS §1).
