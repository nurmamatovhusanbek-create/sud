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

// v144: CF Worker fallback list — MOVED HERE (was at line 912, after the code
// that uses it, causing "Cannot access 'FALLBACK_WORKERS' before initialization"
// ReferenceError at module load time). Must be defined BEFORE buildCaptchaPool().
//
// v144: Removed all non-worker proxies (cors.sh, allorigins, corsproxy.io,
// codetabs, thingproxy). User requested: ONLY CF Workers, no other proxies.
const FALLBACK_WORKERS = [
  'https://broad-field-f2b0.uzwebfox.workers.dev/',
  'https://wild-hall-04ae.uzwebfox.workers.dev/',
  'https://orange-darkness-8843.najimsheikh071.workers.dev/',
  'https://wandering-wind-1d3d.najimsheikh071.workers.dev/',
]

/** Build the list of CF Worker URLs from env (supports multiple + backward compat).
 *  v144: CF Workers ONLY — no other proxies. If env is empty, uses FALLBACK_WORKERS. */
function getCfWorkerUrls(): string[] {
  const urls: string[] = []
  // CF_WORKER_URLS (comma-separated, preferred)
  const multi = process.env.CF_WORKER_URLS
  if (multi) {
    for (const u of multi.split(',').map(s => s.trim()).filter(Boolean)) {
      urls.push(u.endsWith('/') ? u : u + '/')
    }
  }
  // CF_WORKER_URL (single, backward compat) — add if not already in list
  const single = process.env.CF_WORKER_URL
  if (single) {
    const normalized = single.endsWith('/') ? single : single + '/'
    if (!urls.includes(normalized)) urls.push(normalized)
  }
  return urls.length > 0 ? urls : FALLBACK_WORKERS
}

/**
 * billing.sud.uz blocks many IPs (including Tor exit nodes). We route billing
 * requests through free CORS proxies that run on unblocked datacenter IPs.
 * The captcha API (recaptcha.sud.uz) is NOT blocked, so it connects directly.
 *
 * Multiple proxies are used with rotation so if one rate-limits or goes down,
 * the app automatically switches to another.
 *
 * ## ProxyPool with health tracking
 *
 * Instead of blindly round-robining through all proxies on every request, the
 * pool tracks per-proxy success/failure counts. A proxy that fails 3 times in
 * a row is marked "dead" for 60 seconds and skipped — so we stop wasting
 * ~15s per bill retrying known-dead proxies (corsproxy.io paid plan, allorigins
 * empty responses). This cuts 60-bill lookup time from ~800s to ~150s.
 *
 * ### Optional: self-hosted Cloudflare Worker proxy
 *
 * proxy.cors.sh rate-limits after ~30 requests/min. For companies with many
 * bills (100+), deploy your own free Cloudflare Worker proxy (unlimited, no
 * rate limits). Set `CF_WORKER_URL` in .env:
 *   CF_WORKER_URL=https://your-worker.your-subdomain.workers.dev
 * The worker code is in `cloudflare-worker/proxy.js` — deploy it in 2 minutes
 * at https://dash.cloudflare.com → Workers. The worker runs on Cloudflare's
 * edge network (200+ locations) so it's fast and rarely IP-blocked.
 */

// ---- ProxyPool: health-tracked CORS proxy rotation --------------------

interface ProxyState {
  url: string
  label: string
  needsEncoding: boolean // allorigins needs encodeURIComponent
  failures: number
  successes: number
  lastFailureAt: number
  deadUntil: number // 0 = alive; timestamp = retry allowed after this time
}

class ProxyPool {
  private states: ProxyState[]
  private nextIndex = 0
  private static readonly DEAD_THRESHOLD = 2 // mark dead after 2 consecutive failures (was 3)
  private static readonly DEAD_COOLDOWN_MS = 60_000 // skip dead proxies for 60s

