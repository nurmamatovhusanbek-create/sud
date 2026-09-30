# Published court orders («Qarorlar») — feature guide

Upstream facts (endpoints, speeds, gotchas): [public-sud-api.md](./public-sud-api.md). Where each file sits in the
app: [MAP.md](./MAP.md). Security of the job endpoints: [SECURITY.md](./SECURITY.md).

## Files

| Layer | File | Job |
|---|---|---|
| Pure | `src/core/public-orders.ts` | row compaction, labels, multipart PDF parser, `splitDecisions`, **`planCheck`** (when to look again), **`isOngoingFirstInstance`**, `orderJobCase` + `caseSignature` |
| Server | `src/lib/public-orders/source.ts` | upstream calls (`searchCase`, `fetchOrderFile`); direct by default, `PUBLIC_ORDERS_VIA_WORKERS=1` → workers |
| | `engine.ts` | `lookupCase(deps, job)` — I/O injected; 3 instances in parallel; keeps only rows whose case number equals the job's |
| | `company-job.ts` | the queue: `planCases` (DETECT, free), `enqueueCases` (SCRAPE), pause/resume/cancel/`retryFailed`; `globalThis.__publicOrdersJob`; `MAX_QUEUE` |
| | `store.ts`, `data-dir.ts` | shard files + `checked.jsonl` in `~/.sud-tizimi/public-orders` (`PUBLIC_ORDERS_DIR`); `cacheStats` |
| API | `app/api/public-orders/{fetch,status,orders,file,cache}` | `fetch`: `{action: start|plan|pause|resume|cancel|retry}` |
| Client | `lib/orders-watchlist.ts` | Kuzatuv run (`checkWatchlistOrders`), `planWatchlistOrders`, pause/resume, opt-in switch (`sud-orders-auto`, default OFF) |
| | `lib/use-orders-job.ts` | ONE shared status poll for every consumer |
| | `lib/registry.ts` | `meta.orderCases` (compact case list) written whenever stats are read → Kuzatuv can DETECT without scraping |
| UI | `shell/orders-loader.tsx` | the pill: only while scraping; announces the end with a toast |
| | `shell/orders-auto-check.tsx` | opt-in idle watcher (3 min without input, ≤ once / 6 h) |
| | `views/orders-control.tsx` | Kuzatuv button + status line + switch |
| | `views/orders-settings.tsx` | Settings › Qarorlar control panel (queue, cache numbers) |
| | `proto/case-orders.tsx` | drawer cards «Eʼlon qilingan / qilinmagan» |
| | `sections/cases.tsx` | «Qarorlar · N» button, drawer wiring, `orderJobCase` |

## Rules (each one was a bug or an owner decision)

1. **Only cases the owner cares about** (Kuzatuv companies, a Sud ishlari list, one drawer). No full-library crawl (laptop/disk).
2. **A published order is permanent.** An instance with a stored order is never asked again; all three stored = done for good.
3. **Re-check only when it can matter:** the case signature changed (status/result — e.g. appealed), or a publication-lag back-off elapsed (3 d, 14 d, 45 d, then wait). A failed search is retried after 10 min and is **never** recorded as «none».
4. **Still heard in the first instance (no result, «ish yurituvda» / «koʻrib chiqilmoqda») ⇒ no decision ⇒ not queued.** Appeal / cassation / supervision ⇒ checked (its first-instance order exists). Unrecognised wording ⇒ checked. A hand «Tekshirish» overrides.
5. **Nothing starts by itself and nothing nags.** Opening/refreshing/switching pages or tabs never queues or scrapes. DETECT (`plan`) is free and only shows a count («Qarorlar · N», «N ta ish tekshirilishi kerak»). SCRAPE runs from a click or the opt-in idle check.
6. **The pill exists only while scraping**; ✕ hides it for that run (sessionStorage); paused/failed/finished leave no pill — one toast at the end (with «Qayta urinish»); a paused queue is continued from Kuzatuv or Settings.
7. **Pause really pauses:** state flips at once, the case in flight finishes, the queue keeps its order, resume continues with the same counters. Automatic feeders send `keepPaused` so they cannot undo a pause.
8. **The cache is never deleted by the app** (no clear button, no DELETE route). It lives outside the project; writes only append (newer line wins on read); files are `0600`, dir `0700`.
9. **One shape, one signature:** every caller builds jobs with `orderJobCase` (status + result). Two shapes ⇒ screens keep «changing» each other's cases.
10. **One status poll** (`use-orders-job.ts`); local reads (`status`, `cache`, `orders`) are exempt from the scrape rate limit, `plan/start/...` are not.
11. **Searches are slow** (≈10 s per `case_number`+`instance`, a minute+ without instance) ⇒ background only, one case at a time, 3 instance searches in parallel. Never hedge/duplicate them.
12. PDFs are anonymised, rows carry no parties/STIR; only look up cases the owner opened/watches.

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
`core/__tests__/public-orders.test.ts` (policy) · `lib/public-orders/__tests__/{engine,company-job,store,data-dir}.test.ts`.
Live scraping does not work in the sandbox: e2e uses a mock upstream (`PUBLIC_ORDERS_API=http://localhost:PORT`) and
mocked `/api/stats` (see AGENTS §1).
