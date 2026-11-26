/**
 * A serial gate: ONE holder at a time, and the next one may start only `gapMs` AFTER the previous one is DONE (released), not a fixed time after it started.
 * Used in front of the court-orders PDF downloads: a download that takes 6 s already spaced itself, so waiting 10 s from its START cost nothing extra but
 * one that takes 1 s was held back for 9; «previous done + a short rest» never stacks two requests and never wastes the time a slow one already used.
 *
 *   const release = await gate.acquire(signal)
 *   try { …the request… } finally { release() }
 *
 * `gapMs() <= 0` = no rest between holders (still one at a time). A caller whose `signal` aborts leaves the queue. First come first served.
 * Pure (clock and sleep injected): tested in net/__tests__/serial-gate.test.ts.
 */

export interface SerialGateOptions {
  gapMs: () => number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const abortError = () => new DOMException('Aborted', 'AbortError')

export function createSerialGate(o: SerialGateOptions) {
  const now = o.now ?? Date.now
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let busy = false
  let freeAt = 0 // when the last holder let go
  const queue: { resolve: (release: () => void) => void; reject: (e: unknown) => void; signal?: AbortSignal }[] = []

  async function next(): Promise<void> {
    if (busy) return
    const w = queue.shift()
    if (!w) return
    busy = true
    try {
      const wait = freeAt + Math.max(o.gapMs(), 0) - now()
      if (wait > 0) await sleep(wait)
      if (w.signal?.aborted) throw abortError()
    } catch (e) {
      busy = false
      w.reject(e)
      void next()
      return
    }
    let done = false
    w.resolve(() => {
      if (done) return
      done = true
      freeAt = now()
      busy = false
      void next()
    })
  }

  return {
    acquire(signal?: AbortSignal): Promise<() => void> {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError())
        queue.push({ resolve, reject, signal })
        signal?.addEventListener('abort', () => {
          const i = queue.findIndex((q) => q.resolve === resolve)
          if (i >= 0) {
            queue.splice(i, 1)
            reject(abortError())
          }
        }, { once: true })
        void next()
      })
    },
    waiting: () => queue.length + (busy ? 1 : 0),
  }
}