  constructor(proxies: { url: string; needsEncoding?: boolean }[]) {
    this.states = proxies.map((p) => ({
      url: p.url,
      label: this.labelFor(p.url),
      needsEncoding: p.needsEncoding ?? false,
      failures: 0,
      successes: 0,
      lastFailureAt: 0,
      deadUntil: 0,
    }))
  }

  private labelFor(url: string): string {
    try {
      return new URL(url).hostname
    } catch {
      return url.substring(0, 30)
    }
  }

  /** Get the next alive proxy — prefers ones that have succeeded before
   *  (so once proxy.cors.sh proves it works, it's tried FIRST, not round-robined
   *  with 4 dead proxies that each waste 8s on timeout). */
  next(): ProxyState | null {
    const now = Date.now()
    // Revive proxies whose cooldown has expired (give them another chance).
    for (const s of this.states) {
      if (s.deadUntil > 0 && s.deadUntil < now) {
        s.deadUntil = 0
        s.failures = 0
        console.log(`[billing] proxy ${s.label} revived after cooldown`)
      }
    }
    const alive = this.states.filter((s) => s.deadUntil === 0)
    if (alive.length === 0) {
      // All proxies dead — revive the one with the oldest failure (best chance).
      const oldest = this.states.reduce((a, b) =>
        a.lastFailureAt < b.lastFailureAt ? a : b,
      )
      oldest.deadUntil = 0
      oldest.failures = 0
      console.log(`[billing] all proxies dead — reviving ${oldest.label} (oldest failure)`)
      return oldest
    }
    // PRIORITY: proxies with successes > 0 are "known working" — try them first.
    // Among known-working ones, round-robin to spread load.
    const knownWorking = alive.filter((s) => s.successes > 0)
    if (knownWorking.length > 0) {
      return knownWorking[this.nextIndex++ % knownWorking.length]
    }
    // No known-working proxies yet — try untested ones (successes=0, failures=0)
    // before ones that have already failed.
    const untested = alive.filter((s) => s.failures === 0)
    if (untested.length > 0) {
      return untested[this.nextIndex++ % untested.length]
    }
    // All alive proxies have failed at least once — try the one with fewest failures.
    return alive.reduce((a, b) => (a.failures <= b.failures ? a : b))
  }

  markSuccess(proxy: ProxyState): void {
    proxy.successes++
    proxy.failures = 0
    proxy.deadUntil = 0
  }

  markFailed(proxy: ProxyState): void {
    proxy.failures++
    proxy.lastFailureAt = Date.now()
    if (proxy.failures >= ProxyPool.DEAD_THRESHOLD && proxy.deadUntil === 0) {
      proxy.deadUntil = Date.now() + ProxyPool.DEAD_COOLDOWN_MS
      console.log(
        `[billing] proxy ${proxy.label} marked DEAD for ${ProxyPool.DEAD_COOLDOWN_MS / 1000}s ` +
          `(${proxy.failures} consecutive failures)`,
      )
    }
  }

  aliveCount(): number {
    return this.states.filter((s) => s.deadUntil === 0).length
  }

  /** Human-readable stats for debugging. */
  stats(): string {
    return this.states
      .map(
        (s) =>
          `${s.label}: ${s.successes}✓/${s.failures}✗ ${s.deadUntil > Date.now() ? 'DEAD' : 'alive'}`,
      )
      .join(' | ')
  }
}

// Build the proxy list. Order = priority (first = preferred).
//
// IMPORTANT: billing.sud.uz sits behind its OWN Cloudflare, which BLOCKS
// Cloudflare Worker IPs (HTTP 521 origin_down) for the /api/invoice/* endpoints.
// However, recaptcha.sud.uz (the captcha API) does NOT block CF Workers.
// So we use TWO pools:
//  - captchaPool: CF Worker first (fast, unlimited), fallback to cors.sh
//  - billingPool: proxy.cors.sh first (the only one that works for billing),
//    CF Worker is EXCLUDED from billing (it always gets 521)
function buildCaptchaPool(): { url: string; needsEncoding?: boolean }[] {
  const list: { url: string; needsEncoding?: boolean }[] = []
  // v144: CF Workers ONLY — no other proxies (cors.sh, allorigins removed).
  const urls = getCfWorkerUrls()
  for (const u of urls) {
    list.push({ url: u })
  }
  if (list.length > 0) {
    console.log(`[billing] ${list.length} CF Worker(s) enabled for captcha API`)
  }
  return list
}

