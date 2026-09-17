/**
 * Resilience toolkit — P2 of the rebuild blueprint (§5.2).
 *
 * Composable primitives every source adapter is GIVEN (not copy-pasted):
 *   - withTimeout: reject on a wall-clock budget
 *   - retryTiers: the 10s/15s/20s ladder from court-case.ts, generalized with
 *     jittered backoff between attempts
 *   - CircuitBreaker: stop hammering a dead origin; half-open probe after cooldown
 *   - bestOf: race N producers, first success wins (generalizes BEST-OF racing)
 *
 * The two bespoke health pools (billing ProxyPool, court OriginHealthPool)
 * remain the working implementations inside the libs; this toolkit is what NEW
 * code composes, and what future adapter migrations converge onto.
 */

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, externalSignal?: AbortSignal): Promise<T> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new TimeoutError(ms)), ms)
  const onExternalAbort = () => ac.abort(externalSignal?.reason)
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
  return fn(ac.signal).finally(() => {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  })
}

export interface RetryOptions {
  /** Timeout ladder per attempt (ms), e.g. [10_000, 15_000, 20_000]. */
  tiersMs: number[]
  /** Extra jitter added between attempts (ms). */
  jitterMs?: number
  signal?: AbortSignal
  onRetry?: (attempt: number, error: unknown, nextDelayMs: number) => void
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Run `fn` once per tier until it succeeds; waits with jitter between tiers. */
export async function retryTiers<T>(fn: (signal: AbortSignal) => Promise<T>, opts: RetryOptions): Promise<T> {
  const jitter = opts.jitterMs ?? 300
  let lastError: unknown
  for (let i = 0; i < opts.tiersMs.length; i++) {
    try {
      return await withTimeout(fn, opts.tiersMs[i], opts.signal)
    } catch (e) {
      lastError = e
      if (opts.signal?.aborted) throw e
      if (i < opts.tiersMs.length - 1) {
        const delay = Math.round(Math.random() * jitter)
        opts.onRetry?.(i + 1, e, delay)
        await sleep(delay)
      }
    }
  }
  throw lastError
}

// ---------- circuit breaker ---------------------------------------------------

export interface BreakerOptions {
  /** Consecutive failures before opening. */
  threshold: number
  /** Open → half-open probe delay (ms). */
  cooldownMs: number
}

type BreakerState = 'closed' | 'open' | 'half-open'

export class CircuitBreaker {
  private state: BreakerState = 'closed'
  private failures = 0
  private openedAt = 0
  readonly name: string

  constructor(name: string, private opts: BreakerOptions) {
    this.name = name
  }

  get isOpen(): boolean {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.opts.cooldownMs) {
      this.state = 'half-open'
    }
    return this.state === 'open'
  }

  /** Run through the breaker; throws `BreakerOpenError` while open. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen) throw new BreakerOpenError(this.name)
    try {
      const v = await fn()
      this.success()
      return v
    } catch (e) {
      this.failure()
      throw e
    }
  }

  success(): void {
    this.failures = 0
    this.state = 'closed'
  }

  failure(): void {
    this.failures++
    if (this.failures >= this.opts.threshold) {
      this.state = 'open'
      this.openedAt = Date.now()
    }
  }

  snapshot(): { state: BreakerState; failures: number } {
    return { state: this.isOpen ? 'open' : this.state, failures: this.failures }
  }
}

export class BreakerOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open — backing off`)
    this.name = 'BreakerOpenError'
  }
}

// ---------- BEST-OF racing -----------------------------------------------------

/**
 * Race N producers; resolve with the FIRST success. Reject only when ALL fail.
 * `null` producers are skipped (e.g. workers filtered out by health).
 * Generalizes the BEST-OF racing hard-coded in court-case.ts.
 */
export async function bestOf<T>(
  producers: Array<() => Promise<T>>,
  opts: { label?: string } = {},
): Promise<T> {
  if (producers.length === 0) throw new Error(`${opts.label ?? 'bestOf'}: no producers`)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let failures = 0
    let firstError: unknown = null
    const onFail = (e: unknown) => {
      if (settled) return
      failures++
      firstError ??= e
      if (failures >= producers.length) {
        settled = true
        reject(firstError)
      }
    }
    for (const p of producers) {
      p().then(
        (v) => {
          if (settled) return
          settled = true
          resolve(v)
        },
        onFail,
      )
    }
  })
}
