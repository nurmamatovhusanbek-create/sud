# Sud Billing Lookup — Sud Signal rebuild (v202)

Full-system rebuild of `nurmamatovhusanbek-create/sud-billing-lookup` on Next.js 16,
restored view-for-view from the `sud-prototype.html` modal ("Monochrome Signal") with
live scrapers behind it.

## Run

```bash
bun install
cp .env.example .env   # optional knobs (APP_API_TOKEN, workers, cache)
bun run dev            # http://localhost:3000
bun run typecheck && bun run lint && bun test src/core
```

## Layout

| Path | Role |
|------|------|
| `src/core/` | Pure domain: envelope contract, classification, status maps, billing-format, zod schemas, 30 tests |
| `src/infra/` | Resilience (timeout/retry/breaker), cache, logger, metrics |
| `src/sources/` | Source adapters (stats, company-info, court cases, hearings, mib) |
| `src/server/` | guard middleware (auth→rate-limit→coalesce), envelope helpers, config |
| `src/app/api/` | Routes: stats, bills (NDJSON stream), court-cases, company-info, hearings, settings/*, tor |
| `src/lib/` | api-client (only fetch module), registry (one STIR-keyed store), bills-cache, scrapers (verbatim port) |
| `src/components/` | Shell, launcher, workspace sections (Umumiy/To'lovlar/Sud ishlari/Majlislar/Profil), settings, proto primitives |
| `cloudflare-worker/` | proxy.js worker template |
| `mini-services/` | tor-manager, ihamkor-scraper sidecars |
| `P0-RUNBOOK.md` | Secret-rotation + hardening runbook (owner actions) |

## Parity notes (v202)

- Overview KPIs: Yutuq darajasi · Jami ishlar · To'langan boj · Muddati o'tgan (fed by the bills stream cache)
- "So'nggi faoliyat — to'lovlar va qarorlar": So'nggi to'lovlar → receipt drawer; So'nggi qarorlar → case drawer
- Home KPI 4: Umumiy qarzdorlik (mln so'm) from persisted billing aggregates
- Keyboard: ⌘K / ⌘F / / palette · 1–5 sections · R refresh · E export · Esc close
- "ҳозирда мавжуд" status maps to Faoliyatda (active); quote-safe monogram initials
- Honest states everywhere: partial banners, skeletons, empty/error blocks — no fake data