function buildBillingPool(): { url: string; needsEncoding?: boolean }[] {
  // v144: CF Workers ONLY — no other proxies (cors.sh, allorigins, corsproxy.io,
  // codetabs, thingproxy all removed per user request).
  const list: { url: string; needsEncoding?: boolean }[] = []
  const urls = getCfWorkerUrls()
  for (const u of urls) {
    list.push({ url: u })
  }
  if (list.length > 0) {
    console.log(`[billing] ${list.length} CF Worker(s) enabled for billing API`)
  }
  return list
}

const captchaPool = new ProxyPool(buildCaptchaPool())
const billingPool = new ProxyPool(buildBillingPool())

// ---- Global circuit breaker for billing.sud.uz origin outages -----------------
// When billing.sud.uz's origin goes down (sustained 521), ALL bills fail.
// Without a circuit breaker, 60 bills × 6 retries × 6 concurrency = 2160 requests
// hammer a dead origin. This breaker detects sustained 521 and pauses ALL billing
// requests for 30s, giving the origin time to recover.
const circuitBreaker = {
  consecutive521: 0,
  trippedUntil: 0, // 0 = not tripped; timestamp = resume allowed after this
  TRIP_THRESHOLD: 5, // trip after 5 consecutive 521s
  COOLDOWN_MS: 30_000, // pause all billing requests for 30s when tripped
  isTripped(): boolean {
    if (this.trippedUntil > 0 && Date.now() < this.trippedUntil) return true
    if (this.trippedUntil > 0 && Date.now() >= this.trippedUntil) {
      // Cooldown expired — reset and try again
      console.log(`[billing] circuit breaker cooldown expired — resuming requests`)
      this.trippedUntil = 0
      this.consecutive521 = 0
    }
    return false
  },
  record521(): void {
    this.consecutive521++
    if (this.consecutive521 >= this.TRIP_THRESHOLD && this.trippedUntil === 0) {
      this.trippedUntil = Date.now() + this.COOLDOWN_MS
      console.log(`[billing] ⚠ CIRCUIT BREAKER TRIPPED — ${this.consecutive521} consecutive 521s. Pausing all billing requests for ${this.COOLDOWN_MS / 1000}s. The origin (billing.sud.uz) is down.`)
    }
  },
  recordSuccess(): void {
    if (this.consecutive521 > 0) {
      this.consecutive521 = 0
    }
  },
  /** Wait until the circuit breaker is no longer tripped. */
  async waitForRecovery(): Promise<void> {
    while (this.isTripped()) {
      const waitMs = Math.min(this.trippedUntil - Date.now(), 5000)
      console.log(`[billing] circuit breaker tripped — waiting ${Math.ceil(waitMs / 1000)}s for origin recovery…`)
      await new Promise((r) => setTimeout(r, Math.max(waitMs, 1000)))
    }
  },
}

/** Select the right pool based on the target URL.
 *  recaptcha.sud.uz → captchaPool (CF Worker works)
 *  billing.sud.uz → billingPool (proxy.cors.sh works, CF Worker gets 521) */
function poolFor(url: string): ProxyPool {
  return url.includes('recaptcha.sud.uz') ? captchaPool : billingPool
}

/** @deprecated Use poolFor(url) instead. Kept for backward compat. */
const proxyPool = billingPool

/** Get a human-readable label for the current proxy (for logging). */
function getCurrentProxyLabel(): string {
  const p = proxyPool.next()
  return p ? p.label : 'none'
}

// Legacy functions kept for backward compatibility with fetchJsonWithRetry
// (which uses proxyBillingUrl + rotateProxy for the search endpoint).
function getCurrentProxy(): string {
  const p = proxyPool.next()
  return p ? p.url : 'https://proxy.cors.sh/'
}

