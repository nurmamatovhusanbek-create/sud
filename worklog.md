# Worklog — Sud Billing Lookup System Rebuild

Project: rebuild of https://github.com/nurmamatovhusanbek-create/sud-billing-lookup
Kit: /home/z/my-project/upload/sud-rebuild-kit/ (master plan, blueprint, arch guide, redesign guide, tokens, prototype, P0 patch)
Live project: /home/z/my-project (Next.js 16, dev server on :3000)
Reference clone: /home/z/my-project/sud-billing-lookup (.z-ai-config untracked there per P0 A2)

---
Task ID: 0
Agent: main (Super Z)
Task: Read rebuild kit + repo, plan the phased rebuild

Work Log:
- Cloned repo; extracted sud-rebuild-kit.zip; read all 7 kit docs
- Mapped all lib export signatures; confirmed .z-ai-config WAS tracked in git
- Confirmed scaffold env: bun 1.3.14, dev server auto-runs on :3000, preview exposes `/` only

Stage Summary:
- Executed P0→P7 in dependency order; see task records below

---
Task ID: 1 (P0 — Safety & honesty)
Agent: main (Super Z)

Work Log:
- Ported scraper libs VERBATIM (billing, court-case, court-case-types, court-map, orginfo, mib, chamber, jadval2, stats, cf-worker-pool, workers-config, health-registry, tor, cache, local-lists, version*) via scripts/p0-port.sh
- Ported API routes, settings/ui-custom components, cloudflare-worker, mini-services (ihamkor test-* deleted)
- EXCLUDED: .z-ai-config (secret), prisma/ (unused), src/lib/db.ts, fix-v*.mjs, api/route.ts hello-world, giant docs
- untracked .z-ai-config in the clone (git rm --cached); rotation itself requires the owner (documented in P0-RUNBOOK)
- ignoreBuildErrors: true → false; added typecheck/test scripts
- Removed Prisma deps + db:* scripts; added jszip/socks-proxy-agent/https-proxy-agent
- Added src/server/config.ts (typed env surface from the P0 patch) + full .env.example
- Emptied FALLBACK_WORKERS (no stranger workers — blueprint §3.2)

Stage Summary: no secret in tree; types enforced; Prisma gone; every knob via config.ts; typecheck backlog paid down to ZERO this session

---
Task ID: 2 (P1 — Pure core + types + tests)
Agent: main (Super Z)

Work Log:
- src/core/envelope.ts — Envelope/SourceError/ErrorCode contract
- src/core/classify.ts — normalizeName/nameMatches/classifyOutcome/remapCourtTypeByCaseNumber/dedupCases/summarize ported verbatim from stats.ts
- src/core/status.ts — status→family maps (bills, cases, hearings, company, rating bands, health) per redesign §4.3
- src/core/search-mode.ts — detectSearchMode (STIR/PINFL/invoice/caseNumber/name)
- src/core/billing-format.ts — pure billing helpers extracted OUT of billing.ts (client-safe); billing.ts re-exports them (single source of truth, zero behavior change)
- src/core/schemas — zod schemas for company-info, court cases, stats, bills, hearings, MIB
- 30 bun tests (src/core/__tests__) — all pass; 2 tests assert lib-true quirks documented inline

Stage Summary: core has NO I/O; scrapers import core; contract locked

---
Task ID: 3 (P2 — Infra toolkit)
Agent: main (Super Z)

Work Log:
- src/infra/resilience.ts — withTimeout, retryTiers (jittered backoff), CircuitBreaker (open/half-open), bestOf racing
- src/infra/cache.ts — CacheStore + MemoryCacheStore (TTL + size cap) + cached() helper; backend from config
- src/infra/logger.ts — levelled structured JSON (prod) / readable (dev); scoped child loggers
- src/infra/metrics.ts — per-source request/success/failure/latency + timed() wrapper + snapshot

Stage Summary: one resilience/cache/logger/metrics implementation; adapters are GIVEN tools, not copies

---
Task ID: 4 (P3 — Sources)
Agent: main (Super Z)

