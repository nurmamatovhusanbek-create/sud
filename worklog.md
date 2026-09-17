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