function rotateProxy(): string {
  // In the new pool system, rotation happens automatically via next().
  // This is kept so fetchJsonWithRetry's existing code doesn't break.
  return getCurrentProxy()
}

/** Wrap a billing.sud.uz URL with the current CORS proxy (uses billing pool). */
function proxyBillingUrl(url: string): string {
  if (!url.startsWith(BILLING_API)) return url
  const proxy = billingPool.next()
  if (!proxy) return url // no proxies available — try direct (will likely fail)
  if (proxy.needsEncoding) {
    return proxy.url + encodeURIComponent(url)
  }
  return proxy.url + url
}

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
 * Two profiles:
 * - **Captcha API** (recaptcha.sud.uz): direct connection, 2 retries, short backoff.
 * - **Billing API** (billing.sud.uz): routed through CORS proxy (proxy.cors.sh)
 *   because billing.sud.uz blocks many IPs including Tor exit nodes. 6 retries,
 *   longer backoff. No Tor needed - the proxy runs on an unblocked datacenter IP.
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

  // HYBRID: For billing URLs, try DIRECT first (fast, ~400ms), then CF Worker
  // (slower but different IP). For captcha, use CF Worker (works reliably).
  // This spreads load across 2 IP ranges so neither gets rate-blocked.
  const cfWorkerUrl = process.env.CF_WORKER_URL
  const cfProxy = cfWorkerUrl
    ? (cfWorkerUrl.endsWith('/') ? cfWorkerUrl : cfWorkerUrl + '/')
    : 'https://proxy.cors.sh/'

  let lastErr: unknown = null
  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    const startTime = Date.now()
    try {
      // For billing: round-robin through direct + all workers.
      // For captcha: use first worker (captcha isn't rate-limited).
      let currentFetchUrl = url
      let proxyLabel = 'direct'
      if (isCaptchaUrl) {
        // Captcha: use first CF Worker (works reliably, no rate limit)
        const workers = getCfWorkerUrls()
        if (workers.length > 0) {
          currentFetchUrl = workers[0] + url
          proxyLabel = 'worker1'
        }
      } else if (isBillingUrl) {
        // Billing: round-robin through direct + all workers
        const method = nextProxyUrl(url)
        currentFetchUrl = method.url
        proxyLabel = method.label
      }
      const timeoutMs = isCaptchaUrl ? 10000 : 8000
      const res = await fetch(currentFetchUrl, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      })
      const elapsed = Date.now() - startTime
      const label = url.split('/').pop()?.split('?')[0] ?? url
      console.log(`[billing] ${label} attempt ${attempt + 1}: HTTP ${res.status} in ${elapsed}ms (via ${proxyLabel})`)

      // 521/522/523 = origin down. Try the OTHER method on next attempt.
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
          throw new Error(`Invalid search response from ${proxyLabel}`)
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

// ---- Multi-proxy router: rotates through direct + multiple CF Workers --------
// With 4 CF Workers + direct = 5 different IPs. Each handles only ~12 of 60
// bills — well under billing.sud.uz's ~50-request rate limit.
//
// Workers are configured in .env via CF_WORKER_URLS (comma-separated).
// Falls back to CF_WORKER_URL (single, for backward compat) then proxy.cors.sh.
//
// The router round-robins: direct → worker1 → worker2 → worker3 → worker4 →
// direct → worker1... so no single IP gets hammered.
let requestCounter = 0

// v144: FALLBACK_WORKERS + getCfWorkerUrls moved to top of file (before
// buildCaptchaPool) to fix "Cannot access before initialization" ReferenceError.
// The duplicate definitions that were here have been removed.

/** Get the next proxy to try (round-robin among CF Workers only — NEVER direct).
 *  Using direct exposes the server IP and gets it blocked by billing.sud.uz. */
