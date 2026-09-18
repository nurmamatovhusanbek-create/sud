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
import { fetchViaWorkers } from './net/worker-fetch'

// ---- Types (re-exported from court-case-types.ts) ----
export type { CourtType, SearchMode, CourtCase, CaseDetail, Hearing, Decision, CaseDocument, InstanceData, FullCaseData } from './court-case-types'
import type { CourtType, SearchMode, CourtCase, FullCaseData, InstanceData } from './court-case-types'

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
interface CourtCaseCacheEntry {
  result: Promise<{ cases: CourtCase[]; incomplete: boolean }>
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
): Promise<{ cases: CourtCase[]; incomplete: boolean }> {
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
): Promise<{ cases: CourtCase[]; incomplete: boolean }> {
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
): Promise<{ cases: CourtCase[]; incomplete: boolean }> {
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
      if (!isJadvalSudUz) return { items: [] as CourtCase[], failed: true }
      for (let i = 0; i < ladderIps.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 6_000))
        try {
          return { items: await curlFetchCases(url, mapper, ladderIps[i]), failed: false }
        } catch { /* throttled/bad node — next sample */ }
      }
      return { items: [] as CourtCase[], failed: true }
    }

    try {
      const res = await fetchViaWorkers(url, {
        originKey: origin,
        // v207: jadval real searches measured at 1.8-21s — 12s killed winners;
        // 20s + curl fallback covers the tail without stalling the request.
        timeoutMs: isJadvalSudUz ? 20_000 : 12_000,
        hedgeMs: 800,
        // v207: per-TIN token bucket — 2 worker samples, not 3.
        maxAttempts: 2,
      })
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
        return { items: [] as CourtCase[], failed: true }
      }
      const text = await res.text()
      // v207: fake-empty from a bad LB node is a retryable glitch, NOT a
      // definitive answer — a fast response here is almost always fake.
      if (isFakeEmptyText(text)) {
        console.log(`[court-case] ${origin} — fake-empty from flaky node, trying curl ladder`)
        if (isJadvalSudUz) return await curlLadder()
        return { items: [] as CourtCase[], failed: true }
      }
      const data = JSON.parse(text)
      const items = (Array.isArray(data) ? data : (data.data || [])).map(mapper)
      console.log(`[court-case] ${origin} — got ${items.length} cases via scheduler`)
      return { items, failed: false }
    } catch {
      // All workers failed at transport level → jadval.sud.uz gets the curl
      // ladder (its TLS bypass + LB roulette sampling), everything else marks
      // the endpoint incomplete (honesty invariant — v153).
      if (isJadvalSudUz) return await curlLadder()
      console.log(`[court-case] ${url} — all worker attempts failed, marking as incomplete`)
      return { items: [] as CourtCase[], failed: true }
    }
  })

  const results = await Promise.all(promises)
  // Merge and deduplicate by case number
  const merged: CourtCase[] = []
  const seen = new Set<string>()
  let incomplete = false
  for (const { items, failed } of results) {
    if (failed) incomplete = true
    for (const item of items) {
      if (item.caseNumber && !seen.has(item.caseNumber)) {
        seen.add(item.caseNumber)
        merged.push(item)
      }
    }
  }

  console.log(`[court-case] found ${merged.length} cases${incomplete ? ' — INCOMPLETE: one or more sources failed' : ''}`)
  return { cases: merged, incomplete }
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
    hearingDate: raw.hearing_date || '',
    hearingTime: raw.hearing_time || '',
    judge: raw.responsible || '',
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
    hearingDate: raw.hearing_date || '',
    hearingTime: raw.hearing_time || '',
    judge: raw.responsible || '',
  }
}

/**
 * Get full case details. Calls BOTH jadvalapi.sud.uz and jadval.sud.uz and
 * merges the richest data from each.
 */