Work Log:
- src/sources/types.ts — SourceAdapter + defineSource (metrics timing + optional zod output validation = upstream shape drift fails loudly)
- src/sources/index.ts — stats, company-info (with per-source partial[] errors), court-cases, case-detail, upcoming-hearings (v121 criminal-skip preserved), mib-parse adapters
- Scraper libs untouched except type-only fixes sanctioned by the P0 runbook (billing.ts createVision cast, court-case InstanceData import, mib submitBtn cast, orginfo pickBestMatch Promise annotation — latent bug surfaced by the un-hidden typecheck, behavior unchanged, tor agent null→undefined, court-hearings company.name removal)

Stage Summary: every source re-homed behind an adapter; scraping know-how byte-identical

---
Task ID: 5 (P4 — Server layer)
Agent: main (Super Z)

Work Log:
- src/server/middleware.ts — guard() = auth (bearer when APP_API_TOKEN set; open in dev) → per-IP rate limit → coalesce (in-flight dedup by key) → handler
- src/server/envelope.ts — jsonOk/jsonFail (Envelope everywhere; partial errors carried)
- Rebuilt routes on the stack: stats (+partial), company-info (+errors[] additive), court-cases, upcoming-hearings, bills (NDJSON stream preserved + typed union)
- Wrapped 12 remaining routes (exports, mib, tor, settings/*) with guard via impl-function pattern
- Buffer→Uint8Array for xlsx BodyInit; verified: endpoints coalesce duplicates, partials surface

Stage Summary: envelope frozen before client build; reactStrictMode can be re-enabled later safely (coalescing exists)

---
Task ID: 6 (P5 — Client data layer)
Agent: main (Super Z)

Work Log:
- src/lib/domain/company.ts — Company model + normalizeStir
- src/lib/api-types.ts + src/lib/api-client.ts — the ONLY fetch module: typed fns, legacy/new envelope mapping, streamBills (typed NDJSON reader), xlsx download helper, auth header support
- src/hooks/use-resource.ts — ResourceState machine (idle/loading/success/empty/partial/error) + cache + AbortController; src/hooks/use-stream.ts — bills phase ladder
- src/lib/store/app-store.ts — zustand: activeCompany + launcher↔workspace + sections (single `/` route per sandbox; guides' sanctioned interim) + command/settings state
- src/lib/registry.ts — ONE STIR-keyed registry (recents/watched/savedForHearings) with legacy 3-key migration; src/lib/identity.ts — §5.4 cheap-identity prefetch

Stage Summary: no fetch() outside api-client; no pending* hack; no hardcoded STIRs; one company context

---
Task ID: 7 (P6 — UI: Monochrome Signal)
Agent: main (Super Z)

Work Log:
- globals.css: full token system (neutral ramp, signal hues, semantic roles, dark theme, @theme inline shadcn repoint) + thin utilities (517 lines total vs 4,923 before)
- layout.tsx: Inter (Cyrillic) + JetBrains Mono via next/font, ThemeProvider data-theme, Sonner
- Shell: app-shell (rail + glass header + Tor chip + theme CSS-swap), command-palette (⌘K//, mode chip, recents/watchlist/actions groups)
- Views: Launcher (hero search + samples + recents + watchlist preview), Watchlist (alerts strip + staggered cards)
- Company workspace: ContextBar (monogram, grouped STIR copy, status/rating, refresh/export/watch) + underline section tabs (1–5 keys)
- Sections: Overview (KPIs + win-rate ring + 12-mo trend + status donut + win-rate bars + compare dialog), Bills (phase-ladder stream loader + summary + table + receipt drawer), Cases (court ToggleGroup + table + in-results filter + detail drawer: Umumiy/Tomonlar links/Majlislar timeline/Instansiyalar — no documents §13.1), Hearings (docket tickets with tear-off date block), Profile (orginfo + rating ring + founders; MIB parked §13.1)
- Settings: ported dialog restyled by tokens; Health route now returns sourceMetrics + redacted config (P7)
- v168 → v200

Stage Summary: every view has all five states; color = signal only; no hardcoded hex in components; dark+light pass visual check

---
Task ID: 8 (P7 + Verify)
Agent: main (Super Z)

Work Log:
- Fixed runtime issues found by browser E2E (agent-browser): useSyncExternalStore server-snapshot caching, hydration-safe theme toggle (CSS swap), sticky top offsets relative to scroll port (main), duplicate stream keys, drawer party-name truncation
- Final: tsc --noEmit CLEAN · eslint 0 problems · 30/30 core tests · 0 browser page errors
- Browser-verified flows: launcher→sample→workspace; keyboard 1–5 sections; overview renders LIVE scraped stats (58 cases, 47% win-rate, partial banner for administrative court); bills stream loader; cases table + detail drawer with live data; profile orginfo + AA rating ring; watchlist add + cards; dark/light both correct
- Dev log shows structured logging + real partial failures (chamber timeouts surfaced, stats 10s)

Stage Summary: rebuild complete and verified in-browser; remaining owner actions: rotate the leaked z.ai token (P0-RUNBOOK A1), configure own CF workers, deploy target decision

---
Task ID: 9 (Modal-parity recheck & redo + release)
Agent: main (Super Z)
Task: "the app does not match the whole html modal i gave you, recheck and redo" — then pack + version

Work Log:
- Re-read sud-prototype.html (rebuild kit) end-to-end; walked every view in the browser and diffed against the live app
- FIXED hydration error (app-shell RailNav badge): watchCount now via useSyncExternalStore (server snapshot 0), no localStorage during hydration render
- Launcher/home: KPI 4 "Kuzatuvda" → prototype's "Umumiy qarzdorlik" (wallet, mln so'm, "N kompaniyada"); KPI 3 foot → "Eng yaqini — DD Mon"; recent chips show grouped STIR; hero placeholder "STIR raqamini kiriting…"; Ochish icon → bar-chart; risk filter includes overdue>0
- Overview: KPI 3/4 → prototype's "To'langan boj" (paid total + N kvitansiya) and "Muddati o'tgan" (red when >0, "BPI orqali undiruv"/"Qarzdorlik yo'q"); recent activity → prototype's "So'nggi to'lovlar" (3 newest receipts → receipt drawer) + "So'nggi qarorlar" (decided cases, CASE_META icons/badges); section sub "— to'lovlar va qarorlar"
- NEW src/lib/bills-cache.ts: session bills cache + version store; Bills stream mirrors into it and persists aggregates (billCount/paidCount/paidTotal/overdueTotal) into registry meta (feeds home debt KPI)
- Status semantics: "ҳозирда мавжуд/mavjud" → active (green, "Faoliyatda") across core/status.ts + launcher/watchlist/context-bar/palette labels
- Monograms: quote-safe initials() (strips «"» wrappers) used in launcher, watchlist, compare, palette, context-bar
- Watchlist: datecard .now only inside the 7-day alert window; status labels mapped
- Verified in browser: home, workspace overview (47%, 58 ish, 173 690 013 paid KPI), bills stream (66 bills, 52 paid), case detail drawer, hearings datecard, profile arc gauge 93% AA; hydration clean; tsc clean; eslint 0; 30/30 core tests
- Release: APP_VERSION v200→v201, package.json 0.2.1→0.3.0; git commit + tag sud-signal-v201; packed sud-billing-lookup-v201.zip into download/

Stage Summary: app now mirrors the HTML modal view-for-view with live data; release zipped and versioned

---
Task ID: 10 (Uzbek Text & Typography pass)
Agent: main (Super Z)
Task: Make every Uzbek string native and typographically correct (guide: two apostrophes, «» quotes, no em dash, natural phrasing) — letters and words only, never the code

Work Log:
- Scanned src (scripts/uz-scan.py): 279 in-word straight apostrophes, 505 em dashes, classified per file; built a protection inventory of DATA-MATCHING needles that must stay byte-identical (includes("to'xtatilgan") variants in launcher/watchlist/context-bar/command-palette, bo'lib outcome regex in cases, court-map keywords, orginfo page-label regexes, classify/stats outcome needles, court-case-types Latin map KEYS, test fixtures)
- PART A (scripts/uz-fix.py): letter-bound regexes on 29 audited files — [oOgG]' + letter -> U+02BB, letter'letter -> U+02BC; needles masked during pass. typecheck clean
- PART B: explicit pair replacements (uz-fix.py + uz-fix2.py + uz-fix3.py), each asserted by count: em dash -> by meaning (sentences -> period, compact separators/definitions -> middle dot, no-value placeholders -> hyphen), U+2018 -> U+02BB/02BC, &apos; entities -> real marks
- §5 swaps: Yutuq darajasi -> Gʻalaba darajasi; Foyda tomonida -> Foydasiga; import qilinmoqda -> yuklab olinmoqda; boyitilmoqda -> tafsiloti olinmoqda; yigʻiladi -> jamlanadi; 9 raqam -> 9 xonali; sichqonchani olib boring -> ustun ustiga bosing
- Data-layer sentinel: court-case.ts 43× || '—' + 15× ': ʼ—',' -> '-'; comparisons widened to accept both dashes (stats.ts raw.caseNumber, sources/index.ts hearingDate, cases.tsx name/hearingDate guards); reviewDecision guard kept upstream-tolerant; classify.ts/stats.ts already dual
- Label maps: billing-format COURT_TYPES/INVOICE_STATUSES (uz display), court-case-types .en values + Maʼmuriy ishlar, chamber Oʻrta, zod schema errors, middleware unauthorized/rate-limit texts, billing.ts onPhase strings, search-mode hints (STIR · …)
- Verified in browser (agent-browser): home hero (Oʻzbekiston · Sud razvedka tizimi, 9 xonali, jamlanadi.), overview (GʻALABA DARAJASI, live partial banner "Baʼzi manbalarga ulanib boʻlmadi. Natija toʻliq boʻlmasligi mumkin…"), bills (STIR · barcha toʻlovlar, Eʼtibor talab, Toʻlovlar yuklab olinmoqda…), cases + detail drawer (UMUMIY MAʼLUMOT, DAʼVOGAR, Maʼlumot yoʻq, hyphen placeholders), settings (Sozlamalar · Sud Signal title); Cyrillic sud.uz data passthrough unchanged
- Gates: tsc --noEmit CLEAN · eslint 0 problems · 30/30 core tests · residual grep hits audited: only data needles + English comments + English console logs
- Release: APP_VERSION v201->v202, package.json 0.3.0->0.3.1; git commit + tag sud-signal-v202; packed sud-billing-lookup-v202.zip into download/

Stage Summary: all UI copy reads native Uzbek with correct ʻ/ʼ/«»/· typography; matching needles and upstream data untouched; release v202 zipped and versioned

---
Task ID: 11 (Hero eyebrow rename + v203 release)
Agent: main (Super Z)
Task: Change home hero eyebrow "Oʻzbekiston · Sud razvedka tizimi" -> "Kompaniyalarni kuzatish tizimi"; explain 225-file zip breakdown (no node_modules)

Work Log:
- Edited src/components/views/launcher.tsx:189 eyebrow; grep src/ = 0 remaining "razvedka"
- APP_VERSION v202->v203 (src/lib/version.ts), package.json 0.3.1->0.3.2
- tsc --noEmit clean
- git commit + tag sud-signal-v203; packed download/sud-billing-lookup-v203.zip (225 files, same tree), verified new string inside zip

Stage Summary: hero eyebrow renamed per user; v203 zipped and versioned; zip confirmed free of node_modules (source-only)

---
Task ID: 12 (Implementation brief: P-A..P-E repo fixes + v204 release)
Agent: main (Super Z)
Task: Five-part fix brief — unify worker resolution, worker-test route, real exports, pagination, watchlist card properties

Work Log:
- P-A: new src/lib/worker-defaults.ts (4 DEFAULT_WORKERS, single home); cf-worker-pool FALLBACK_WORKERS = DEFAULT_WORKERS; workers-config seeding imports it; billing.ts local FALLBACK_WORKERS + getCfWorkerUrls + empty-branch in nextProxyUrl DELETED, now imports shared getCfWorkerUrls; GET /api/settings/workers dedupes via normalizeWorkerUrl both sides. Verified: fresh install (no workers.json/env) -> Settings shows "Manba: Birlamchi · 4 worker"
- P-B: new POST /api/settings/workers/test — probes worker+admin.chamber.uz GetCompanyCriteries/302678824, classifies into UI REASON_LABELS (timeout/network_error/http_502/5xx/4xx/html_response/non_json/wrong_shape/not_https), persists via updateWorkerTestResult. Verified live: not_https guard + real probe OK 2338ms caseCount 1 + UI OK toast (no more blanket "Testni oʻtkazib boʻlmadi")
- P-D: cases.tsx restructured — 3 useResource fetches lifted to parent (enabled per selected court), ONE merged+filtered list; rows carry own courtType (fixes all->economic open bug); ListPagination (new ui-custom/list-pagination.tsx over shadcn pagination, Uzbek labels, page window + ellipsis) + per-page select (10/25/50/100) on bills/cases/hearings; page resets on filter/seg/company change; hearings .now marks overall nearest across pages
- P-C: new src/lib/print.ts printHtml() (self-contained print sheet, popup-blocked -> toast); bills receipt PDF + case detail PDF + cases list PDF now real print dialogs (fake toasts deleted); new src/lib/xlsx.ts buildXlsx() — bills/export + stats/export refactored onto it (no behavior change); NEW GET /api/court-cases/export (Sud|Ish raqami|Daʼvogar|Javobgar|Sana|Holat|Sud turi) + GET /api/upcoming-hearings/export (Sana|Vaqt|Sud|Ish raqami|Sudya|Sud turi); api-client downloadGet + exportCasesXlsx/exportHearingsXlsx; Excel buttons on cases + hearings. Verified: both downloads are valid Excel 2007+ with live data
- P-E: stats.ts threads chamber rating (score 0-100 + category) into CompanyStats.rating; schemas CompanyStatsSchema + StatsResponseSchema extended (zod was stripping it — root cause of missing rating); watchlist enrichment stores rating/score via patchMeta; RemovableCard shows 4 metrics (Gʻalaba % ring+numeric, Ishlar, numeric Reyting·category, Keyingi majlis pill) + per-card Yangilash button (stopPropagation, enrichedRef.delete + re-enrich); enrichCompany extracted with one-shot guard
- BONUS FIX: registry writeStore now dispatches sud:registry-changed on every write — setWatched/unwatch previously mutated silently (watchlist grid/home KPIs didn't react until remount); removal now reactive (browser-verified)
- Gates: tsc --noEmit CLEAN · eslint 0 · 30/30 core tests · browser E2E: STIR 302678824 -> bills 66 (pager 1–25/66, per-page 10 works), cases 60 merged (pager + PDF popup + Excel), hearings (Excel, .now preserved), workers tab 4 defaults + live Sinash OK, watchlist card 31% Gʻalaba / 58 Ishlar / 93 Reyting·AA / 25 Sen pill + working refresh + reactive removal; no page errors
- Release: APP_VERSION v203->v204, package.json 0.3.2->0.3.3; git commit + tag sud-signal-v204; packed sud-billing-lookup-v204.zip (237 files) into download/

Stage Summary: all five brief items implemented and browser-verified; invariants held (scraper internals untouched, reactStrictMode:false kept, no secrets in source); v204 zipped and versioned

---
Task ID: 12-bis (v204 verification + delivery of push commands)
Agent: main (Super Z)
Task: User asked to implement the brief and send commit/push commands

Work Log:
- Verified all 7 brief artifacts exist (worker-defaults, print, xlsx, workers/test route, court-cases/export, upcoming-hearings/export, list-pagination)
- Gates re-run: tsc --noEmit CLEAN (exit 0) · 30/30 core tests pass
- Zip diff v203->v204: 0 deleted, 9 added (overlay-safe), 237 files total, top folder sud-billing-lookup-v204/
- Delivered Git Bash sync + commit + push commands for the user's local repo (nurmamatovhusanbek-create/sud)

Stage Summary: v204 confirmed complete and healthy; user pushes via zip-overlay workflow as before

---
Task ID: 13-RECOVERY-NOTE
Agent: main (Super Z)
Task: record that the v205 release (Task 13 below) was wiped AGAIN by a second sandbox reset before the user could download it

Work Log:
- Second reset restored the tree to the v204 commit + scaffold noise; download/ reverted to Sep-17 state (no zips), worklog reverted to Task 12
- The v205 zip (255 files) and the §5 crawler / §6 name-discovery sources (src/lib/crawler, src/lib/db, migrations/, instrumentation.ts, src/lib/name-match.ts, court-aggregate) are gone again; user's GitHub never received v205 (no remote reachable from sandbox — user pushes from local machine)
- Decision: v206 is built on v204 (what the user actually has); §4.4's crawler vka.ts item is N/A in this tree; the §5/§6 engine can be rebuilt as a later release from the context notes if requested

Stage Summary: v205 exists only in conversation history; v206 baseline = v204 + rate-limit scheduler + 4 UI fixes

---
Task ID: 15 (v206 — worker firing scheduler + 4 UI fixes)
Agent: main (Super Z)
Task: guide "Worker Firing Sequence (rate-limit fix)" §3-§6 + fix (1) watchlist card buttons placement, (2) per-card refresh dead, (3) hydration error, (4) duplicate Tor button

Work Log:
- §3 NEW src/lib/net/worker-fetch.ts: health-ordered hedged scheduler (Sem global/background/per-worker/per-origin + per-origin spacing + hedge racing, maxAttempts cap). Two necessary deviations: method+body options (billing PoW/analyze/solve are POSTs through the same workers) and outcome feed into shared OriginHealthPool('worker-fetch') so Settings›Holat keeps per-worker health. NET_DEBUG=1 traces attempts.
- CRITICAL FIX found while verifying: the guide's `AbortSignal.any([outer, timeout])` + success-path `abort.abort()` kills the WINNER's in-flight response BODY (fetch resolves at headers; body still attached to the composite signal) → caller's res.text() threw AbortError. Reproduced minimal on Node 24 AND Bun 1.3. Fix: per-attempt own controller chained to outer via addEventListener, listener removed in finally — aborting losers can never touch the winner's body. (scripts/test-scheduler.ts smoke: OK status=200 27KB in 1.5s)
- §4.1 court-case.ts: 3-tier 10/15/20s fire-all ladder deleted; per-endpoint single hedged call (12s/800ms/×3); curl stays as the one extra jadval.sud.uz fallback; definitive-404-non-CONFLICT + incomplete honesty semantics preserved; detail fetches routed through scheduler; dead pool/health code removed
- §4.2 chamber.ts: one hedged call (10s/700ms/×3), same mapping, null on no-data
- §4.3 billing.ts: ProxyPool/circuit-breaker/round-robin machinery deleted; fetchJsonWithRetry hops via scheduler (method/body passthrough, backoff kept); getBillStatus = 2 scheduler hops (maxAttempts 3, hedge 900ms) with permanent-4xx bail; 60-receipt enrichment now queues under per-origin cap + spacing
- §4.4 jadval2.ts: scanDateRange fetches via scheduler priority:'background' (lane 3) + jadval2 Origin/Referer headers. Crawler vka.ts: N/A (v205-only file, lost — see recovery note)
- §5: verified the existing design already lazy-mounts sections on first visit (CompanyWorkspace `visited` set, keep-alive after) — no enabled-gating churn needed; open burst = identity warm + overview stats/hearings only, now scheduler-paced
- §6: .env.example recreated (was lost with the reset) from src/server/config.ts surface + NET_* block (GLOBAL 8 / BACKGROUND 3 / PER_WORKER 2 / PER_ORIGIN 4 / SPACING 120ms / DEAD 3×30s)
- Fix 1: RemovableCard actions moved INTO ccard-top as .ccard-tools (Yangilash + Kuzatuvdan olib tashlash inline, hover-reveal, touch-visible @media hover:none) — no more absolute overlays covering the rating badge; prototype.css additions
- Fix 2: enrichCompany(stir, force) — refresh passes force=true: getStats(stir,{force:true}) server-side now skips+deletes statsCache (before: force only cleared courtCaseCache, statsCache still served stale 60s) then hearings sequential; BOTH sources failing now throws → card toasts 'Yangilashda xatolik — manbalar javob bermadi' (failures were silently swallowed before — the button "did nothing")
- Fix 3: BellPopover hydration mismatch — computeAlerts() read localStorage during the hydration render (badge present client-side, absent server-side). Gated with useSyncExternalStore(useHydrated) server-snapshot-false pattern; verified: seeded watchlist + 3-day-out hearing → reload → zero page errors
- Fix 4: rail Tor mini-button removed (duplicate of topbar tor-badge); rail keeps theme toggle; verified 1 rail-mini + 1 tor-badge
- Gates: tsc CLEAN; eslint 0; 30/30 tests; endpoint smokes: stats 35 cases + rating AA/93 (first call), forced re-scrape 58 cases 4.5s + cache-then-fresh hearings 1, workers list 4 defaults; scheduler request count per court endpoint = 1-2 (was 6); browser E2E: watchlist card buttons + refresh live-updates card (58 Ishlar/38%/93 AA/25 Sen), hydration clean, Tor single
- Release: APP_VERSION v204→v206 (v205 never shipped — skipped), package.json 0.3.3→0.3.5; pack-release.sh VER=v206 → download/zip files/sud-billing-lookup-v206.zip; git commit + tag sud-signal-v206

Stage Summary: one choke point for ALL worker traffic (hedged, capped, spaced); winner-body abort bug fixed upstream of the guide; watchlist refresh genuinely refreshes; hydration clean; v206 zipped

---
Task ID: 16 (v207 — TIN 200248856 case-count investigation + per-TIN token-bucket fix)
Agent: main (Super Z)
Task: "see how many cases you will get on tin 200248856 — it has to get at least 100+ cases overall; I think we are using the wrong service or doing it wrongfully"

Work Log:
- Upstream census for TIN 200248856: jadval.sud.uz/case/findByTin = 94 eco cases (full archive incl. archived); jadvalapi = 7 eco (6 new) + 4 civ + 3 conflict. Union = ~107. Service choice is CORRECT — no better public source (apimy.sud.uz needs e-ID SSO per earlier investigation)
- Measured the flakiness: fake-empty "Ишлар топилмади" (HTTP 200, 15 chars, plain text) in ~1s or 25s+ hangs vs real JSON in 1.8-21s; header sets irrelevant (A/B'd browser-spoof vs simple); DNS single A record 45.150.25.203 but sibling 94.158.54.73 serves same app
- KEY DISCOVERY — per-TIN token bucket, NOT per-IP: a never-queried TIN succeeded instantly from the burnt sandbox IP while the hammered TINs failed from 4 different CF-worker egress IPs; recovery ~10-30 min. Immediate retries are useless; fewer queries + longer cache is the fix
- court-case.ts v207: jadval timeoutMs 12s->20s (12s killed real winners); scheduler maxAttempts 3->2 for jadval; direct-curl ladder (2 samples, 6s apart, first pinned to sibling machine via curl --resolve, env JADVAL_RESOLVE_IP); isFakeEmptyText module helper — fake-empty is retryable, never definitive; court-case cache 60s->10min; details path same retry+pin; curl --max-time 15->25
- stats.ts: force refresh now also clearCourtCaseCache(tin) (Yangilash stays real at 10-min TTL)
- Verification after bucket refill: /api/court-cases economic = 100 cases (log: sample1 throttled, sample2 landed 94 via curl, union 100); /api/stats = 106 total (100 eco + 3 civ + 3 conflict), win 63 / lose 35 / neutral 3 / pending 5, plaintiff 101 / defendant 5, errors []; company "ANDIJONKABEL" AJ
- Gates: tsc CLEAN; 30/30 tests; packed "download/zip files/sud-billing-lookup-v207.zip" (243 files, unzip -t clean); git commit + tag sud-signal-v207; APP_VERSION v206->v207, package.json 0.3.5->0.3.6

Stage Summary: case counts restored to full archive (7 -> 106 for the test TIN); root cause documented as per-TIN upstream token bucket; defense = quota-frugal sampling (2 worker + 2 curl across 2 machines) + 10-min memoization + honest incomplete flag; v207 zipped and tagged
