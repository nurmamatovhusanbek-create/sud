# Security model

The app is a **private, single-operator tool on localhost** that scrapes sensitive legal/financial data. It has no login.
Since it can now work in the background (queued scraping, `git pull` + restart, worker list, Tor), the perimeter matters.

## Threats and what stops them

| Threat | Defence | Where |
|---|---|---|
| **Another machine on the LAN** reaches the app | Listens on `127.0.0.1` only (`dev`, `dev:once`, `start`, `start:once`, supervisor). `SUD_HOST=0.0.0.0` is refused unless `APP_API_TOKEN` is set | `scripts/supervisor.mjs`, `package.json` |
| **DNS rebinding** (hostile domain resolving to 127.0.0.1) | `Host` header must be `localhost` / `127.0.0.1` / `[::1]` (+ `APP_ALLOWED_HOSTS`) on **every** request: `src/proxy.ts` for pages, `_next/*` and files, `guard()` for `/api` (→ 403 `bad_host`) | `server/security.ts` `hostAllowed`, `guard` |
| **CSRF**: a web page open in the browser fires requests at `http://localhost:3000` (start/cancel scraping, update, change workers) | **Every** request, GET included (a stats or bills GET starts a real scrape and a captcha, so an `<img src=…/api/bills?…>` on a hostile page would burn worker quota even though it can never read the answer): `Sec-Fetch-Site` ∈ {same-origin, none} and, when `Origin` is sent, `Origin` = `Host` → 403 `cross_site`. `same-site` (another port on localhost) is refused too | `crossSiteReason`, `guard` |
| Forged request to a **dangerous door** even so | `privileged` routes also need the header `x-sud-action: 1` (a custom header cannot cross sites without a preflight the app never grants) and a 10-calls/min budget: `settings/update` (git pull + restart), `settings/workers` POST/DELETE, `settings/workers/test`, `settings/vlm` POST/DELETE and `settings/vlm/test` (they hold or spend the operator's VLM key), `settings/telegram` POST/DELETE, `/test` and `/find`, `settings/backup` POST, `/restore`, `/catalog` and `/load` (they upload or fetch the whole database with the operator's bot) (they hold the bot token or post to the operator's channel with it), `settings/db/download|compact|forget` (all the stored data), `documents/custom` POST/DELETE (they write the operator's own templates to disk), `tor-status` POST | `guard(…, {privileged:true})`, `api-client.privilegedHeaders()` |
| **SSRF** through «add worker» / «test worker» | Worker URLs must be `https://` public DNS names: no IPs, `localhost`, single-label/internal names, credentials, query; **and the name must RESOLVE to public addresses only** (a name can point at `127.0.0.1`, `10.x`, `169.254.169.254`: `127.0.0.1.nip.io`); the test fetch does not follow redirects | `workers-config.ts` `isPublicDnsName` / `normalizeWorkerUrl`, `net/public-host.ts` `checkPublicHost` |
| **Runaway / forged background work** | `fetch` accepts ≤ 1500 cases per call, the queue is capped (`MAX_QUEUE` 5000), one loop only, there is no automatic / idle check any more (it was removed: the site refuses scripts), work starts from a click in a case drawer | `fetch/route.ts`, `company-job.ts` |
| **Data at rest** | orders cache (with `downloads.jsonl`: one line per saved PDF, pdf id + size + time + the court's file name, no content; its metadata is mirrored, never the PDFs, to a second folder in the OS app-data directory: `public-orders/meta-backup.ts`, files 0600, folders 0700, restore only fills missing files), worker health history and the daily company snapshots live in `~/.sud-tizimi` outside the repo, dir `0700`, files `0600`; a snapshot's file name is the STIR (exactly 9 digits, no path can be smuggled in) and it is swept after 7 days | `public-orders/store.ts`, `data-dir.ts`, `snapshot-store.ts` |
| **Brute-forcing / timing the token** | compared in constant time (`safeEqual`); the rate-limit key ignores `X-Forwarded-For` unless `APP_TRUST_PROXY=1` (a caller-typed header would give every request a fresh budget) | `server/security.ts`, `server/middleware.ts` |
| **An update that wrecks the checkout** | `git pull --ff-only` (a pull needing a merge stops, nothing is merged or left with conflict markers), one update at a time, no credential prompts; local changes stashed for the pull are ALWAYS restored (also when the pull fails) | `settings/update/route.ts` |
| **A wrong «up to date»** (the check missed a push, or claimed «latest» when it could not check) | `GET settings/version?check=1` asks the same place the update pulls from: `git fetch origin main`, then ahead/behind against HEAD (`lib/update-check`). No cache (the old 5-minute cache and the edge-cached GitHub API are why a push was «sometimes» missed); the GitHub API is only the fallback when git cannot reach the remote; if neither answers the screen says why instead of «Eng soʻnggi». «Newer» means behind > 0, so a local checkout that is ahead of GitHub is not offered an update | `lib/update-check`, `settings/version/route.ts` |
| **Not noticing a forged / stray request** | every refusal in `guard()` and every use of a privileged door is recorded (method + path only, never a query or body): Settings › **Xavfsizlik**, `GET /api/settings/security`, and a throttled `[security]` line in the server log | `server/audit.ts`, `core/security-events.ts`, `views/security-settings.tsx` |
| **Untrusted values in upstream URLs / child processes** | case numbers are shape-checked before they reach a URL path (`court-cases?detail=` included); curl runs with `--globoff` (no `{}`/`[]` expansion) and `--` before the URL; spreadsheet download names are `[A-Za-z0-9._-]` only and no export grants CORS | `court-cases/route.ts`, `court-case.ts`, `lib/xlsx.ts` |
| **Third-party origins** (XSS/exfil) | tight CSP: same-origin only, no external scripts/CDN/fonts; `X-Frame-Options: DENY`, `nosniff`, `Cross-Origin-Resource-Policy: same-origin`, COOP, `no-store` on `/api` | `next.config.ts` |
| Missing / wrong auth in production | `APP_API_TOKEN` (bearer or `x-app-token`) required in production; every client fetch sends it (`authHeaders()`) | `server/middleware.ts` `authorized` |
| A route that forgets `guard()` | test scans every `route.ts`: guarded, `nodejs`, `force-dynamic`, privileged set is exact | `server/__tests__/routes.test.ts` |

## Rules for changes

- `guard(…, {maxBodyBytes})` raises the 8 MB body cap for ONE route that takes a file: `public-orders/import` (an order PDF the person saved from public.sud.uz, 100 MB, validated as `%PDF-`, stored only under its uuid). Cross-site pages are refused by the same guard as every other POST.
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

## Penetration test, Nov 2026 (what was attacked, found and fixed)

Method: dependency audit; read of every process launcher, URL-taking route, upload and HTML builder; then live attacks on the running app
(42 routes × methods × 6 forged-request variants, privileged routes without the header, path traversal / injection in every id, SSRF
tables, hostile zips, XSS payloads in every field of the report). No backdoor was found: no hard-coded secret, no hidden route or
bypass flag, no install scripts (`package.json` has none and no `trustedDependencies`, so Bun runs no dependency lifecycle script), no
obfuscated code, no network call to an unknown host from the app's own code.

| # | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| 1 | **Critical** | Next.js 16.3.8: unauthenticated RCE in the image optimizer (SVG) and in `use cache` typed arrays, DoS in server actions (GHSA-2464-fhr4-w9xw, -673q-mjm6-r5xr, -p3m5-59mp-jv5r, -mfr8-8qww-v76h) | `next` / `eslint-config-next` 16.4.6; image optimizer off (`images.unoptimized`, 404 in `proxy.ts`) | `server/__tests__/proxy.test.ts` |
| 2 | High | 41 more advisories in transitive packages (minimatch, brace-expansion, js-yaml, picomatch, flatted, source-map-js, browserslist, …) and `zod` (memory DoS) | `bun audit fix`, `zod` 4.6.7: `bun run audit` reports none | `bun run audit` in the checklist |
| 3 | Medium | The Host check (DNS rebinding) covered only `/api`: pages, `_next/*` and `public/` could be read by a rebinding page | `src/proxy.ts`: the check runs on EVERY request | `server/__tests__/proxy.test.ts` |
| 4 | Medium | A `.docx` upload was a **decompression bomb**: sizes in a zip header are the uploader's word, so 612 KB inflated to 600 MB (RSS 33 → 875 MB; 5 MB would be ~5 GB) before JSZip noticed | `lib/zip-guard.ts` counts the bytes that really come out and stops at the limit (139 ms, 69 MB); used for uploads and the Excel reader | `lib/__tests__/zip-guard.test.ts` |
| 5 | Medium | The Excel reader built a `RegExp` from the file's `r:id` (ReDoS / crash from a crafted spreadsheet) | the id is escaped: only ever a literal | same |
| 6 | High (if run) | `mini-services/ihamkor-scraper` (unused by the app) listened on **all interfaces**, answered `Access-Control-Allow-Origin: *` and launched Chrome with `--no-sandbox` | loopback only, Host check, no CORS, sandbox on (`IHAMKOR_NO_SANDBOX=1` to opt out) | (service is not part of the test suite; checked by reading) |
| 7 | Low | A worker URL could carry any port (`:6379`): the «test worker» fetch would probe any port of a public host | a worker is https on 443 only | `lib/__tests__/workers-url.test.ts` |
| 8 | Low | Control characters in scraped text were forwarded upstream (`/api/company?q=%00`) or written into Word / Excel XML (XML 1.0 forbids them: the whole file is rejected) | cleaned before use | `zip-guard.test.ts` (XML), route cleans `q` |
| 9 | Info | `X-Powered-By: Next.js` | `poweredByHeader: false` | – |
| 10 | Medium (owner decision) | Four of the six default workers sit on Cloudflare accounts other than the operator's main one; the code comment called them all «the operator's own». A worker's owner reads and can forge every request | the owner confirmed all six are theirs / trusted; the claim is now recorded accurately, and ANY worker outside the named accounts is flagged in Settings and on add | `core/__tests__/worker-trust.test.ts` |

Checked and found sound (do not «fix»): every API route refuses a forged Host / Origin / `Sec-Fetch-Site` (42 × 6 matrix); the privileged
routes refuse a call without `x-sud-action` and are rate-limited (10/min); ids are validated before any path or URL is built (uuid,
`old-<type>-<n>`, 9-digit STIR, generated template ids); every URL the server fetches for the operator is https + public name + resolved
address checked + `redirect: 'manual'`; the report / print builders escape every field (every string of a full fixture was poisoned with
five XSS payloads: `report/__tests__/xss.test.ts`); Excel cells are shared strings, never formulas; the supervisor and `git` are called
without a shell and with fixed arguments.

Residual risks the design accepts (owner decisions): the Content-Security-Policy needs `script-src 'unsafe-inline'` (Next's inline
bootstrap), so the defence against script injection is escaping, not CSP; any LOCAL process can call a privileged route by adding the
`x-sud-action` header (a browser cannot; a program on the same machine could already do anything as the same user); the in-app update
trusts `origin/main` of the repository; a VLM / worker host is checked when it is saved, not pinned at connection time (DNS TOCTOU);
the scraping workers see every request in plaintext and can forge answers: the owner confirmed (Nov 2026) that the six default workers, on the Cloudflare accounts `nurmamatovhusanbek`, `uzwebfox` and `najimsheikh071`, are theirs or trusted. A worker on ANY OTHER account is flagged «Begona hisob» in Settings › Workerlar and with a warning when it is added (`core/worker-trust.ts`; name more trusted accounts with `TRUSTED_WORKER_ACCOUNTS`). Keep the pool to workers you control.

## Penetration test, Nov 2026 (second round: HAR import, Tozalash, pacing, WAF breaker)

Method: raw-socket and HTTP attacks on an isolated copy (own `HOME`, orders dir, no backup): forged Host (HTTP/1.0 without Host), cross-site
`Sec-Fetch-Site`/`Origin` on every new route, junk / traversal ids, malformed JSON, 25 MB PDF and 40 MB HAR uploads, 102 MB over-limit body, a HAR with
20 000 fake order files, a 200 000-deep JSON; `bun audit`; secret and dangerous-sink grep; every route is `guard()`-wrapped.

| # | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| 1 | **Medium** (integrity) | Next cuts a request body at **10 MB without an error** (`Request body exceeded 10MB … Only the first 10MB will be available`). `/api/public-orders/import` answered `200` and stored the first 10 MB of a 25 MB PDF as the order file (a corrupt file reported as success); a HAR over 10 MB was cut mid-JSON | `experimental.proxyClientMaxBodySize: "300mb"` in `next.config.ts` (above the routes' own 100 MB / 256 MB limits, which now answer `413`) | `server/__tests__/body-limit.test.ts` |
| 2 | Low | A crafted HAR with thousands of fake order files made the app write thousands of files (disk fill; the person has to pick the file themselves) | at most `MAX_HAR_FILES` (500) order files per HAR, else `422 too_many` | route check |
| 3 | Info (accepted) | A request that DECLARES a huge `Content-Length` and sends no body is held open by Next while it buffers (no early `413`); needs a passing Host check and, from a browser, a same-origin request, so only a local process can do it | none: a local process can already do more | – |

Checked and found sound: forged Host and cross-site refused on every new route; junk ids in `hidden` ignored (only valid ids counted), traversal ids refused
with 400/404; malformed JSON gives 4xx, never 500; deeply nested JSON gives `422 not_har`; a HAR is only read (no request to any site, cookies and tokens never parsed).

## Checklist before merging

`bun run typecheck` · `bun run lint` · `bun test src/core src/lib src/server` · `bun run map:check` · `bun run audit` (after dependency changes).

## Captcha reader key (VLM)

Each operator brings their own vision-model keys (Settings › Captcha; several providers can be saved, taken in turn with failover: `lib/vlm-pool.ts`). They are saved only on that machine, `~/.sud-tizimi/vlm.json` (file 0600, folder 0700, `VLM_CONFIG_FILE` overrides), never in git and never returned to the browser (`GET /api/settings/vlm` gives the last four characters only). The base URL must be https, a public DNS name and must resolve to a public address (`checkPublicHost`), calls use `redirect: 'manual'`, so a key is only ever sent to the host the operator typed. `VLM_API_KEY` / `VLM_BASE_URL` in the environment remain the fallback. Code: `core/vlm`, `lib/vlm-{config,client,pool,request,test,test-image}`, `views/vlm-settings`.

The Telegram bot (Settings › Telegram, for encrypted copies of the database) follows the same rules: token + channel in `~/.sud-tizimi/telegram.json` (0600, `TELEGRAM_CONFIG_FILE` overrides), never in git, never returned (`GET /api/settings/telegram` gives the bot id and last four characters). The client (`lib/telegram-client`) talks to the ONE fixed host `api.telegram.org`, so the token cannot be sent anywhere else; the token is part of Telegram's URL, so no error, log or result may contain a URL (a test checks it). A token pasted into a chat or a screenshot is burnt: revoke it with @BotFather. The encrypted backup (`lib/backup*`) seals with AES-256-GCM before anything leaves the machine and never stores the passphrase. Code: `core/telegram`, `lib/telegram-{config,client,request}`, `lib/backup{,-crypto}`, `hooks/use-telegram`, `views/telegram-settings`.

## Own document templates

`documents/custom` stores an uploaded .docx under `~/.sud-tizimi/templates` (`DOC_TEMPLATES_DIR` overrides; file 0600, folder 0700). The upload is untrusted: ≤ 5 MB, ≤ 1000 entries, ≤ 40 MB unpacked, must be a Word package, **macro-enabled files are refused**, only a generated id (`custom_<slug>_<4 hex>`, validated by regex) becomes a file name, and only `word/document.xml` is rewritten (markers merged into one run each). The template is never executed: it is filled by string replacement and drawn by docx-preview. Code: `lib/documents/custom{,.server}.ts`, `views/custom-templates.tsx`.

## Kuzatuv (automatic court-list watch)

The only scheduler in the app. `src/instrumentation.ts` starts a 60 s timer in the Node runtime; `lib/watch` does nothing unless `meta.watch_config.enabled` is true (default false, set from Settings › Telegram, `privileged` route `/api/settings/watch`). When on, it reads the operator's own companies' court lists (only STIRs already in the database or typed in the setting) at the app's usual pace and sends messages through the saved bot token to the listed Telegram ids only. The token never leaves `lib/telegram-config`; message text holds names and STIRs, so recipients must be the operator's own accounts. Switching it off stops it at the next tick.

## Automatic backup passphrase

Only when the operator switches «Avtomatik zaxira» on: the backup passphrase is kept in `~/.sud-tizimi/backup-pass.json` (0600, folder 0700), outside the project and git, like `telegram.json` and `vlm.json`. It is never sent back to the browser or logged; switching the feature off deletes the file. Whoever can read that file and `telegram.json` can read the channel's backups: protect the computer's account accordingly.

## The bot link (`lib/bot-link`, bot `link.rs`)
Opt-in (Settings › Telegram › «Bot bilan ulanish»). The app only makes OUTBOUND HTTPS calls to the bot address the operator typed (https only; plain http for localhost) and nothing new listens on the computer. The calls are signed with a key derived from the bot token (`HMAC-SHA256(token, "sud-link-v1")` over time, path and body, 2-minute window), so no new secret exists; the bot's two doors `/link/synced` and `/link/pull` answer 401 to anything else and read at most 64 KB. The app accepts from the bot only STIRs of nine digits and number ids, and never runs anything the bot sends. What the link can make the app do: re-read ONE company's public court lists and take a backup, at most one company at a time, queued with caps (3 per person, 20 in all, 5-minute cooldown per company); the people able to ask are the ones on the bot's `ALLOWED_USER_IDS`. Whoever holds the bot token can sign calls: the same trust as holding the token itself (it already lets them read the channel).

