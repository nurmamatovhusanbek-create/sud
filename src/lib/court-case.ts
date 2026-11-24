import crypto from 'crypto'
import { spawn } from 'child_process'
import fs from 'fs'
import ZAI from 'z-ai-web-dev-sdk'

/**
 * v157: Resolve the CORRECT curl binary path.
 *
 * Problem: When running `bun run dev` from Git Bash (MINGW64) on Windows,
 * Node.js inherits the MSYS2 PATH where /usr/bin/curl (OpenSSL TLS) comes
 * BEFORE C:\Windows\System32\curl.exe (Schannel TLS). spawn('curl') then
 * finds the OpenSSL curl, which jadval.sud.uz REJECTS with 502 Bad Gateway.
 *
 * Fix: On Windows, explicitly use C:\Windows\System32\curl.exe — the
 * Schannel-based curl that jadval.sud.uz accepts. On Linux/Mac, use 'curl'
 * from PATH (the system curl).
 *
 * This is logged once on first use so we can confirm the right binary.
 */
let _curlBinResolved = false
let _curlBin = 'curl'

function resolveCurlBinary(): string {
  if (_curlBinResolved) return _curlBin

  if (process.platform === 'win32') {
    // Try System32 curl (Schannel TLS) — this is what jadval.sud.uz accepts
    const system32Curl = 'C:\\Windows\\System32\\curl.exe'
    if (fs.existsSync(system32Curl)) {
      _curlBin = system32Curl
      console.log(`[court-case] curl binary: ${_curlBin} (Windows System32 / Schannel TLS)`)
    } else {
      // Fall back to PATH lookup (may find MSYS2 curl — not ideal)
      _curlBin = 'curl'
      console.log(`[court-case] WARNING: C:\\Windows\\System32\\curl.exe not found, using PATH 'curl' (may get 502 from jadval.sud.uz)`)
    }
  } else {
    _curlBin = 'curl'
    console.log(`[court-case] curl binary: system 'curl' from PATH (Linux/Mac)`)
  }

  _curlBinResolved = true
  return _curlBin
}

/**
 * my.sud.uz Court Case Search service.
 *
 * The court case search on my.sud.uz uses TWO API servers:
 * 1. jadval.sud.uz — older API, returns case list data
 * 2. jadvalapi.sud.uz — newer API, returns monitoring data with hearings
 *
 * Neither requires authentication or captcha — they are public endpoints!
 * The frontend calls BOTH and merges the results.
 *
 * Case number format: "4-1001-2605/14720" — the "/" is replaced with "@"
 * in the URL: "4-1001-2605@14720"
 */

const JADVAL_API = 'https://jadval.sud.uz'
const JADVALAPI = 'https://jadvalapi.sud.uz'

/**
 * v207: jadval.sud.uz fake-empty / throttle detection.
 *
 * Measured behavior (TIN 200248856 investigation): the jadval search service
 * rate-limits per source IP with recovery. When throttled it answers in ~1s
 * with a plain-text fake-empty ("Ишлар топилмади", HTTP 200, not JSON) or just
 * hangs; when healthy it answers JSON in 1.8-21s. Such a response is a
 * retryable glitch, never a definitive answer. Shared by the search and the
 * details paths.
 */
function isFakeEmptyText(t: string): boolean {
  return t.includes('топилмади') || t.includes('мавжуд эмас')
}

/**
 * v207: jadval.sud.uz DNS has a single A record (45.150.25.203), but the
 * sibling machine behind jadvalapi.sud.uz (94.158.54.73) serves the same
 * Express app and answers jadval.sud.uz requests correctly (SNI/Host intact).
 * The search service rate-limits per source IP — alternating between the two
 * machines samples two independent throttle buckets, roughly doubling the
 * odds a retry lands on a healthy one. Env-overridable in case upstream
 * changes: JADVAL_RESOLVE_IP (empty string disables the pin).
 */
const JADVAL_ALT_IP = process.env.JADVAL_RESOLVE_IP !== undefined
  ? process.env.JADVAL_RESOLVE_IP
  : '94.158.54.73'

// v206: all worker fan-out goes through the shared hedged scheduler —
// court-case no longer builds its own worker list or health pool (the
// scheduler records per-worker health for the Settings dashboard).
import { fetchViaWorkers, readBodyIdle } from './net/worker-fetch'
import { salvageJsonArray } from '@/core/json-salvage'
import { backupFeedKey, mergeRows, readFeed, writeFeed } from './case-store'

// ---- Types (re-exported from court-case-types.ts) ----
export type { CourtType, SearchMode, CourtCase, CaseDetail, Hearing, Decision, CaseDocument, InstanceData, FullCaseData } from './court-case-types'
import type { CourtType, SearchMode, CourtCase, FullCaseData, Hearing, InstanceData } from './court-case-types'
import { currentInstance, pickHearing, reviewsOf, stageOfRow, type HearingStage } from '@/core/hearing-pick'
import { daysUntil } from '@/core/dates'

// ---- Status enums for UI ----
export { CASE_STATUSES, HEARING_STATUSES, COURT_TYPE_LABELS } from './court-case-types'

// ---- API calls (NO auth, NO captcha needed — these are public endpoints) ----

/**
 * v149/v156: curl-based fetch for jadval.sud.uz.
 *
 * Problem: jadval.sud.uz does TLS fingerprinting (JA3/JA4). Node.js's fetch
 * (undici) and CF Workers both have non-browser TLS fingerprints, so
 * jadval.sud.uz blocks them.
 *
 * Fix: Use system `curl` as a child process via spawn (NOT execSync).
 *
 * CRITICAL — why spawn works and execSync doesn't (learned the hard way
 * across v149→v155):
 * - spawn('curl', args) with NO shell: Node calls CreateProcess('curl', ...).
 *   Windows searches the Windows PATH and finds C:\Windows\System32\curl.exe.
 *   That curl is built with Schannel (Windows native TLS). jadval.sud.uz
 *   ACCEPTS Schannel's TLS fingerprint and returns real case data.
 * - execSync('curl ...', {shell:'bash'}): bash (MSYS2) searches its own PATH
 *   and finds /usr/bin/curl (MSYS2 curl, built with OpenSSL). jadval.sud.uz
 *   REJECTS OpenSSL curl's TLS fingerprint -> 559-byte error HTML page.
 * - execSync without shell option: defaults to cmd.exe on Windows, which
 *   splits header values on spaces ("Could not resolve host: application").
 *
 * So: ALWAYS use spawn('curl', args) without a shell. This is the v150/v152
 * approach that the user confirmed works. v154/v155 broke it by switching to
 * execSync — v156 reverts to spawn.
 *
 * This is ONLY used for jadval.sud.uz (not jadvalapi.sud.uz, which doesn't
 * do TLS fingerprinting and works fine via CF Workers).
 */
