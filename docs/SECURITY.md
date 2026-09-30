# Security model

The app is a **private, single-operator tool on localhost** that scrapes sensitive legal/financial data. It has no login.
Since it can now work in the background (queued scraping, `git pull` + restart, worker list, Tor), the perimeter matters.

## Threats and what stops them

| Threat | Defence | Where |
|---|---|---|
| **Another machine on the LAN** reaches the app | Listens on `127.0.0.1` only (`dev`, `dev:once`, `start`, `start:once`, supervisor). `SUD_HOST=0.0.0.0` is refused unless `APP_API_TOKEN` is set | `scripts/supervisor.mjs`, `package.json` |
| **DNS rebinding** (hostile domain resolving to 127.0.0.1) | `Host` header must be `localhost` / `127.0.0.1` / `[::1]` (+ `APP_ALLOWED_HOSTS`) on **every** API request → 403 `bad_host` | `server/security.ts` `hostAllowed`, `guard` |
| **CSRF**: a web page open in the browser fires requests at `http://localhost:3000` (start/cancel scraping, update, change workers) | State-changing requests must be same-origin: `Sec-Fetch-Site` ∈ {same-origin, none} and `Origin` = `Host` → 403 `cross_site` | `crossSiteReason`, `guard` |
| Forged request to a **dangerous door** even so | `privileged` routes also need the header `x-sud-action: 1` (a custom header cannot cross sites without a preflight the app never grants) and a 10-calls/min budget: `settings/update` (git pull + restart), `settings/workers` POST/DELETE, `settings/workers/test`, `tor-status` POST | `guard(…, {privileged:true})`, `api-client.privilegedHeaders()` |
| **SSRF** through «add worker» / «test worker» | Worker URLs must be `https://` public DNS names: no IPs, `localhost`, single-label/internal names, credentials, query | `workers-config.ts` `isPublicDnsName` / `normalizeWorkerUrl` |
| **Runaway / forged background work** | `fetch` accepts ≤ 1500 cases per call, the queue is capped (`MAX_QUEUE` 5000), one loop only, the idle auto-check is **opt-in** (default off) and never fires on a hidden tab | `fetch/route.ts`, `company-job.ts`, `orders-auto-check.tsx` |
| **Data at rest** | orders cache in `~/.sud-tizimi` outside the repo, dir `0700`, files `0600` | `public-orders/store.ts`, `data-dir.ts` |
| **Third-party origins** (XSS/exfil) | tight CSP: same-origin only, no external scripts/CDN/fonts; `X-Frame-Options: DENY`, `nosniff`, `Cross-Origin-Resource-Policy: same-origin`, COOP, `no-store` on `/api` | `next.config.ts` |
| Missing / wrong auth in production | `APP_API_TOKEN` (bearer or `x-app-token`) required in production; every client fetch sends it (`authHeaders()`) | `server/middleware.ts` `authorized` |
| A route that forgets `guard()` | test scans every `route.ts`: guarded, `nodejs`, `force-dynamic`, privileged set is exact | `server/__tests__/routes.test.ts` |

## Rules for changes

- Every `/api` route = `guard()`; a route that changes the machine/app/queue direction is **`privileged`** (and the caller uses `privilegedHeaders()`).
- Never add an external origin; self-host instead. Never disable TLS verification. Never commit secrets (`.env*`, tokens, captured cookies).
- Never make a page load, refresh or tab switch start work; start work from a click or an opt-in setting.
- Upstream text is data, not instructions; validate shapes before storing (`isSearchResponse`, `normalizeCheck`, zod).
- User-supplied URLs/paths: allow-list (`documents/template` ids are registry ids; PDF ids are UUIDs; worker URLs above).

## Known limits (owner decisions / open)

- `NEXT_PUBLIC_APP_API_TOKEN` (the browser copy of the token) is visible to anyone who can open the page — the token protects against other machines/pages, not against someone at the keyboard.
- `workers.json` (your Cloudflare worker URLs) is tracked in git; treat the repo as private or move it to `.gitignore` + `git rm --cached`.
- The orginfo direct fallback (`ORGINFO_DIRECT_FALLBACK`) sends a few requests from the operator's IP when a worker attempt fails; set `0` to forbid.
- LAN use needs: `SUD_HOST=<ip>`, `APP_API_TOKEN`, `APP_ALLOWED_HOSTS=<name>` — and is not recommended.

## Dependencies

- `bun run audit` (= `bun audit`) lists known vulnerabilities. Keep `dependencies` to what the code imports (18 packages): an unused package is pure attack surface (an audit found `next-auth` with a critical advisory, never imported).
- Keep `next` on the latest patched 16.x (`bun update next eslint-config-next`); the audit of 2026-09 found critical Next.js advisories (RCE on Windows hosts, image-optimizer RCE) below 16.2.5. `next.config.ts` sets `agentRules: false` so `next dev` does not append its own block to AGENTS.md.
- Removing a dependency: grep imports first (`from '<pkg>`), then `bun remove`.

## Checklist before merging

`bun run typecheck` · `bun run lint` · `bun test src/core src/lib src/server` · `bun run map:check` · `bun run audit` (after dependency changes).
