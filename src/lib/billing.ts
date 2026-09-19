import crypto from 'crypto'
import ZAI from 'z-ai-web-dev-sdk'

/**
 * Sud Billing (billing.sud.uz) integration service.
 *
 * Reverse-engineered flow:
 *  1. Get a proof-of-work challenge from recaptcha.sud.uz
 *  2. Solve the PoW (SHA-256 leading-zero-bits)
 *  3. Call /analyze with browser-like signals -> returns a token (sometimes a math
 *     captcha image challenge is required, which we solve with the VLM)
 *  4. Use the token to call /api/invoice/captcha/search?inn=...  (Yuridik shaxs path)
 *  5. For every returned bill, call /api/invoice/checkStatus to enrich it with amount,
 *     paid amount, court, payment category (davlat boji / pochta) and the court case
 *     numbers it was used for.
 */

const SITE_KEY = 'site_bbdb0625df8a200e73f37ebccf0c62ac'
const CAPTCHA_API = 'https://recaptcha.sud.uz'
const BILLING_API = 'https://billing.sud.uz'

// v204 (P-A): billing no longer carries its own worker list or resolver.
// v206 (rate-limit fix): billing no longer carries its own ProxyPool either —
// every request below (PoW/captcha POSTs, search, per-bill checkStatus) goes
// through the shared hedged scheduler in net/worker-fetch, so the 60-receipt
// enrichment queues under the shared per-origin cap + spacing for
// billing.sud.uz instead of stampeding it. That shared cap is exactly what
// stops the rate-limit wall.
import { fetchViaWorkers } from './net/worker-fetch'

/**
 * billing.sud.uz sits behind its own Cloudflare and blocks many IPs
 * (including Tor exit nodes), so ALL billing/recaptcha traffic is routed
 * through the operator's CF workers (proxy.js forwards method + body).
 * The scheduler adds: health-ordered worker selection, hedged escalation,
 * per-worker (NET_PER_WORKER_MAX) and per-origin (NET_PER_ORIGIN_MAX)
 * concurrency caps plus minimum origin spacing (NET_ORIGIN_SPACING_MS).
 */

// ---- Types -------------------------------------------------------------

/**
 * Types + pure formatting helpers MOVED to src/core/billing-format.ts (P1 core
 * extraction: the client needs them without importing this server-only module,
 * and core must be the single source of truth). Re-exported here so every
 * existing consumer keeps working — zero behavior change.
 */
export type { InvoiceStatus, BillListItem, HistoryEntry, CheckStatusResponse, SearchResponse, EnrichedBill, BillSummary } from '@/core/billing-format'
export {
  COURT_TYPES,
  courtTypeLabel,
  INVOICE_STATUSES,
  statusLabel,
  paymentBucket,
  categoryLabel,
  tiyinsToSum,
  formatSum,
  formatDate,
  summarizeBills,
} from '@/core/billing-format'
import type { BillListItem, CheckStatusResponse, SearchResponse, EnrichedBill } from '@/core/billing-format'

// ---- Captcha (PoW + analyze + VLM math fallback) -----------------------

function countLeadingZeroBits(buf: Buffer): number {
  let count = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) {
      count += 8
    } else {
      let byte = buf[i]
      while ((byte & 0x80) === 0) {
        count++
        byte <<= 1
      }
      break
    }
  }
  return count
}

function solvePow(challenge: string, difficulty: number): { nonce: string; solveTimeMs: number } {
  let nonce = 0
  const start = Date.now()
  while (true) {
    const hash = crypto.createHash('sha256').update(challenge + nonce.toString()).digest()
    if (countLeadingZeroBits(hash) >= difficulty) {
      return { nonce: nonce.toString(), solveTimeMs: Date.now() - start }
    }
    nonce++
    if (nonce % 200000 === 0 && Date.now() - start > 10000) {
      throw new Error('PoW solver timeout')
    }
  }
}

let zaiPromise: Promise<unknown> | null = null
async function getZai() {
  if (!zaiPromise) zaiPromise = ZAI.create()
  return zaiPromise as Promise<Awaited<ReturnType<typeof ZAI.create>>>
}