function curlFetch(url: string, altIp?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '--silent', '--show-error',
      // curl expands {a,b} and [1-9] in a URL into many requests: the URL here must be taken literally
      '--globoff',
      // v207: real full-history searches on jadval.sud.uz measured at 6.6-21s;
      // 15s truncated some good responses (exit 28). 25s covers observed nodes.
      '--max-time', '25',
      '--compressed',
      '-H', 'Accept: application/json, text/plain, */*',
      '-H', 'Accept-Language: en-GB,en;q=0.5',
      '-H', 'Origin: https://my.sud.uz',
      '-H', 'Referer: https://my.sud.uz/',
      '-H', 'Sec-Fetch-Dest: empty',
      '-H', 'Sec-Fetch-Mode: cors',
      '-H', 'Sec-Fetch-Site: same-site',
      '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      '-H', 'sec-ch-ua: "Not=A?Brand";v="99", "Brave";v="151", "Chromium";v="151"',
      '-H', 'sec-ch-ua-mobile: ?0',
      '-H', 'sec-ch-ua-platform: "Windows"',
      // v207: optional IP pin (curl still sends SNI/Host for jadval.sud.uz, so
      // the sibling machine serves the right vhost — TLS cert validates too).
      ...(altIp ? ['--resolve', `jadval.sud.uz:443:${altIp}`] : []),
      '--', url,
    ]

    // v157: Use the explicitly resolved curl binary (System32 curl on Windows
    // for Schannel TLS, system curl on Linux/Mac). This avoids the MSYS2
    // OpenSSL curl that Git Bash's PATH would otherwise find.
    const curlBin = resolveCurlBinary()
    const child = spawn(curlBin, args, {
      timeout: 28000,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => { stdout += data.toString() })
    child.stderr.on('data', (data) => { stderr += data.toString() })

    child.on('error', (err) => {
      console.error(`[court-case] curl spawn error for ${url}: ${err.message}`)
      if (err.message.includes('ENOENT') || err.message.includes('spawn')) {
        console.error('[court-case] curl binary not found! Install curl or add to PATH.')
      }
      reject(new Error(`curl spawn failed: ${err.message}`))
    })

    child.on('close', (code) => {
      if (code === 0 && stdout.length > 0) {
        if (stdout.includes('топилмади') || stdout.includes('мавжуд эмас')) {
          console.log(`[court-case] curl got 'not found' text from ${url} (${stdout.length} bytes)`)
          reject(new Error('curl: not found text response'))
          return
        }
        console.log(`[court-case] curl got ${stdout.length} bytes from ${url}`)
        resolve(stdout)
      } else {
        console.error(`[court-case] curl exit code ${code} for ${url}, stderr: ${stderr.slice(0, 200)}, stdout: ${stdout.slice(0, 100)}`)
        reject(new Error(`curl exit ${code}: ${stderr.slice(0, 100) || stdout.slice(0, 100) || 'no output'}`))
      }
    })
  })
}

/**
 * v156: Helper — run curlFetch + JSON parse + map to CourtCase[].
 * Extracted so all 3 retry tiers can use curl, not just the initial race.
 * Includes diagnostic logging: if the response isn't valid JSON, logs the
 * first 300 chars so we can see what jadval.sud.uz actually returned
 * (error page, captcha, rate-limit, etc.) instead of just "parse failed".
 */
async function curlFetchCases(url: string, mapper: (raw: any) => CourtCase, altIp?: string): Promise<CourtCase[]> {
  const text = await curlFetch(url, altIp)
  try {
    const data = JSON.parse(text)
    const items = Array.isArray(data) ? data : (data.data || [])
    console.log(`[court-case] curl fetch got ${items.length} cases from ${url}`)
    return items.map(mapper)
  } catch (parseErr) {
    const preview = text.slice(0, 300).replace(/\n/g, ' ')
    console.error(`[court-case] curl got ${text.length} bytes from ${url} but JSON.parse failed — first 300 chars: ${preview}`)
    throw new Error(`curl: response is not valid JSON (${text.length} bytes)`)
  }
}

/**
 * v140: Server-side in-memory cache for court-case search results.
 *
 * Problem: When the user opens the Stats tab, it fires 3 searchCourtCases
 * calls (economic + civil + administrative). The Upcoming Hearings tab fires
 * the SAME 3 calls. The Watchlist tab fires them too. Without caching, that's
 * 9 identical fetches to jadvalapi.sud.uz within seconds — each taking 5-15s.
 *
 * Solution: Cache results for 60 seconds. The FIRST call fetches and caches;
 * concurrent + subsequent calls within 60s get the cached result instantly.
 * This cuts the total fetch time from 45s+ to ~5s when multiple tabs load
 * the same TIN.
 */
/**
 * `capped`: a source answered with exactly its row limit, so the court's own list is cut off (see LIST_CAPS). What is shown is then a
 * window, not the company's whole history.
 */
export interface CourtListResult {
  cases: CourtCase[]
  incomplete: boolean
  capped?: boolean
}

/**
 * The court APIs cut a TIN list off at a fixed number of rows, with no way to ask for the rest (no page, offset, limit or date parameter
 * is read; measured Nov 2026 on a water utility with thousands of cases: jadvalapi answered exactly 100, always the NEWEST by
 * registration date, jadval.sud.uz exactly 200, mostly 2023 ones, and the site's own «Суддаги ишлар» showed 300 = 100 + 200).
 * An answer that reaches the cap is therefore not «everything»: it is merged into what the disk already holds instead of replacing it,
 * so a case that has slid out of the newest 100 stays known.
 */
export const LIST_CAPS: Record<string, number> = { 'jadvalapi.sud.uz': 100, 'jadval.sud.uz': 200 }

interface CourtCaseCacheEntry {
  result: Promise<CourtListResult>
  ts: number
}
const courtCaseCache = new Map<string, CourtCaseCacheEntry>()
// v207: 60s was burning the jadval.sud.uz per-TIN token bucket on every
// re-view (watchlist refresh, tab revisits, stats re-aggregation). The full
// archive on jadval changes slowly; 10 minutes of server-side memoization
// keeps the per-TIN quota intact. Watchlist Yangilash (force) still bypasses.
const COURT_CASE_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

/**
 * v153: Shared cache-lookup + fetch, used by both searchCourtCases and
 * searchCourtCasesDetailed below, so they always share the SAME in-flight
 * fetch/cache entry — calling both for the same TIN never double-fetches.
 */