export async function getCaseDetails(
  courtType: CourtType,
  caseNumber: string,
): Promise<FullCaseData> {
  const encodedNumber = caseNumber.replace('/', '@')
  const courtTypeUpper = courtType.toUpperCase()

  console.log(`[court-case] fetching details for ${caseNumber}`)

  // Call both APIs in parallel
  const [jadvalApiData, jadvalData] = await Promise.all([
    fetchJadvalApiDetails(courtTypeUpper, encodedNumber),
    fetchJadvalDetails(courtType, encodedNumber),
  ])

  // Prefer jadval.sud.uz for BOTH parties and hearings — it returns the real
  // hearing_date / hearing_time / responsible (judge) fields per case, whereas
  // jadvalapi's findByNumber returns 400 for most court types.
  const raw = jadvalData?.[0] || jadvalApiData?.[0]
  if (!raw) {
    return { general: null, firstInstance: null, appellate: null, cassation: null }
  }

  const detailRaw = jadvalData?.[0] || jadvalApiData?.[0]
  // Hearings: prefer jadval.sud.uz (has hearing_date/hearing_time/responsible).
  // Fall back to jadvalapi only when jadval.sud.uz returned nothing.
  const hearingsRaw = jadvalData?.length ? jadvalData : (jadvalApiData || [])

  const hearings = hearingsRaw
    .map((h: any) => ({
      date: h.hearing_date || '',
      time: h.hearing_time || '',
      status: h.status_name || h.instance || '',
      postponementReason: h.postpone_reason || '',
      courtroom: h.courtroom || '',
      judge: h.responsible || '',
    }))
    // Drop phantom hearing entries where every key field is empty (the API
    // sometimes returns a bare {message, statusCode} object on errors, or a
    // case row with no scheduled hearing yet).
    .filter(
      (h: any) =>
        h.date || h.time || h.judge || h.status || h.courtroom,
    )
    // Normalise empty strings back to '—' for display consistency.
    .map((h: any) => ({
      date: h.date || '-',
      time: h.time || '-',
      status: h.status || '-',
      postponementReason: h.postponementReason,
      courtroom: h.courtroom,
      judge: h.judge || '-',
    }))

  const d = detailRaw || raw
  const decisionText = d.result || d.article || ''
  return {
    general: {
      caseNumber: d.casenumber || d.caseNumber || caseNumber,
      caseType: d.category || '-',
      caseStatus: d.status_name || d.instance || '-',
      court: d.court || '-',
      judge: d.responsible || '-',
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
    appellate: parseReviewInstance(raw, 'апелляция'),
    cassation: parseReviewInstance(raw, 'кассация'),
  }
}

/**
 * Parse a review entry from the API response as an appeal or cassation instance.
 * The jadvalapi findByNumber response includes a `reviews` array that contains
 * appeal/cassation instances. Each review has an `instance` field whose value
 * is the Cyrillic-Uzbek phrase "Apellyatsiya instansiyasi" or "Kassatsiya
 * instansiyasi" (written in Cyrillic in the API response). We match on the
 * Cyrillic lowercase fragments "apellyatsiya" / "kassatsiya" — those are the
 * only forms the API ever emits, so no Latin fallback is needed here.
 */
function parseReviewInstance(raw: any, type: 'апелляция' | 'кассация'): InstanceData | null {
  const reviews = raw?.reviews
  if (!Array.isArray(reviews) || reviews.length === 0) return null

  // Find the review matching this instance type
  const review = reviews.find((r: any) => {
    const inst = (r.instance || '').toLowerCase()
    return inst.includes(type)
  })
  if (!review) return null

  const reviewHearings = [
    {
      date: review.hearing_date || '-',
      time: review.hearing_time || '-',
      status: review.status_name || review.instance || '-',
      postponementReason: review.postpone_reason || '',
      courtroom: review.courtroom || '',
      judge: review.responsible || '-',
    },
  ]

  const reviewDecision = review.result && review.result !== '—' && review.result !== '-' ? {
    date: review.reg_date || '-',
    text: review.result || '-',
    type: review.result || '-',
    awardedAmount: '-',
    stateDutyRecovered: '-',
    enforcedDate: '-',
    appealDeadline: '-',
  } : null

  return {
    hearings: reviewHearings,
    decision: reviewDecision,
    documents: [],
    appellant: review.claiment || review.claimant || undefined,
  }
}

async function fetchJadvalApiDetails(courtTypeUpper: string, encodedNumber: string): Promise<any[] | null> {
  // Map court types to jadvalapi's expected names:
  // economic → ECONOMIC, civil → CIVIL, administrative → CONFLICT, criminal → not supported
  const apiTypeMap: Record<string, string> = {
    ECONOMIC: 'ECONOMIC',
    CIVIL: 'CIVIL',
    ADMINISTRATIVE: 'CONFLICT',
    CRIMINAL: '', // jadvalapi doesn't support criminal — skip
  }
  const apiType = apiTypeMap[courtTypeUpper] || ''
  if (!apiType) return null // Criminal cases are only on jadval.sud.uz

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