/** Read a math captcha image and return the numeric answer. */
async function solveMathImage(imageBase64: string): Promise<number> {
  const zai = await getZai()
  // P0 type-hardening: the SDK's current typings require a `model` field the
  // runtime does not need (server injects the default). Type-only cast — the
  // request body is byte-identical to the shipped behavior.
  const visionBody = {
    messages: [
      {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: 'This image shows a simple arithmetic problem (addition, subtraction, multiplication or division of integers). Read the expression and calculate the result. Reply with ONLY the integer result, no words, no explanation. For example if the image shows "12 + 7 =" reply "19".',
          },
          {
            type: 'image_url' as const,
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
        ],
      },
    ],
    thinking: { type: 'disabled' as const },
  } as unknown as Parameters<typeof zai.chat.completions.createVision>[0]
  const resp = await zai.chat.completions.createVision(visionBody)
  const text = resp.choices?.[0]?.message?.content ?? ''
  const match = String(text).match(/-?\d+/)
  if (!match) throw new Error('VLM did not return a number: ' + text)
  return parseInt(match[0], 10)
}

/**
 * Fetch a JSON response with exponential-backoff retries.
 *
 * v206: each attempt goes through the shared hedged scheduler
 * (`fetchViaWorkers`) — health-ordered worker selection + hedge + per-origin
 * caps/spacing for recaptcha.sud.uz and billing.sud.uz. The outer retry loop
 * and backoff profiles stay (captcha: 2 retries, short backoff; billing: 3,
 * longer backoff). POST bodies (PoW/analyze/solve) pass through — the worker
 * proxy.js forwards method + body.
 */