function getCourtCasesCached(
  courtType: CourtType,
  mode: SearchMode,
  value: string,
): Promise<CourtListResult> {
  // Case numbers use "@" instead of "/" in the URL
  const encodedValue = mode === 'caseNumber' ? value.replace('/', '@') : value

  // v140: Check server-side cache first — deduplicates concurrent calls
  const cacheKey = `${courtType}:${mode}:${encodedValue}`
  const cached = courtCaseCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < COURT_CASE_CACHE_TTL) {
    console.log(`[court-case] cache hit for ${cacheKey} (age ${Math.round((Date.now() - cached.ts) / 1000)}s)`)
    return cached.result
  }

  // Fire the actual fetch and store the PROMISE so concurrent calls share it
  const fetchPromise = searchCourtCasesInternal(courtType, mode, value, encodedValue)
  courtCaseCache.set(cacheKey, { result: fetchPromise, ts: Date.now() })

  // Sweep old entries
  if (courtCaseCache.size > 30) {
    const now = Date.now()
    for (const [k, v] of courtCaseCache) {
      if (now - v.ts > COURT_CASE_CACHE_TTL * 5) courtCaseCache.delete(k)
    }
  }

  return fetchPromise
}

/**
 * v166: Clear server-side court-case cache for a specific TIN.
 * Used by /api/stats?force=1 to force a fresh scrape.
 */
export function clearCourtCaseCache(tin: string): void {
  const keysToDelete: string[] = []
  for (const key of courtCaseCache.keys()) {
    if (key.includes(tin)) {
      keysToDelete.push(key)
    }
  }
  for (const key of keysToDelete) {
    courtCaseCache.delete(key)
  }
  if (keysToDelete.length > 0) {
    console.log(`[court-case] cleared ${keysToDelete.length} cache entries for TIN ${tin}`)
  }
}

/**
 * Search court cases. Calls both jadval.sud.uz and jadvalapi.sud.uz and merges
 * the results (the Angular frontend does the same).
 *
 * - Economic: findByTin (by INN) or findByNumber (by case number)
 * - Civil: findByNumber (by case number) or findByPinfl (by PINFL)
 * - Criminal: findByCriminalNumber
 * - Administrative: findByAdmNumber or findByTin
 *
 * v140 ARCHITECTURE: PARALLEL RACE instead of sequential failover.
 * Fires ALL CF Workers + public CORS proxies + direct fetch SIMULTANEOUSLY.
 * First valid response wins (Promise.any). If ANY worker is alive, we get
 * data in 1-3s instead of 12-48s with sequential failover.
 *
 * Public contract is unchanged (resolves to the case list only). Callers that
 * need to know whether the result may be INCOMPLETE — i.e. some underlying
 * endpoint failed on every proxy + retry, so "0 extra cases" might mean
 * "couldn't reach the source" rather than "confirmed no cases" — should use
 * searchCourtCasesDetailed instead (used by the Stats tab).
 */
export async function searchCourtCases(
  courtType: CourtType,
  mode: SearchMode,
  value: string,
): Promise<CourtCase[]> {
  const { cases } = await getCourtCasesCached(courtType, mode, value)
  return cases
}

/**
 * v153: Same lookup as searchCourtCases, but also reports `incomplete: true`
 * when at least one endpoint (jadval.sud.uz or jadvalapi.sud.uz) exhausted
 * every CF Worker + direct/curl attempt across all 3 retry tiers without a
 * single success. Before this, that failure mode silently resolved to `[]`
 * indistinguishable from a genuine "no cases", so the Stats tab's own
 * partial-data warning banner never fired even when a whole data source was
 * unreachable — the user just saw a too-low total with no explanation.
 * Shares the same cache as searchCourtCases, so using both costs one fetch.
 */
export async function searchCourtCasesDetailed(
  courtType: CourtType,
  mode: SearchMode,
  value: string,
): Promise<CourtListResult> {
  return getCourtCasesCached(courtType, mode, value)
}

/**
 * Internal fetch logic — v206: HEDGED racing through the shared worker
 * scheduler (`net/worker-fetch`), NOT fire-all.
 *
 * Was: for each endpoint, fire ALL CF Workers + direct in parallel across a
 * 3-tier 10/15/20s retry ladder → ~6 requests per endpoint per lookup, ~30+
 * on a single company open, which is exactly what tripped the rate limits.
 *
 * Now: ONE hedged call per endpoint (best worker first; second worker only
 * after hedgeMs; capped at maxAttempts). A dead/slow worker is still covered
 * by the hedge + failover. The 3-tier ladder is gone — the scheduler's
 * hedging + failover replaces it. Union-across-endpoints, dedupe-by-caseNumber
 * and the "definitive 404 = empty" semantics are unchanged.
 */