function nextProxyUrl(targetUrl: string): { url: string; label: string } {
  const workers = getCfWorkerUrls()
  if (workers.length === 0) {
    // No workers configured — use hardcoded fallback (NOT direct, NOT cors.sh)
    const fb = FALLBACK_WORKERS[requestCounter % FALLBACK_WORKERS.length]
    return { url: fb + targetUrl, label: 'fallback' }
  }
  const methods: { url: string; label: string }[] = workers.map((w, i) => ({
    url: w + targetUrl, label: `worker${i + 1}`,
  }))
  const method = methods[requestCounter % methods.length]
  requestCounter++
  return method
}

/** Build fallback list: all CF Workers + cors.sh (NEVER direct — protects server IP). */
function getAllProxyUrls(targetUrl: string): { url: string; label: string }[] {
  const workers = getCfWorkerUrls()
  const methods: { url: string; label: string }[] = workers.map((w, i) => ({
    url: w + targetUrl, label: `worker${i + 1}`,
  }))
  methods.push({ url: 'https://proxy.cors.sh/' + targetUrl, label: 'cors.sh' })  // last resort
  return methods
}

/** Get the detailed status of one bill using multi-proxy rotation. */
export async function getBillStatus(invoiceNumber: string, lang = 'ru'): Promise<CheckStatusResponse> {
  const params = new URLSearchParams({ invoice: invoiceNumber, lang })
  const url = `${BILLING_API}/api/invoice/checkStatus?${params.toString()}`
  const headers = {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Referer: `${BILLING_API}/invoice/${invoiceNumber}`,
  }

  // Primary proxy (round-robin) + all fallbacks
  const primary = nextProxyUrl(url)
  const allMethods = getAllProxyUrls(url)
  // Put primary first, then the rest (deduplicated)
  const methods = [primary, ...allMethods.filter(m => m.url !== primary.url)]

  let lastErr: unknown = null
  let httpErrorCount = 0 // count consecutive HTTP 500/404 (origin-level, not proxy)
  for (let i = 0; i < methods.length; i++) {
    const { url: fetchUrl, label } = methods[i]
    try {
      const res = await fetch(fetchUrl, { headers, signal: AbortSignal.timeout(6000) })
      // 521/522/523 = origin down. Try next proxy (transient).
      if (res.status === 521 || res.status === 522 || res.status === 523) {
        console.log(`[billing] checkStatus ${invoiceNumber} via ${label}: HTTP ${res.status} — trying next`)
        lastErr = new Error(`HTTP ${res.status}`)
        httpErrorCount = 0 // reset — 521 is transient (origin down), not bill-specific
        continue
      }
      if (res.status === 429 || res.status >= 500) {
        console.log(`[billing] checkStatus ${invoiceNumber} via ${label}: HTTP ${res.status} — trying next`)
        lastErr = new Error(`HTTP ${res.status}`)
        httpErrorCount++ // count origin-level errors (500/404 = bill might be broken)
        // BAIL EARLY: if 3+ methods all return the same HTTP 500/429, the origin
        // is returning a definitive error for THIS bill — no point trying the
        // remaining 2 methods (they'll get the same response). This prevents
        // wasting 15+ seconds on a permanently-broken bill.
        if (httpErrorCount >= 3) {
          console.log(`[billing] checkStatus ${invoiceNumber}: ${httpErrorCount} consecutive HTTP errors — bailing early (permanent failure)`)
          throw new Error(`PERMANENT: HTTP ${res.status}`)
        }
        continue
      }
      const body = (await res.json()) as CheckStatusResponse
      if (!body || typeof body !== 'object' || !body.requestStatus) {
        console.log(`[billing] checkStatus ${invoiceNumber} via ${label}: invalid — trying next`)
        lastErr = new Error(`Invalid response from ${label}`)
        continue
      }
      return body
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      // Don't log "PERMANENT:" errors again (already logged above)
      if (!msg.startsWith('PERMANENT:')) {
        console.log(`[billing] checkStatus ${invoiceNumber} via ${label} failed: ${msg}`)
      }
      // If this was a permanent bail, re-throw immediately
      if (msg.startsWith('PERMANENT:')) throw e
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