async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  retries = 6,
): Promise<T> {
  const isBillingUrl = url.includes('billing.sud.uz')
  const isCaptchaUrl = url.includes('recaptcha.sud.uz')

  // Captcha API: fewer retries, shorter backoff (it's fast & reliable).
  // Billing API: 3 retries for transient network blips.
  const effectiveRetries = isCaptchaUrl ? Math.min(retries, 2) : Math.min(retries, 3)

  const method = typeof init.method === 'string' ? init.method : 'GET'
  const body = typeof init.body === 'string' ? init.body : undefined
  const headers = (init.headers || {}) as Record<string, string>

  let lastErr: unknown = null
  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    const startTime = Date.now()
    try {
      const res = await fetchViaWorkers(url, {
        originKey: isCaptchaUrl ? 'recaptcha.sud.uz' : 'billing.sud.uz',
        method,
        body,
        headers,
        timeoutMs: isCaptchaUrl ? 10_000 : 8_000,
        hedgeMs: 900,
        maxAttempts: 2,
      })
      const elapsed = Date.now() - startTime
      const label = url.split('/').pop()?.split('?')[0] ?? url
      console.log(`[billing] ${label} attempt ${attempt + 1}: HTTP ${res.status} in ${elapsed}ms (via scheduler)`)

      // 521/522/523 = origin down. The scheduler already hedges to another
      // worker (>=500 counts as a worker/origin failure) — if we still see it,
      // back off and let the outer loop retry.
      if (res.status === 521 || res.status === 522 || res.status === 523) {
        throw new Error(`HTTP ${res.status} (origin down)`)
      }

      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`)
      }
      // 4xx — the server responded, parse the body (billing returns usable JSON on 4xx)
      const parsed = (await res.json()) as T
      // Validate billing search responses: real responses have `content` array.
      // BUT: 422 captcha-fail has requestStatus but no content — that's valid.
      if (isBillingUrl && parsed && typeof parsed === 'object' && !Array.isArray((parsed as any).content)) {
        if (!(parsed as any).requestStatus) {
          throw new Error('Invalid search response')
        }
      }
      return parsed
    } catch (e) {
      const elapsed = Date.now() - startTime
      const msg = e instanceof Error ? e.message : String(e)
      const label = url.split('/').pop()?.split('?')[0] ?? url
      console.error(`[billing] ${label} attempt ${attempt + 1} FAILED after ${elapsed}ms: ${msg}`)

      lastErr = e
      if (attempt < effectiveRetries) {
        const delay = isCaptchaUrl
          ? 500 + attempt * 1000 + Math.random() * 200
          : Math.min(500 * Math.pow(1.5, attempt) + Math.random() * 200, 2000)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`fetch failed: ${url}`)
}

class HttpError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function buildSignals(attempt: number) {
  const now = Date.now()
  return {
    mouse: {
      moveCount: 35 + attempt * 7,
      speeds: [0.42, 0.61, 0.33],
      clickCount: 2 + attempt,
      points: [
        { x: 120, y: 220 },
        { x: 140, y: 230 },
        { x: 160, y: 235 },
      ],
      lastX: 160,
      lastY: 235,
      lastTime: now,
    },
    keyboard: {
      keyCount: 9 + attempt,
      backspaceCount: attempt % 2,
      timing: [120, 95, 140, 110, 88],
    },
    scroll: { scrollCount: 1 + attempt, maxScrollY: 320 + attempt * 40 },
    touch: { touchCount: 0 },
    timing: { pageLoadTime: 1450 + attempt * 60, domReadyTime: 820 + attempt * 30 },
    fingerprint: {
      canvas: 'a4f2c9' + attempt,
      webgl: 'ANGLE Intel',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    botFlags: { webdriver: false, headless: false, phantom: false, selenium: false },
    honeypotFilled: false,
  }
}

/**
 * Obtain a captcha token. We retry the analyze call a few times because the
 * risk-score is non-deterministic and sometimes returns a token directly
 * (score >= ~0.5). When a math challenge is unavoidable, the VLM solves it.
 */
/** Progress phases streamed to the UI so users know what the app is doing. */
export type Phase =
  | 'connecting'      // connecting to billing.sud.uz via Tor
  | 'captcha_pow'     // solving proof-of-work challenge
  | 'captcha_analyze' // sending signals for risk analysis
  | 'captcha_math'    // solving the math image captcha with VLM
  | 'searching'       // searching bills by INN
  | 'enriching'       // fetching detailed status for each bill
  | 'done'

export type PhaseCallback = (phase: Phase, detail?: string) => void

export async function getCaptchaToken(
  maxAttempts = 3,
  onPhase?: PhaseCallback,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 1. PoW challenge
    onPhase?.('captcha_pow', attempt === 0 ? 'Solving proof-of-work challenge…' : `Retrying PoW (attempt ${attempt + 1})…`)
    const pow = await fetchJsonWithRetry<{
      challenge: string
      difficulty: number
      algorithm: string
      expiresAt: string
    }>(
      `${CAPTCHA_API}/api/v1/captcha/pow/challenge`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteKey: SITE_KEY }),
      },
      3,
    )

    // 2. Solve PoW
    const solved = solvePow(pow.challenge, pow.difficulty)

    // 3. Analyze
    onPhase?.('captcha_analyze', 'Analyzing risk score…')
    const analyze = await fetchJsonWithRetry<{
      token: string | null
      score: number
      challengeRequired: boolean
      challenge?: { id: string; type: string; imageBase64: string; expiresAt: string }
    }>(
      `${CAPTCHA_API}/api/v1/captcha/analyze`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteKey: SITE_KEY,
          action: 'my_checks',
          timestamp: Date.now(),
          signals: {
            ...buildSignals(attempt),
            pow: {
              challenge: pow.challenge,
              nonce: solved.nonce,
              solveTimeMs: solved.solveTimeMs,
              solved: true,
            },
          },
        }),
      },
      3,
    )

    console.log(`[captcha] analyze result: score=${analyze.score}, challengeRequired=${analyze.challengeRequired}, hasToken=${!!analyze.token}, hasChallenge=${!!analyze.challenge}`)

    if (!analyze.challengeRequired && analyze.token) {
      console.log('[captcha] got token directly (score high enough)')
      return analyze.token
    }

    // 4. Math challenge - solve with VLM, then submit
    if (analyze.challengeRequired && analyze.challenge) {
      console.log('[captcha] math challenge required - solving with VLM…')
      onPhase?.('captcha_math', `Solving math captcha (score was ${analyze.score})…`)
      try {
        const answer = await solveMathImage(analyze.challenge.imageBase64)
        const solveStart = Date.now()
        const result = await fetchJsonWithRetry<{
          success: boolean
          token?: string
          attemptsRemaining?: number
          challenge?: { id: string; imageBase64: string }
        }>(
          `${CAPTCHA_API}/api/v1/captcha/challenge/solve`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              challengeId: analyze.challenge.id,
              answer,
              solveTimeMs: Date.now() - solveStart,
              siteKey: SITE_KEY,
            }),
          },
          3,
        )
        if (result.success && result.token) return result.token
      } catch (e) {
        // v161: Vision API (internal-api.z.ai) may not be accessible from all
        // networks. Log the error clearly but don't crash — the billing search
        // can still succeed if the captcha score was high enough (no challenge
        // needed). The error falls through to the next attempt.
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('ConnectionRefused') || msg.includes('Unable to connect')) {
          console.error('[captcha] Vision API isqib bo\'lmadi (internal-api.z.ai). Matematika captchasini yechish o\'tkazib yuborildi.')
        } else {
          console.error(`[captcha] math challenge error: ${msg.slice(0, 150)}`)
        }
        // fall through to next attempt
      }
    }

    await new Promise((r) => setTimeout(r, 400 + attempt * 150))
  }
  throw new Error('Failed to obtain captcha token after ' + maxAttempts + ' attempts')
}

// ---- Billing API -------------------------------------------------------

/**
 * Search all bills for a legal entity (Yuridik shaxs) by INN.
 *
 * The captcha token can be silently rejected (server returns HTTP 200 with an
 * empty result set instead of an error), and it expires after ~120s. So when
 * the first search returns 0 results we retry with a freshly-minted token -
 * up to 3 attempts total.
 */
export async function searchBillsByInn(
  inn: string,
  opts: { page?: number; size?: number; onPhase?: PhaseCallback } = {},
): Promise<SearchResponse> {
  const page = opts.page ?? 0
  const size = opts.size ?? 100
  const onPhase = opts.onPhase

  // Generate ONE captcha token, then retry the search with it.
  // On 521 (origin down): retry the SEARCH with the SAME token — don't waste
  // time regenerating the captcha (the captcha succeeded, the origin is just down).
  // On 422 (captcha rejected) or empty results: regenerate the captcha token.
  const MAX_TOKEN_ATTEMPTS = 3 // regenerate captcha up to 3 times
  const MAX_SEARCH_RETRIES = 3 // retry search with same token up to 6 times (for 521)

  let lastErr: unknown = null
  for (let tokenAttempt = 0; tokenAttempt < MAX_TOKEN_ATTEMPTS; tokenAttempt++) {
    onPhase?.('searching', tokenAttempt === 0 ? `STIR ${inn} uchun toʻlovlar qidirilmoqda…` : `Yangi captcha bilan qayta urinilmoqda (${tokenAttempt + 1}-urinish)…`)
    const token = await getCaptchaToken(6, onPhase)
    const params = new URLSearchParams({
      passportNumber: '',
      inn,
      page: String(page),
      size: String(size),
      captchaToken: token,
    })
    const searchUrl = `${BILLING_API}/api/invoice/captcha/search?${params.toString()}`
    const searchHeaders = {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Referer: `${BILLING_API}/my-checks`,
    }

    // Retry the search with the SAME token (for 521 origin-down errors).
    // Don't regenerate captcha — the token is valid, the origin is just flaky.
    for (let searchRetry = 0; searchRetry < MAX_SEARCH_RETRIES; searchRetry++) {
      try {
        const result = await fetchJsonWithRetry<SearchResponse>(
          searchUrl,
          { headers: searchHeaders },
          3, // fewer internal retries (fetchJsonWithRetry handles 521 rotation)
        )
        // If we got results, return them.
        if (result.totalElements > 0) {
          return result
        }
        // Empty result — the token may have been rejected (422 turned into
        // empty by the server). Break to regenerate captcha.
        if (tokenAttempt < MAX_TOKEN_ATTEMPTS - 1) {
          console.log(`[billing] search returned 0 results — regenerating captcha (attempt ${tokenAttempt + 2})`)
          break // break inner loop → regenerate captcha
        }
        return result // last attempt — return empty
      } catch (e) {
        lastErr = e
        const msg = e instanceof Error ? e.message : String(e)
        // 521/origin-down = the origin is flaky, NOT a captcha problem.
        // Retry the search with the SAME token (don't regenerate captcha).
        if (msg.includes('521') || msg.includes('origin down') || msg.includes('522') || msg.includes('523')) {
          if (searchRetry < MAX_SEARCH_RETRIES - 1) {
            console.log(`[billing] search failed (origin down) — retrying with SAME token in 2s (retry ${searchRetry + 2}/${MAX_SEARCH_RETRIES})`)
            onPhase?.('searching', `Manba vaqtincha ishlamayapti. Qayta urinilmoqda (${searchRetry + 2}/${MAX_SEARCH_RETRIES})…`)
            await new Promise((r) => setTimeout(r, 1000))
            continue // retry inner loop with same token
          }
          // Exhausted search retries — try a new captcha as last resort
          if (tokenAttempt < MAX_TOKEN_ATTEMPTS - 1) {
            console.log(`[billing] search exhausted ${MAX_SEARCH_RETRIES} retries — regenerating captcha`)
            break // break inner loop → regenerate captcha
          }
        }
        // 422/captcha-fail or other error — regenerate captcha
        if (tokenAttempt < MAX_TOKEN_ATTEMPTS - 1) {
          console.log(`[billing] search failed (${msg}) — regenerating captcha`)
          await new Promise((r) => setTimeout(r, 800))
          break // break inner loop → regenerate captcha
        }
      }
    }
  }
  if (lastErr) {
    throw lastErr instanceof Error
      ? lastErr
      : new Error('billing.sud.uz is unreachable - the server may be temporarily down')
  }
  // All attempts returned empty - return the empty result.
  return {
    content: [],
    pageNumber: page,
    pageSize: size,
    totalElements: 0,
    totalPages: 0,
    last: true,
  }
}

// ---- Per-bill status (v206: through the shared scheduler) --------------------
//
// Was: a hand-rolled method list (primary + all workers + cors.sh) retried
// per bill — with 60 bills × 6 concurrency that stampeded billing.sud.uz.
// Now: each checkStatus is ONE hedged scheduler call (max 3 worker attempts,
// hedge 900ms) and the shared per-origin cap (NET_PER_ORIGIN_MAX) + spacing
// (NET_ORIGIN_SPACING_MS) pace the whole enrichment across all callers.

/**
 * v208 (API limits report, item F): per-invoice status cache.
 *
 * getFullBillData re-checks EVERY bill on every open/refresh of the same TIN
 * (60 checkStatus calls is the dominant billing.sud.uz load — see the API
 * limits report). Most invoices are already in a terminal state (paid/used/
 * cancelled/errored) and will never change again, so re-checking them is
 * pure waste. Cache terminal statuses indefinitely; cache non-terminal ones
 * (unpaid/partially paid/awaiting confirmation/sent to MIB) briefly so a
 * refresh still re-checks THOSE, just not the whole set.
 */
const FINAL_INVOICE_STATUSES = new Set(['PAID', 'USED', 'CANCELLED', 'BREAKED'])
const PENDING_STATUS_CACHE_TTL = 3 * 60 * 1000 // 3 minutes
interface BillStatusCacheEntry {
  detail: CheckStatusResponse
  ts: number
}
const billStatusCache = new Map<string, BillStatusCacheEntry>()

function cachedBillStatus(invoiceNumber: string): CheckStatusResponse | null {
  const cached = billStatusCache.get(invoiceNumber)
  if (!cached) return null
  const status = cached.detail.invoiceStatus
  if (status && FINAL_INVOICE_STATUSES.has(status)) return cached.detail
  if (Date.now() - cached.ts < PENDING_STATUS_CACHE_TTL) return cached.detail
  return null
}

/** Get the detailed status of one bill using the shared hedged scheduler. */
export async function getBillStatus(
  invoiceNumber: string,
  lang = 'ru',
  opts: { force?: boolean } = {},
): Promise<CheckStatusResponse> {
  if (!opts.force) {
    const cached = cachedBillStatus(invoiceNumber)
    if (cached) return cached
  }
  const params = new URLSearchParams({ invoice: invoiceNumber, lang })
  const url = `${BILLING_API}/api/invoice/checkStatus?${params.toString()}`
  const headers = {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Referer: `${BILLING_API}/invoice/${invoiceNumber}`,
  }

  let lastErr: unknown = null
  let httpErrorCount = 0 // count origin-level 429/4xx responses (bill might be broken)
  // Up to 2 scheduler hops; each hop already hedges across up to 3 workers.
  for (let hop = 0; hop < 2; hop++) {
    try {
      const res = await fetchViaWorkers(url, {
        originKey: 'billing.sud.uz',
        timeoutMs: 8_000,
        hedgeMs: 900,
        maxAttempts: 3,
        headers,
      })
      // 429/4xx = the origin answered on a worker. 5xx/521 never get here —
      // the scheduler treats them as failures and throws/hedges internally.
      if (res.status === 429 || res.status >= 400) {
        httpErrorCount++
        lastErr = new Error(`HTTP ${res.status}`)
        // BAIL EARLY: if 2 hops both return the same HTTP error, the origin
        // is giving a definitive answer for THIS bill — no point retrying.
        if (httpErrorCount >= 2) {
          console.log(`[billing] checkStatus ${invoiceNumber}: ${httpErrorCount} consecutive HTTP errors — bailing early (permanent failure)`)
          throw new Error(`PERMANENT: HTTP ${res.status}`)
        }
        continue
      }
      const body = (await res.json()) as CheckStatusResponse
      if (!body || typeof body !== 'object' || !body.requestStatus) {
        console.log(`[billing] checkStatus ${invoiceNumber}: invalid body — retrying`)
        lastErr = new Error('Invalid response')
        continue
      }
      billStatusCache.set(invoiceNumber, { detail: body, ts: Date.now() })
      if (billStatusCache.size > 500) {
        const now = Date.now()
        for (const [k, v] of billStatusCache) {
          const isFinal = v.detail.invoiceStatus && FINAL_INVOICE_STATUSES.has(v.detail.invoiceStatus)
          if (!isFinal && now - v.ts > PENDING_STATUS_CACHE_TTL * 5) billStatusCache.delete(k)
        }
        // Hard cap even for terminal entries (they never expire above) — evict
        // the oldest once the map gets unreasonably large.
        if (billStatusCache.size > 5000) {
          const oldest = [...billStatusCache.entries()].sort((a, b) => a[1].ts - b[1].ts)
          for (const [k] of oldest.slice(0, billStatusCache.size - 5000)) billStatusCache.delete(k)
        }
      }
      return body
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.startsWith('PERMANENT:')) throw e
      // AggregateError = every worker attempt failed at transport level —
      // loop to the next hop (the scheduler has already re-ordered workers).
      console.log(`[billing] checkStatus ${invoiceNumber} hop ${hop + 1} failed: ${msg.slice(0, 120)}`)
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(`checkStatus failed for ${invoiceNumber}`)
}

/**
 * Fetch every bill for an INN and enrich each one with its detailed status.
 * Bills are enriched in parallel (bounded concurrency) so the lookup stays fast
 * even for companies with many receipts without overwhelming the server.
 *
 * An optional `onProgress` callback is invoked after each bill is enriched,
 * which lets the API route stream partial results to the client.
 */
export async function getFullBillData(
  inn: string,
  onProgress?: (loaded: number, total: number, bill: EnrichedBill) => void,
  onPhase?: PhaseCallback,
): Promise<{
  inn: string
  totalElements: number
  bills: EnrichedBill[]
}> {
  onPhase?.('connecting', 'billing.sud.uz ga ulanilmoqda…')
  const search = await searchBillsByInn(inn, { onPhase })
  onPhase?.('enriching', `Fetching detailed status for ${search.totalElements} bill(s)…`)

  // NO bill limit — process ALL bills. The ProxyPool + retry loop below
  // handles failures by switching to alive proxies until every bill succeeds.
  const allItems = [...search.content]
  const items = [...allItems]

  const bills: EnrichedBill[] = []
  // Higher concurrency (6, was 4) — the permanent-fail bail (3 consecutive
  // HTTP 500s) + ProxyPool health tracking keep 6 concurrent checkStatus calls
  // safe even with a single working proxy. Was 2 → 4 → 6.
  const concurrency = 6
  let loaded = 0

  async function processItem(item: BillListItem): Promise<EnrichedBill> {
    try {
      const detail = await getBillStatus(item.number)
      return { ...item, detail }
    } catch (e) {
      return { ...item, detail: null, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // First pass: process all items with bounded concurrency.
  async function worker() {
    while (items.length) {
      const item = items.shift()!
      const enriched = await processItem(item)
      bills.push(enriched)
      loaded++
      onProgress?.(loaded, allItems.length, enriched)
      // Shorter delay (150ms, was 300ms) — the ProxyPool already paces requests
      // across proxies; this is just to avoid hammering a single proxy.
      await new Promise((r) => setTimeout(r, 80))
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))

  // Retry loop: re-fetch failed bills. Only 1 round — retry only TRANSIENT failures.
  // Bills that got HTTP 500/404 from the origin (not proxy errors) are permanent —
  // the origin returns a definitive error for that invoice, retrying won't help.
  // Only retry bills that failed due to timeouts or 521 (origin temporarily down).
  const PERMANENT_ERROR_PATTERNS = ['PERMANENT:', 'HTTP 5', 'HTTP 4', 'invalid']
  for (let retryRound = 0; retryRound < 1; retryRound++) {
    const failedBills = bills.filter((b) => b.error)
    if (failedBills.length === 0) break
    // Split: transient (timeout/521/aborted) vs permanent (HTTP 500/404/etc)
    const transientBills = failedBills.filter((b) => {
      const msg = b.error || ''
      return !PERMANENT_ERROR_PATTERNS.some((p) => msg.includes(p))
    })
    const permanentBills = failedBills.filter((b) => {
      const msg = b.error || ''
      return PERMANENT_ERROR_PATTERNS.some((p) => msg.includes(p))
    })
    if (transientBills.length === 0) {
      console.log(`[billing] retry skipped: ${permanentBills.length} bills have permanent errors (HTTP 4xx/5xx from origin)`)
      break
    }
    console.log(`[billing] retry round ${retryRound + 1}: ${transientBills.length} transient failures (${permanentBills.length} permanent skipped)`)
    onPhase?.('enriching', `Muvaffaqiyatsiz ${transientBills.length} ta toʻlov qayta urinilmoqda (${retryRound + 1}-bosqich)…`)
    await new Promise((r) => setTimeout(r, 500))
    const retryQueue = [...transientBills]
    const retryWorker = async () => {
      while (retryQueue.length) {
        const fb = retryQueue.shift()!
        const item: BillListItem = { number: fb.number, invoiceStatus: fb.invoiceStatus, issued: fb.issued }
        const enriched = await processItem(item)
        const idx = bills.findIndex((b) => b.number === fb.number)
        if (idx >= 0) {
          bills[idx] = enriched
        }
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, retryQueue.length) }, retryWorker))
  }

  // Preserve original order from the search response.
  const order = new Map(allItems.map((b, i) => [b.number, i]))
  bills.sort((a, b) => (order.get(a.number) ?? 0) - (order.get(b.number) ?? 0))

  return { inn, totalElements: search.totalElements, bills }
}