async function searchCourtCasesInternal(
  courtType: CourtType,
  mode: SearchMode,
  value: string,
  encodedValue: string,
): Promise<CourtListResult> {
  // Determine the API paths based on court type and search mode
  const apiConfig = getApiConfig(courtType, mode, encodedValue)

  console.log(`[court-case] searching ${courtType} by ${mode}=${value}`)

  // v206: for each apiConfig entry, a single hedged scheduler call.
  //
  // v207 (TIN 200248856 investigation): jadval.sud.uz's search service runs a
  // TOKEN BUCKET PER TIN — hammer a TIN and it answers a fake-empty plain-text
  // "Ишлар топилмади" (HTTP 200, not JSON) or hangs for ~10-30 min, regardless
  // of source IP (verified: a never-queried TIN succeeded from a burnt IP;
  // the burnt TIN failed from four different CF-worker egress IPs). So the
  // strategy is SPEND FEW QUERIES, NOT MORE RETRIES: scheduler samples 2
  // workers, then 2 spaced direct-curl samples alternating the two backend
  // machines (per-machine bucket variance). One healthy sample wins and the
  // result is memoized. jadvalapi.sud.uz keeps its proven fast semantics.

  const promises = apiConfig.map(async ({ url, mapper }) => {
    const origin = (() => {
      try { return new URL(url).hostname } catch { return url }
    })()
    const isJadvalSudUz = origin.includes('jadval.sud.uz')

    // jadval.sud.uz direct-curl ladder: 2 samples, alternating machines
    // (alt-IP pin first — the DNS record is the historically flakier one),
    // 6s apart. Each attempt self-validates (curlFetchCases rejects
    // fake-empty / non-JSON). Under a drained per-TIN bucket extra attempts
    // are pure quota burn — 2 is the sweet spot.
    const ladderIps = [JADVAL_ALT_IP || undefined, undefined]
    const curlLadder = async (): Promise<{ items: CourtCase[]; failed: boolean }> => {
      if (!isJadvalSudUz) return { items: storedRows(courtType, mode, value, url), failed: true }
      for (let i = 0; i < ladderIps.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 6_000))
        try {
          return { items: await curlFetchCases(url, mapper, ladderIps[i]), failed: false }
        } catch { /* throttled/bad node — next sample */ }
      }
      return { items: storedRows(courtType, mode, value, url), failed: true }
    }

    try {
      // a TIN list has NO pagination: a bank answers with every case it ever had in one multi-megabyte array. So the timeout covers only the
      // headers (`streamBody`), the body is read with an idle limit, and a duplicate hedge is not fired for a slow first byte (it would
      // run the same heavy query twice); what arrived before a stall or a break is kept (below)
      const isList = /\/findByTin\//.test(url)
      // what this endpoint last said about this company (disk): asked with its ETag so an unchanged big list costs nothing, and the rows
      // that arrived are merged into it, never replacing it with less (lib/case-store)
      const feedKey = isList && mode === 'tin' && /^\d{9}$/.test(value) ? feedKeyOf(courtType, url) : null
      const known = feedKey ? readFeed(value, feedKey) : null
      const kept: CourtCase[] = known?.items ?? []
      const res = await fetchViaWorkers(url, {
        originKey: origin,
        // v207: jadval real searches measured at 1.8-21s — 12s killed winners;
        // 20s + curl fallback covers the tail without stalling the request.
        // A TIN LIST is slower still: the court's backend takes 5-29 s (measured, TIN of a large company) before the first byte, so the
        // headers get 90 s (the body has its own idle limit below)
        timeoutMs: isList ? 90_000 : isJadvalSudUz ? 20_000 : 12_000,
        hedgeMs: isList ? 6_000 : 800,
        // v207: per-TIN token bucket — 2 worker samples, not 3.
        maxAttempts: 2,
        streamBody: isList,
        headers: known?.complete && known.etag ? { 'If-None-Match': known.etag } : undefined,
      })
      if (res.status === 304 && known) {
        console.log(`[court-case] ${origin} — list not modified, ${known.items.length} cases from disk`)
        return { items: known.items, failed: false, capped: known.capped }
      }
      if (!res.ok) {
        // v149: CONFLICT/findByTin returns 404 intermittently — don't treat
        // as definitive. Only treat 404/410 as definitive for non-CONFLICT URLs.
        const isConflict = url.includes('CONFLICT')
        if ((res.status === 404 || res.status === 410) && !isConflict) {
          console.log(`[court-case] ${url} — definitive not-found, returning []`)
          return { items: [] as CourtCase[], failed: false }
        }
        if (isJadvalSudUz) return await curlLadder()
        console.log(`[court-case] ${url} — HTTP ${res.status} after hedged attempts, marking as incomplete`)
        return { items: kept, failed: true }
      }
      // a worker may answer 200 for a conditional request (it re-fetches and does not pass «not modified» on), but the answer still carries
      // the ETag: the same ETag is the same list, so the body is not downloaded or parsed at all
      if (known?.complete && known.etag && res.headers.get('etag') === known.etag) {
        void res.body?.cancel().catch(() => {})
        console.log(`[court-case] ${origin} — same ETag, ${known.items.length} cases from disk (body not read)`)
        return { items: known.items, failed: false, capped: known.capped }
      }
      const body = isList ? await readBodyIdle(res, { idleMs: 20_000, totalMs: 240_000 }) : { text: await res.text(), complete: true }
      const text = body.text
      if (!body.complete) {
        // a stalled or broken download of a big list: keep the complete cases that arrived and say the list is partial (honesty invariant)
        const part = salvageJsonArray(text)
        console.log(`[court-case] ${origin} — big list cut short (${body.reason}): kept ${part.items.length} complete cases of the part that arrived`)
        if (part.items.length > 0) {
          const arrived = part.items.map(mapper)
          const merged = feedKey ? mergeRows(kept, arrived) : arrived
          if (feedKey) writeFeed(value, feedKey, { t: Date.now(), complete: false, items: merged }) // no ETag: the next ask must fetch it all
          return { items: merged, failed: true }
        }
        if (isJadvalSudUz) return await curlLadder()
        return { items: kept, failed: true }
      }
      // v207: fake-empty from a bad LB node is a retryable glitch, NOT a
      // definitive answer — a fast response here is almost always fake.
      if (isFakeEmptyText(text)) {
        console.log(`[court-case] ${origin} — fake-empty from flaky node, trying curl ladder`)
        if (isJadvalSudUz) return await curlLadder()
        return { items: kept, failed: true }
      }
      const data = JSON.parse(text)
      const rawRows: unknown[] = Array.isArray(data) ? data : (data.data || [])
      const items = rawRows.map(mapper)
      console.log(`[court-case] ${origin} — got ${items.length} cases via scheduler`)
      // a list that reaches the source's row limit is only a WINDOW: it is merged into the stored one, a smaller one is the whole truth
      const cap = isList ? LIST_CAPS[origin] : undefined
      const capped = !!cap && rawRows.length >= cap
      if (capped) console.log(`[court-case] ${origin} — ${rawRows.length} rows = the source's limit (${cap}): older cases may be missing, kept ones are merged in`)
      const shown = capped && feedKey ? mergeRows(kept, items) : items
      // a COMPLETE list is the truth: it replaces the stored one (a case the court no longer lists is gone) and keeps its ETag
      if (feedKey) writeFeed(value, feedKey, { t: Date.now(), etag: res.headers.get('etag') ?? undefined, complete: true, capped: capped || undefined, items: shown })
      return { items: shown, failed: false, capped }
    } catch {
      // All workers failed at transport level → jadval.sud.uz gets the curl
      // ladder (its TLS bypass + LB roulette sampling), everything else marks
      // the endpoint incomplete (honesty invariant — v153).
      if (isJadvalSudUz) return await curlLadder()
      console.log(`[court-case] ${url} — all worker attempts failed, marking as incomplete`)
      return { items: storedRows(courtType, mode, value, url), failed: true }
    }
  })

  const results = await Promise.all(promises)
  // Merge and deduplicate by case number
  const merged: CourtCase[] = []
  const at = new Map<string, number>()
  let incomplete = false
  let capped = false
  for (const { items, failed, capped: cut } of results) {
    if (failed) incomplete = true
    if (cut) capped = true
    for (const item of items) {
      if (!item.caseNumber) continue
      const i = at.get(item.caseNumber)
      if (i === undefined) {
        at.set(item.caseNumber, merged.length)
        merged.push(item)
      } else if (!isAhead(merged[i].hearingDate) && isAhead(item.hearingDate)) {
        // the two APIs disagree: keep the row that knows the hearing still ahead
        // the court and judge come WITH the hearing (an appeal hearing in the first court's row would show the wrong judge)
        merged[i] = { ...merged[i], hearingDate: item.hearingDate, hearingTime: item.hearingTime, judge: item.judge, courtName: item.hearingStage && item.hearingStage !== 'first' ? item.courtName : merged[i].courtName, hearingStage: item.hearingStage }
      }
    }
  }

  // what a backup knew and the live lists do not show now: kept (a case seen once is not lost because an endpoint answered with less)
  if (mode === 'tin' && /^\d{9}$/.test(value)) {
    for (const item of readFeed(value, backupFeedKey(courtType))?.items ?? []) {
      if (item.caseNumber && !at.has(item.caseNumber)) {
        at.set(item.caseNumber, merged.length)
        merged.push(item)
      }
    }
  }

  console.log(`[court-case] found ${merged.length} cases${incomplete ? ' — INCOMPLETE: one or more sources failed' : ''}`)
  return { cases: merged, incomplete, ...(capped ? { capped } : {}) }
}

