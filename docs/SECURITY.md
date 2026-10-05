# Security model

The app is a **private, single-operator tool on localhost** that scrapes sensitive legal/financial data. It has no login.
Since it can now work in the background (queued scraping, `git pull` + restart, worker list, Tor), the perimeter matters.

## Threats and what stops them

| Threat | Defence | Where |
|---|---|---|
| **Another machine on the LAN** reaches the app | Listens on `127.0.0.1` only (`dev`, `dev:once`, `start`, `start:once`, supervisor). `SUD_HOST=0.0.0.0` is refused unless `APP_API_TOKEN` is set | `scripts/supervisor.mjs`, `package.json` |
| **DNS rebinding** (hostile domain resolving to 127.0.0.1) | `Host` header must be `localhost` / `127.0.0.1` / `[::1]` (+ `APP_ALLOWED_HOSTS`) on **every** API request → 403 `bad_host` | `server/security.ts` `hostAllowed`, `guard` |
| **CSRF**: a web page open in the browser fires requests at `http://localhost:3000` (start/cancel scraping, update, change workers) | **Every** request, GET included (a stats or bills GET starts a real scrape and a captcha, so an `<img src=…/api/bills?…>` on a hostile page would burn worker quota even though it can never read the answer): `Sec-Fetch-Site` ∈ {same-origin, none} and, when `Origin` is sent, `Origin` = `Host` → 403 `cross_site`. `same-site` (another port on localhost) is refused too | `crossSiteReason`, `guard` |
| Forged request to a **dangerous door** even so | `privileged` routes also need the header `x-sud-action: 1` (a custom header cannot cross sites without a preflight the app never grants) and a 10-calls/min budget: `settings/update` (git pull + restart), `settings/workers` POST/DELETE, `settings/workers/test`, `tor-status` POST | `guard(…, {privileged:true})`, `api-client.privilegedHeaders()` |
| **SSRF** through «add worker» / «test worker» | Worker URLs must be `https://` public DNS names: no IPs, `localhost`, single-label/internal names, credentials, query; **and the name must RESOLVE to public addresses only** (a name can point at `127.0.0.1`, `10.x`, `169.254.169.254`: `127.0.0.1.nip.io`); the test fetch does not follow redirects | `workers-config.ts` `isPublicDnsName` / `normalizeWorkerUrl`, `net/public-host.ts` `checkPublicHost` |
| **Runaway / forged background work** | `fetch` accepts ≤ 1500 cases per call, the queue is capped (`MAX_QUEUE` 5000), one loop only, the idle auto-check is **opt-in** (default off) and never fires on a hidden tab | `fetch/route.ts`, `company-job.ts`, `orders-auto-check.tsx` |
| **Data at rest** | orders cache, worker health history and the daily company snapshots live in `~/.sud-tizimi` outside the repo, dir `0700`, files `0600`; a snapshot's file name is the STIR (exactly 9 digits, no path can be smuggled in) and it is swept after 7 days | `public-orders/store.ts`, `data-dir.ts`, `snapshot-store.ts` |
| **Brute-forcing / timing the token** | compared in constant time (`safeEqual`); the rate-limit key ignores `X-Forwarded-For` unless `APP_TRUST_PROXY=1` (a caller-typed header would give every request a fresh budget) | `server/security.ts`, `server/middleware.ts` |
| **An update that wrecks the checkout** | `git pull --ff-only` (a pull needing a merge stops, nothing is merged or left with conflict markers), one update at a time, no credential prompts; local changes stashed for the pull are ALWAYS restored (also when the pull fails) | `settings/update/route.ts` |
| **Not noticing a forged / stray request** | every refusal in `guard()` and every use of a privileged door is recorded (method + path only, never a query or body): Settings › **Xavfsizlik**, `GET /api/settings/security`, and a throttled `[security]` line in the server log | `server/audit.ts`, `core/security-events.ts`, `views/security-settings.tsx` |
| **Untrusted values in upstream URLs / child processes** | case numbers are shape-checked before they reach a URL path (`court-cases?detail=` included); curl runs with `--globoff` (no `{}`/`[]` expansion) and `--` before the URL; spreadsheet download names are `[A-Za-z0-9._-]` only and no export grants CORS | `court-cases/route.ts`, `court-case.ts`, `lib/xlsx.ts` |
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

- Production without `APP_API_TOKEN` still runs (the Host / cross-site checks and the loopback bind remain); Settings › Xavfsizlik shows a warning for it. Set the token for any `bun run start` you leave running.
- The CSP still allows inline scripts in production (Next's bootstrap). There is no HTML sink in the code (no `innerHTML` / `dangerouslySetInnerHTML`; print windows escape every scraped string), so a nonce CSP would add risk of a blank app for little gain; revisit if a rich-text feature appears.
- `NEXT_PUBLIC_APP_API_TOKEN` (the browser copy of the token) is visible to anyone who can open the page — the token protects against other machines/pages, not against someone at the keyboard.
- `workers.json` (your Cloudflare worker URLs) is tracked in git; treat the repo as private or move it to `.gitignore` + `git rm --cached`.
- The orginfo direct fallback (`ORGINFO_DIRECT_FALLBACK`) sends a few requests from the operator's IP when a worker attempt fails; set `0` to forbid.
- LAN use needs: `SUD_HOST=<ip>`, `APP_API_TOKEN`, `APP_ALLOWED_HOSTS=<name>` — and is not recommended.

## Dependencies

- `bun run audit` (= `bun audit`) lists known vulnerabilities. Keep `dependencies` to what the code imports (18 packages): an unused package is pure attack surface (an audit found `next-auth` with a critical advisory, never imported).
- `bun audit --prod` must say «No vulnerabilities found». `package.json` `overrides` pin `postcss`, `nanoid` and `baseline-browser-mapping` to patched versions (they came in through `next` / `@tailwindcss/postcss`). The rest of `bun audit` (eslint / babel build tooling: ReDoS in `minimatch`, `braces`…) never runs on request data and is left alone: forcing those majors apart breaks the toolchain. `bun.lock` uses `registry.npmjs.org` URLs.
- Keep `next` on the latest patched 16.x (`bun update next eslint-config-next`); the audit of 2026-09 found critical Next.js advisories (RCE on Windows hosts, image-optimizer RCE) below 16.2.5. `next.config.ts` sets `agentRules: false` so `next dev` does not append its own block to AGENTS.md.
- Removing a dependency: grep imports first (`from '<pkg>`), then `bun remove`.

## Checklist before merging

`bun run typecheck` · `bun run lint` · `bun test src/core src/lib src/server` · `bun run map:check` · `bun run audit` (after dependency changes).
