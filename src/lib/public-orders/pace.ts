/**
 * The ONE gate in front of every request to the court-orders API (searches, the pre-2024 search, PDF downloads), whether it goes
 * straight from this machine or through a worker: one request starts every PUBLIC_ORDERS_MIN_GAP_MS (default 10 s). The site's
 * firewall blocks bursts, and a check used to send five searches at once per case. A person opening one PDF goes first.
 * `PUBLIC_ORDERS_MIN_GAP_MS=0` switches it off. The shared instance lives on globalThis (a route bundle must see the same queue).
 */

import { createPacer, type Priority } from '@/lib/net/pacer'
import { createSerialGate } from '@/lib/net/serial-gate'
import { ORDERS_FILE_GAP_SECONDS_DEFAULT, ORDERS_GAP_SECONDS_DEFAULT } from '@/core/public-orders'

export function ordersGapMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PUBLIC_ORDERS_MIN_GAP_MS
  if (raw === undefined || raw.trim() === '') return ORDERS_GAP_SECONDS_DEFAULT * 1000
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), 120_000) : ORDERS_GAP_SECONDS_DEFAULT * 1000
}

const G = globalThis as typeof globalThis & { __sudOrdersPacer?: ReturnType<typeof createPacer> }
const pacer = () => (G.__sudOrdersPacer ??= createPacer({ gapMs: () => ordersGapMs() }))

/** Resolves when it is this request's turn to be sent. */
export function ordersPace(priority: Priority = 'background', signal?: AbortSignal): Promise<void> {
  return pacer().pace(priority, signal)
}

export const ordersWaiting = (): number => pacer().waiting() + fileGate().waiting()

/**
 * PDF downloads are NOT paced start-to-start like the searches: one download at a time, and the next may start `PUBLIC_ORDERS_FILE_GAP_MS` (default 4 s) after the
 * previous one FINISHED. A file that took 6 s used to be followed by 4 s of waiting anyway; now a slow one is simply followed by the short rest, and a quick one
 * is never held back for the rest of a fixed 10 s. `0` = no rest (still one at a time). The firewall's circuit breaker (lib/public-orders/waf) is unchanged.
 */
export function ordersFileGapMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PUBLIC_ORDERS_FILE_GAP_MS
  if (raw === undefined || raw.trim() === '') return ORDERS_FILE_GAP_SECONDS_DEFAULT * 1000
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), 120_000) : ORDERS_FILE_GAP_SECONDS_DEFAULT * 1000
}

const GF = globalThis as typeof globalThis & { __sudOrdersFileGate?: ReturnType<typeof createSerialGate> }
const fileGate = () => (GF.__sudOrdersFileGate ??= createSerialGate({ gapMs: () => ordersFileGapMs() }))

/** Resolves when it is this download's turn; call the returned function when the download is DONE (success or failure). */
export function ordersFileSlot(signal?: AbortSignal): Promise<() => void> {
  return fileGate().acquire(signal)
}