/** the stored feed of one list endpoint: court + host + path without the company number (the number is the file) */
function feedKeyOf(courtType: CourtType, url: string): string {
  try {
    const u = new URL(url)
    return `${courtType}|${u.hostname}${u.pathname.replace(/\/\d+$/, '')}`
  } catch {
    return `${courtType}|${url}`
  }
}

/** what the disk holds for a list endpoint when every worker failed: the last rows, never nothing (the result is still marked incomplete) */
function storedRows(courtType: CourtType, mode: SearchMode, value: string, url: string): CourtCase[] {
  if (mode !== 'tin' || !/\/findByTin\//.test(url) || !/^\d{9}$/.test(value)) return []
  return readFeed(value, feedKeyOf(courtType, url))?.items ?? []
}

interface ApiConfig {
  url: string
  mapper: (raw: any) => CourtCase
}

function getApiConfig(courtType: CourtType, mode: SearchMode, value: string): ApiConfig[] {
  const configs: ApiConfig[] = []
  const courtTypeUpper = courtType.toUpperCase()

  // jadvalapi.sud.uz endpoints (newer API with hearings)
  if (courtType === 'economic') {
    if (mode === 'tin') {
      configs.push({
        url: `${JADVALAPI}/online-monitoring/ECONOMIC/findByTin/${value}`,
        mapper: mapJadvalApiCase,
      })
    } else {
      configs.push({
        url: `${JADVALAPI}/online-monitoring/ECONOMIC/findByNumber/${value}`,
        mapper: mapJadvalApiCase,
      })
    }
  } else if (courtType === 'civil') {
    if (mode === 'caseNumber') {
      configs.push({
        url: `${JADVALAPI}/online-monitoring/CIVIL/findByNumber/${value}`,
        mapper: mapJadvalApiCase,
      })
    } else if (mode === 'tin') {
      // CIVIL findByTin — verified working (returns civil cases by TIN with
      // `result` field in ~0.6s). Used by the Statistika tab.
      configs.push({
        url: `${JADVALAPI}/online-monitoring/CIVIL/findByTin/${value}`,
        mapper: mapJadvalApiCase,
      })
    }
  } else if (courtType === 'criminal') {
    // the route exists (an unknown TIN answers 404 «No claims found.», read live Nov 2026) but a company rarely has a criminal case, so the
    // UI asks for it only when «Jinoyat» is picked, never as part of «Barchasi»; the row shape is assumed to be the other types'
    configs.push({
      url: `${JADVALAPI}/online-monitoring/CRIMINAL/${mode === 'tin' ? 'findByTin' : 'findByNumber'}/${value}`,
      mapper: mapJadvalApiCase,
    })
  } else if (courtType === 'administrative') {
    if (mode === 'tin') {
      configs.push({
        url: `${JADVALAPI}/online-monitoring/CONFLICT/findByTin/${value}`,
        mapper: mapJadvalApiCase,
      })
    } else {
      configs.push({
        url: `${JADVALAPI}/online-monitoring/CONFLICT/findByNumber/${value}`,
        mapper: mapJadvalApiCase,
      })
    }
  }

  // jadval.sud.uz endpoints (older API with case details)
  if (courtType === 'economic') {
    if (mode === 'tin') {
      configs.push({
        url: `${JADVAL_API}/case/findByTin/${value}`,
        mapper: mapJadvalCase,
      })
    } else {
      configs.push({
        url: `${JADVAL_API}/case/findByNumber/${value}`,
        mapper: mapJadvalCase,
      })
    }
  } else if (courtType === 'civil') {
    if (mode === 'caseNumber') {
      configs.push({
        url: `${JADVAL_API}/case/findByCivilNumber/${value}`,
        mapper: mapJadvalCase,
      })
    }
  } else if (courtType === 'criminal') {
    if (mode === 'caseNumber') {
      configs.push({
        url: `${JADVAL_API}/case/findByCriminalNumber/${value}`,
        mapper: mapJadvalCase,
      })
    }
  } else if (courtType === 'administrative') {
    if (mode === 'caseNumber') {
      configs.push({
        url: `${JADVAL_API}/case/findByAdmNumber/${value}`,
        mapper: mapJadvalCase,
      })
    }
  }

  return configs
}

// ---- Mappers ----

/** `4-1001-2605/14720` and kin: digits and dashes, a slash, digits. */
const CASE_NUMBER_RE = /^\d+-[\d-]+\/\d+$/

const isAhead = (d: string): boolean => (daysUntil(d) ?? -1) >= 0

function mapJadvalApiCase(raw: any): CourtCase {
  return {
    caseNumber: raw.casenumber || raw.caseNumber || '-',
    caseType: raw.category || raw.sub_category || '-',
    caseStatus: raw.status_name || raw.instance || '-',
    result: raw.result || '-',
    courtName: raw.court || '-',
    dateFiled: raw.reg_date || raw.hearing_date || '-',
    // jadvalapi has a typo: "claiment" instead of "claimant"
    plaintiff: raw.claiment || raw.claimant || raw.plaintiff || '-',
    defendant: raw.defendant || '-',
    claimAmount: raw.claim_amount || raw.amount || '-',
    ...hearingFields(raw),
  }
}

function mapJadvalCase(raw: any): CourtCase {
  return {
    caseNumber: raw.casenumber || raw.caseNumber || '-',
    caseType: raw.category || raw.sub_category || '-',
    caseStatus: raw.status_name || raw.instance || '-',
    result: raw.result || '-',
    courtName: raw.court || '-',
    dateFiled: raw.reg_date || '-',
    plaintiff: raw.claimant || raw.claiment || raw.plaintiff || '-',
    defendant: raw.defendant || '-',
    claimAmount: raw.claim_amount || raw.amount || '-',
    ...hearingFields(raw),
  }
}

/**
 * The hearing a list row shows: the next one wherever it sits, including the
 * nested `reviews[]` (appeal, cassation). A case in appeal keeps its old first-instance
 * date at the top level, so reading only that hid an appeal hearing set for today
 * (`core/hearing-pick`). The appeal court differs from the first one, so a review
 * hearing also brings its own court and judge.
 */
function hearingFields(raw: any): Pick<CourtCase, 'hearingDate' | 'hearingTime' | 'judge' | 'hearingStage'> & { courtName?: string } {
  const h = pickHearing(raw)
  if (!h) {
    // no hearing known: the row still names the court and judge of the instance the case is in NOW (a case in appeal is not the first judge's)
    const now = currentInstance(raw)
    return { hearingDate: '', hearingTime: '', judge: now.judge, ...(now.stage !== 'first' && now.court ? { courtName: now.court } : {}) }
  }
  const review = h.stage !== 'first'
  return {
    hearingDate: h.date,
    hearingTime: h.time,
    judge: h.judge, // each instance has its own judge: a review without one shows none, not the first instance's
    hearingStage: h.stage,
    ...(review && h.court ? { courtName: h.court } : {}),
  }
}

/**
 * Get full case details. Calls BOTH jadvalapi.sud.uz and jadval.sud.uz and
 * merges the richest data from each.
 */
export async function getCaseDetails(courtType: CourtType, caseNumber: string): Promise<FullCaseData> {
  return (await getCaseBundle(courtType, caseNumber)).data
}

/**
 * The case's full detail AND its list row, from the same two answers (so refreshing ONE case costs the two single-case calls and
 * nothing more). `row` is the row jadvalapi's list would have shown for it (null when only jadval.sud.uz answered): the store puts it into
 * the company's stored list.
 */
export async function getCaseBundle(
  courtType: CourtType,
  caseNumber: string,
): Promise<{ data: FullCaseData; row: CourtCase | null }> {
  // defence in depth (the route checks too): the number is spliced into upstream URL paths
  if (!CASE_NUMBER_RE.test(caseNumber)) throw new Error('Ish raqami formati: X-XXXX-XXXX/XXXXX')
  const encodedNumber = caseNumber.replace('/', '@')
  const courtTypeUpper = courtType.toUpperCase()

  console.log(`[court-case] fetching details for ${caseNumber}`)

  // Call both APIs in parallel
  const [jadvalApiData, jadvalData] = await Promise.all([
    fetchJadvalApiDetails(courtTypeUpper, encodedNumber),
    fetchJadvalDetails(courtType, encodedNumber),
  ])

  return buildCaseBundle(courtType, caseNumber, jadvalApiData, jadvalData)
}

// ---- the lean lookup of ONE case by number, for the bulk fill (lib/bill-cases) ----

export type CaseLean =
  | { kind: 'found'; data: FullCaseData; row: CourtCase | null; via: 'new' | 'old' }
  /** neither system has a case with this number (the new one answers 400 for what only the old one holds) */
  | { kind: 'absent' }
  /** the answer could not be had (transport, HTTP 5xx / 429 / 403, unreadable): says nothing about the case */
  | { kind: 'error'; message: string }

type Probe = { kind: 'ok'; rows: any[] } | { kind: 'absent' } | { kind: 'error'; message: string }

const PROBE_HEADERS = { Accept: 'application/json, text/plain, */*', Origin: 'https://my.sud.uz', Referer: 'https://my.sud.uz/' }
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

async function probeJadvalApi(apiType: string, encodedNumber: string): Promise<Probe> {
  try {
    const res = await fetchViaWorkers(`${JADVALAPI}/online-monitoring/${apiType}/findByNumber/${encodedNumber}`, {
      originKey: 'jadvalapi.sud.uz', timeoutMs: 15_000, hedgeMs: 4_000, maxAttempts: 2, headers: PROBE_HEADERS,
    })
    // 400 «Bad Request» is how the NEW system answers a number only the OLD one holds (2021-2022 cases): a definitive «not here», not an error
    if (res.status === 400 || res.status === 404 || res.status === 410) return { kind: 'absent' }
    if (!res.ok) return { kind: 'error', message: `jadvalapi HTTP ${res.status}` }
    const text = await res.text()
    if (text.includes('топилмади')) return { kind: 'absent' }
    const data = JSON.parse(text)
    if (data && !Array.isArray(data) && typeof data === 'object' && data.message && data.statusCode) return data.statusCode === 400 || data.statusCode === 404 ? { kind: 'absent' } : { kind: 'error', message: `jadvalapi ${data.statusCode}` }
    const rows = Array.isArray(data) ? data : [data]
    return rows.length ? { kind: 'ok', rows } : { kind: 'absent' }
  } catch (e) {
    return { kind: 'error', message: errMsg(e) }
  }
}

async function probeJadval(courtType: CourtType, encodedNumber: string): Promise<Probe> {
  const finder = { economic: 'findByNumber', civil: 'findByCivilNumber', criminal: 'findByCriminalNumber', administrative: 'findByAdmNumber' }[courtType]
  try {
    const res = await fetchViaWorkers(`${JADVAL_API}/case/${finder}/${encodedNumber}`, {
      originKey: 'jadval.sud.uz', timeoutMs: 20_000, hedgeMs: 5_000, maxAttempts: 2, headers: PROBE_HEADERS,
    })
    if (!res.ok) return { kind: 'error', message: `jadval HTTP ${res.status}` }
    const text = await res.text()
    // that site's flaky node answers «not found» to a case that exists, so the caller asks twice before it believes this
    if (isFakeEmptyText(text)) return { kind: 'absent' }
    const data = JSON.parse(text)
    if (!data || (typeof data === 'object' && !Array.isArray(data) && data.message && data.statusCode)) return { kind: 'absent' }
    const rows = Array.isArray(data) ? data : [data]
    return rows.length ? { kind: 'ok', rows } : { kind: 'absent' }
  } catch (e) {
    return { kind: 'error', message: errMsg(e) }
  }
}

const apiTypeOf = (c: CourtType): string => ({ economic: 'ECONOMIC', civil: 'CIVIL', administrative: 'CONFLICT', criminal: 'CRIMINAL' })[c]

/**
 * ONE case by its number with the fewest requests: the new system (jadvalapi) first, ~1 s, no known rate limit; only a number it answers
 * «400» for goes to the OLD system (jadval.sud.uz), whose search service is the one with a per-IP / per-TIN token bucket, and it is asked
 * TWICE (`recheckMs` apart) before «not found» is believed. The bulk fill used `getCaseBundle`, which asks both systems for every case.
 */
export async function getCaseLean(courtType: CourtType, caseNumber: string, opts: { recheckMs?: number } = {}): Promise<CaseLean> {
  if (!CASE_NUMBER_RE.test(caseNumber)) return { kind: 'error', message: 'Ish raqami formati notoʻgʻri' }
  const encoded = caseNumber.replace('/', '@')
  const api = await probeJadvalApi(apiTypeOf(courtType), encoded)
  if (api.kind === 'error') return api
  if (api.kind === 'ok') return { kind: 'found', via: 'new', ...buildCaseBundle(courtType, caseNumber, api.rows, null) }
  for (let attempt = 0; attempt < 2; attempt++) {
    const old = await probeJadval(courtType, encoded)
    if (old.kind === 'error') return old
    if (old.kind === 'ok') return { kind: 'found', via: 'old', ...buildCaseBundle(courtType, caseNumber, null, old.rows) }
    if (attempt === 0) await new Promise((r) => setTimeout(r, opts.recheckMs ?? 4_000))
  }
  return { kind: 'absent' }
}

/** What a case's detail and list row are made of, from the two sources' answers (either may be null). Pure; the callers fetch. */
function buildCaseBundle(
  courtType: CourtType,
  caseNumber: string,
  jadvalApiData: any[] | null,
  jadvalData: any[] | null,
): { data: FullCaseData; row: CourtCase | null } {
  // Prefer jadval.sud.uz for BOTH parties and hearings — it returns the real
  // hearing_date / hearing_time / responsible (judge) fields per case, whereas
  // jadvalapi's findByNumber returns 400 for most court types.
  const raw = jadvalData?.[0] || jadvalApiData?.[0]
  if (!raw) {
    return { data: { general: null, firstInstance: null, appellate: null, cassation: null, inspection: null }, row: null }
  }

  const detailRaw = jadvalData?.[0] || jadvalApiData?.[0]
  // Hearings: prefer jadval.sud.uz (has hearing_date/hearing_time/responsible).
  // Fall back to jadvalapi only when jadval.sud.uz returned nothing.
  const hearingsRaw = jadvalData?.length ? jadvalData : (jadvalApiData || [])

  // every hearing row belongs to ONE instance: a row of jadval.sud.uz can itself be an appeal / cassation / taftish row, and its judge is
  // that instance's judge, so the rows are sorted by their own `instance` and never all counted as the first instance's
  const toHearing = (h: any) => ({
    date: h.hearing_date || '',
    time: h.hearing_time || '',
    status: h.status_name || h.instance || '',
    postponementReason: h.postpone_reason || '',
    courtroom: h.courtroom || '',
    judge: h.responsible || '',
  })
  // Drop phantom hearing entries where every key field is empty (the API sometimes returns a bare {message, statusCode} object on
  // errors, or a case row with no scheduled hearing yet); normalise empty strings back to '-' for display consistency.
  const clean = (h: ReturnType<typeof toHearing>) =>
    h.date || h.time || h.judge || h.status || h.courtroom
      ? { ...h, date: h.date || '-', time: h.time || '-', status: h.status || '-', judge: h.judge || '-' }
      : null
  const rowsOf = (stage: HearingStage) => hearingsRaw.filter((h: any) => stageOfRow(h) === stage)
  // the first instance's hearings: this row's, plus the EARLIER first-instance proceedings of the same case number that the API nests in
  // `reviews[]` (a case that was sent back is heard again as a new proceeding)
  const seenHearing = new Set<string>()
  const hearings = [...rowsOf('first'), ...reviewsOf(raw, 'first')]
    .map(toHearing)
    .map(clean)
    .filter((h): h is NonNullable<ReturnType<typeof clean>> => {
      if (!h) return false
      const k = `${h.date}|${h.time}|${h.judge}`
      if (seenHearing.has(k)) return false
      seenHearing.add(k)
      return true
    }) as Hearing[]

  const d = detailRaw || raw
  const now = currentInstance(d) // the court and the judge of the instance the case is in now, not of the first one
  // the result: this row's, else the latest earlier first-instance proceeding's
  const earlierResult = [...reviewsOf(raw, 'first')].reverse().map((r: any) => r.result).find((x: any) => x && x !== '—' && x !== '-')
  const decisionText = stageOfRow(d) === 'first' ? d.result || d.article || earlierResult || '' : earlierResult || ''
  const data: FullCaseData = {
    general: {
      caseNumber: d.casenumber || d.caseNumber || caseNumber,
      caseType: d.category || '-',
      caseStatus: d.status_name || d.instance || '-',
      court: now.court || d.court || '-',
      judge: now.judge || '-',
      currentInstance: now.stage,
      region: String(d.region || ''),
      secretary: '-',
      plaintiff: d.claiment || d.claimant || d.plaintiff || '-',
      plaintiffTin: '-',
      defendant: d.defendant || '-',
      defendantTin: '-',
      thirdParty: '-',
      claimSubject: d.sub_category || d.category || '-',
      claimAmount: d.claim_amount || d.amount || '-',
      applicationDate: d.reg_date || '-',
      initiatedDate: d.reg_date || '-',
      deadlineDate: '-',
      stateDuty: '-',
      representative: d.representing_org || d.representor || '-',
      prosecutor: '-',
    },
    firstInstance: {
      court: stageOfRow(d) === 'first' ? String(d.court || '') : undefined,
      judge: stageOfRow(d) === 'first' ? String(d.responsible || '') : undefined,
      hearings,
      decision: decisionText ? {
        date: d.reg_date || '-',
        text: d.result || '-',
        type: d.result || '-',
        awardedAmount: '-',
        stateDutyRecovered: '-',
        enforcedDate: '-',
        appealDeadline: '-',
      } : null,
      documents: [],
    },
    appellate: parseReviewInstance(raw, hearingsRaw, 'appeal'),
    cassation: parseReviewInstance(raw, hearingsRaw, 'cassation'),
    inspection: parseReviewInstance(raw, hearingsRaw, 'inspection'),
  }
  return { data, row: jadvalApiData?.[0] ? mapJadvalApiCase(jadvalApiData[0]) : null }
}

/**
 * One review instance (appeal, cassation or taftish) of a case. Its data comes from the nested `reviews[]` entry of that kind (the latest one when
 * there are several, e.g. a repeated cassation) and from any row of jadval.sud.uz that is itself an entry of that instance. The `instance` text is
 * Cyrillic-Uzbek («Апелляция инстанцияси», «Кассация…», «Тафтиш…»); `stageOfInstance` also knows the Latin spellings. Court and judge are
 * THIS instance's own: an instance without a judge yet has none, it never borrows the first instance's.
 */
function parseReviewInstance(raw: any, rows: any[], stage: Exclude<HearingStage, 'first'>): InstanceData | null {
  // EVERY proceeding of this kind, oldest first: a case can have several appeals, a cassation AND a repeated cassation («Такрорий кассация»),
  // each its own entry with its own hearing, judge and result
  const nested = reviewsOf(raw ?? {}, stage)
  const own = rows.filter((r: any) => stageOfRow(r) === stage)
  const sources = [...nested, ...own] as any[]
  if (!sources.length) return null

  const hearings = sources
    .map((r) => ({
      date: r.hearing_date || '-',
      time: r.hearing_time || '-',
      status: r.status_name || r.instance || '-',
      postponementReason: r.postpone_reason || '',
      courtroom: r.courtroom || '',
      judge: r.responsible || r.judge || '-',
    }))
    .filter((h) => h.date !== '-' || h.time !== '-' || h.judge !== '-' || h.courtroom)

  // the latest proceeding that has a result is the decision of this instance
  const withResult = [...sources].reverse().find((r) => r.result && r.result !== '—' && r.result !== '-')
  const decision = withResult
    ? {
        date: withResult.reg_date || '-',
        text: withResult.result || '-',
        type: withResult.result || '-',
        awardedAmount: '-',
        stateDutyRecovered: '-',
        enforcedDate: '-',
        appealDeadline: '-',
      }
    : null

  const head = sources[sources.length - 1] // the latest proceeding names the court and judge
  return {
    court: String(head.court || ''),
    judge: String(head.responsible || head.judge || ''),
    repeated: sources.some((r) => /такрорий|takroriy/i.test(String(r.instance || ''))),
    hearings,
    decision,
    documents: [],
    appellant: head.claiment || head.claimant || undefined,
  }
}

async function fetchJadvalApiDetails(courtTypeUpper: string, encodedNumber: string): Promise<any[] | null> {
  // Map court types to jadvalapi's expected names:
  // economic → ECONOMIC, civil → CIVIL, administrative → CONFLICT, criminal → not supported
  const apiTypeMap: Record<string, string> = {
    ECONOMIC: 'ECONOMIC',
    CIVIL: 'CIVIL',
    ADMINISTRATIVE: 'CONFLICT',
    CRIMINAL: 'CRIMINAL',
  }
  const apiType = apiTypeMap[courtTypeUpper] || ''
  if (!apiType) return null

  const url = `${JADVALAPI}/online-monitoring/${apiType}/findByNumber/${encodedNumber}`
  // v206: routed through the shared hedged scheduler (was round-robin single worker)
  try {
    const res = await fetchViaWorkers(url, {
      originKey: 'jadvalapi.sud.uz',
      timeoutMs: 8_000,
      hedgeMs: 800,
      maxAttempts: 2,
      headers: { Accept: 'application/json, text/plain, */*', 'Origin': 'https://my.sud.uz', 'Referer': 'https://my.sud.uz/' },
    })
    // Guard against non-200 responses — jadvalapi returns 400 Bad Request for
    // most court types' findByNumber, and the body `{message, statusCode}` must
    // NOT be treated as a valid hearings array (it would produce phantom '—' rows).
    if (!res.ok) {
      console.log(`[court-case] jadvalapi details HTTP ${res.status} for ${url}`)
      return null
    }
    const text = await res.text()
    if (text === 'Иш топилмади' || text.includes('топилмади')) return null
    const data = JSON.parse(text)
    if (!data || (typeof data === 'object' && !Array.isArray(data) && data.message && data.statusCode)) {
      return null
    }
    return Array.isArray(data) ? data : [data]
  } catch (e) {
    console.log(`[court-case] jadvalapi details failed: ${e instanceof Error ? e.message : e}`)
    return null
  }
}

async function fetchJadvalDetails(courtType: CourtType, encodedNumber: string): Promise<any[] | null> {
  // Map court type to jadval.sud.uz endpoint
  let endpoint = ''
  if (courtType === 'economic') endpoint = `${JADVAL_API}/case/findByNumber/${encodedNumber}`
  else if (courtType === 'civil') endpoint = `${JADVAL_API}/case/findByCivilNumber/${encodedNumber}`
  else if (courtType === 'criminal') endpoint = `${JADVAL_API}/case/findByCriminalNumber/${encodedNumber}`
  else if (courtType === 'administrative') endpoint = `${JADVAL_API}/case/findByAdmNumber/${encodedNumber}`
  else return null

  // v206: routed through the shared hedged scheduler (was round-robin single worker)
  // v207: jadval.sud.uz is the flaky LB pool (see searchCourtCasesInternal) —
  // 8s killed slow-good node answers; one scheduler pass + one curl retry.
  try {
    const res = await fetchViaWorkers(endpoint, {
      originKey: 'jadval.sud.uz',
      timeoutMs: 20_000,
      hedgeMs: 800,
      maxAttempts: 2,
      headers: { Accept: 'application/json, text/plain, */*', 'Origin': 'https://my.sud.uz', 'Referer': 'https://my.sud.uz/' },
    })
    if (!res.ok) {
      console.log(`[court-case] jadval details HTTP ${res.status} for ${endpoint}`)
    } else {
      const text = await res.text()
      if (!isFakeEmptyText(text)) {
        const data = JSON.parse(text)
        if (!data || (typeof data === 'object' && !Array.isArray(data) && data.message && data.statusCode)) {
          return null
        }
        return Array.isArray(data) ? data : [data]
      }
      console.log(`[court-case] jadval details fake-empty from flaky node for ${endpoint}`)
    }
  } catch (e) {
    console.log(`[court-case] jadval details failed: ${e instanceof Error ? e.message : e}`)
  }
  // v207: one direct-curl retry — pinned to the sibling machine so it samples
  // a different throttle bucket than the worker pass.
  try {
    const text = await curlFetch(endpoint, JADVAL_ALT_IP || undefined)
    if (isFakeEmptyText(text)) return null
    const data = JSON.parse(text)
    return Array.isArray(data) ? data : [data]
  } catch (e2) {
    console.log(`[court-case] jadval details curl retry failed: ${e2 instanceof Error ? e2.message : e2}`)
    return null
  }
}

// ---- Captcha (kept for compatibility but NOT needed for jadval APIs) ----
// The jadval.sud.uz and jadvalapi.sud.uz endpoints are public — no captcha needed.
// This is kept in case future endpoints require it.

const MYSUD_SITE_KEY = 'site_835080654e60bd9283ac263c5ebbaaef'
const CAPTCHA_API = 'https://recaptcha.sud.uz'

export async function getCaptchaTokenMySud(): Promise<string> {
  // Not needed — jadval APIs are public
  return 'not-required'
}
