import type { VlmFailure, VlmInput } from '@/core/vlm'
import { vlmId } from '@/core/vlm'
import { VlmError, type VisionRequest } from './vlm-client'

/**
 * Several captcha readers taken IN TURN (round robin), with failover. Every question starts at the provider after the
 * one that answered last, so the free quotas are used evenly; if that provider fails, the next one is asked at once,
 * before anything is retried. A provider that says «limit reached» (or whose key / model is wrong) is skipped for a
 * while instead of being asked again on every picture. When all of them fail the error lists each reason.
 * Pure: the providers, the call and the clock are injected (server wiring: lib/billing.ts).
 */

/** how long a provider is left alone after a failure of this kind (0 = ask again at once) */
export const COOLDOWN_MS: Record<VlmFailure, number> = {
  rate_limited: 5 * 60_000, // out of quota: minutes, not seconds
  bad_key: 30 * 60_000, // the operator has to fix it; do not hammer
  bad_model: 30 * 60_000,
  not_vision: 30 * 60_000,
  http_error: 30_000,
  network: 30_000,
  timeout: 30_000,
  empty: 0,
}

export class VlmPoolError extends Error {
  constructor(message: string, public failures: { id: string; kind: VlmFailure | 'other'; message: string }[]) {
    super(message)
  }
}

export interface VlmPoolDeps {
  list: () => VlmInput[]
  call: (cfg: VlmInput, req: VisionRequest) => Promise<string>
  now: () => number
  log: (line: string) => void
}

export interface VlmAnswer {
  text: string
  /** «gemini · gemini-3.5-flash-lite» */
  via: string
}

const label = (v: VlmInput): string => `${vlmId(v)} · ${v.model}`

export function createVlmPool(deps: VlmPoolDeps) {
  let next = 0 // the id-less position to start from: «after the one that answered last»
  const resting = new Map<string, number>() // id → not before

  return {
    async ask(req: VisionRequest): Promise<VlmAnswer> {
      const all = deps.list()
      if (!all.length) throw new VlmPoolError('VLM sozlanmagan', [])
      const start = next % all.length
      const turn = [...all.slice(start), ...all.slice(0, start)]
      const now = deps.now()
      const awake = turn.filter((v) => (resting.get(vlmId(v)) ?? 0) <= now)
      const order = awake.length ? awake : turn // everyone resting: ask anyway, better than giving up
      const failures: VlmPoolError['failures'] = []
      for (const v of order) {
        const id = vlmId(v)
        try {
          const text = await deps.call(v, req)
          resting.delete(id)
          next = all.findIndex((x) => vlmId(x) === id) + 1
          return { text, via: label(v) }
        } catch (e) {
          const kind: VlmFailure | 'other' = e instanceof VlmError ? e.kind : 'other'
          const msg = e instanceof Error ? e.message : String(e)
          failures.push({ id, kind, message: msg })
          if (kind !== 'other') resting.set(id, deps.now() + COOLDOWN_MS[kind])
          const more = order.indexOf(v) < order.length - 1
          deps.log(`[captcha] VLM ${label(v)} failed (${kind}: ${msg.slice(0, 120)})${more ? ' → trying the next provider' : ''}`)
        }
      }
      next = (start + 1) % all.length // do not start on the same failing one next time
      throw new VlmPoolError(`barcha VLM xato berdi: ${failures.map((f) => `${f.id} (${f.kind})`).join(', ')}`, failures)
    },
    /** for the Settings status and tests */
    restingUntil: (id: string): number => resting.get(id) ?? 0,
    reset(): void {
      next = 0
      resting.clear()
    },
  }
}
