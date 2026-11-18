/**
 * A pacer: lets ONE request start every `gapMs`, no matter how many callers are waiting. First come first served, except that
 * an `interactive` caller (a person clicked something) is released before any `background` one (a crawl). Used in front of the
 * court-orders API, whose firewall blocks bursts. Pure (clock and sleep injected): tested in net/__tests__/pacer.test.ts.
 *
 *   await pacer.pace('background')   // resolves when it is this caller's turn to send
 *
 * `gapMs() <= 0` switches pacing off. A caller whose `signal` aborts leaves the queue (it never takes a slot).
 */

export type Priority = 'interactive' | 'background'

export interface PacerOptions {
  gapMs: () => number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

interface Waiter {
  resolve: () => void
  reject: (e: unknown) => void
  signal?: AbortSignal
}

const abortError = () => new DOMException('Aborted', 'AbortError')

export function createPacer(o: PacerOptions) {
  const now = o.now ?? Date.now
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const queues: Record<Priority, Waiter[]> = { interactive: [], background: [] }
  let nextAt = 0
  let draining = false

  const hasWaiters = () => queues.interactive.length + queues.background.length > 0
  /** the next waiter that is still interested (aborted ones are dropped on the way) */
  const take = (): Waiter | undefined => {
    for (const p of ['interactive', 'background'] as Priority[]) {
      for (let w = queues[p].shift(); w; w = queues[p].shift()) {
        if (w.signal?.aborted) {
          w.reject(abortError())
          continue
        }
        return w
      }
    }
    return undefined
  }

  async function drain(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (hasWaiters()) {
        const gap = o.gapMs()
        const wait = gap > 0 ? nextAt - now() : 0
        if (wait > 0) await sleep(wait) // whoever arrives meanwhile is judged by priority below, not by arrival
        const w = take()
        if (!w) continue
        if (gap > 0) nextAt = now() + gap
        w.resolve()
      }
    } finally {
      draining = false
    }
  }

  return {
    pace(priority: Priority = 'background', signal?: AbortSignal): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(abortError())
        queues[priority].push({ resolve, reject, signal })
        void drain()
      })
    },
    /** how many callers are waiting for their turn */
    waiting: () => queues.interactive.length + queues.background.length,
  }
}
