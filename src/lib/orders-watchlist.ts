'use client'

/**
 * Checking the published orders of every Kuzatuv (watched) company — manually from the Kuzatuv page, or
 * automatically while the app sits idle.
 *
 * Client-orchestrated because the watchlist lives in the browser (localStorage): for each watched company we
 * read its cases (through the same cached /api/stats the app already uses) and hand them to the server's
 * background queue. The SERVER then decides per case whether a request is needed at all (published orders
 * are permanent; only a changed case or a publication-lag back-off triggers another look), so running this
 * again and again over the same watchlist is cheap.
 */

import { toast } from 'sonner'
import { fetchPublicOrders, getPublicOrdersStatus, getStats } from '@/lib/api-client'
import { caseSignature } from '@/core/public-orders'
import { watched } from '@/lib/registry'

// ---- settings (per browser) ---------------------------------------------------------------------

const AUTO_KEY = 'sud-orders-auto'
const LAST_KEY = 'sud-orders-auto-last'

export function autoEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0' // on by default
  } catch {
    return true
  }
}
export function setAutoEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0')
  } catch { /* private mode */ }
  emit()
}
export function lastAutoRun(): number {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || 0
  } catch {
    return 0
  }
}
const markAutoRun = () => {
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()))
  } catch { /* private mode */ }
}

// ---- runner state (a tiny external store; the snapshot object is replaced, never mutated) --------------

export interface RunnerState {
  phase: 'idle' | 'collecting'
  /** companies read so far / in total */
  done: number
  total: number
  auto: boolean
}

let state: RunnerState = { phase: 'idle', done: 0, total: 0, auto: false }
const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}
function set(next: Partial<RunnerState>) {
  state = { ...state, ...next }
  emit()
}
export const runnerSnapshot = (): RunnerState => state
export const subscribeRunner = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

let current: AbortController | null = null
export const stopWatchlistCheck = (): void => current?.abort()

// ---- the run ------------------------------------------------------------------------------------------

/** cases → the server's queue payload */
const payloadOf = (cases: { caseNumber: string; courtType: string; result: string }[]) =>
  cases.filter((c) => c.caseNumber).map((c) => ({ caseNumber: c.caseNumber, courtType: c.courtType, sig: caseSignature({ result: c.result }) }))

async function waitForJob(signal: AbortSignal): Promise<{ searched: number; found: number; errors: number } | null> {
  for (let i = 0; i < 400 && !signal.aborted; i++) {
    const r = await getPublicOrdersStatus(signal).catch(() => null)
    if (r && r.ok && r.data.job.state !== 'running') return r.data.job
    await new Promise((res) => setTimeout(res, 1500))
  }
  return null
}

export async function checkWatchlistOrders(opts: { auto: boolean; signal?: AbortSignal }): Promise<void> {
  if (current) return // one run at a time
  const list = watched()
  if (!list.length) {
    if (!opts.auto) toast.info('Kuzatuv roʻyxati boʻsh')
    return
  }
  const ac = new AbortController()
  current = ac
  opts.signal?.addEventListener('abort', () => ac.abort(), { once: true })
  set({ phase: 'collecting', done: 0, total: list.length, auto: opts.auto })

  let cases = 0
  try {
    for (const rec of list) {
      if (ac.signal.aborted) break
      const r = await getStats(rec.stir, { signal: ac.signal }).catch(() => null)
      if (r && r.ok) {
        const items = payloadOf(r.data.cases ?? [])
        if (items.length) {
          const q = await fetchPublicOrders(items)
          if (q.ok) cases += q.data.queued
        }
      }
      set({ done: state.done + 1 })
    }
  } finally {
    current = null
    set({ phase: 'idle' })
  }
  if (opts.auto && !ac.signal.aborted) markAutoRun() // an interrupted run does not use up the 6 h allowance
  if (ac.signal.aborted && opts.auto) return // interrupted by the user coming back: what was queued keeps running

  // tell the user how it went (auto runs stay silent unless something new arrived)
  const job = cases ? await waitForJob(new AbortController().signal) : null
  if (job) {
    if (job.found > 0) toast.success(`${job.found} ta yangi qaror yuklandi`)
    else if (!opts.auto) toast.info(job.searched === 0 ? 'Yangilanish yoʻq — barcha ishlar allaqachon tekshirilgan' : 'Yangi eʼlon qilingan qaror topilmadi')
    if (job.errors > 0 && !opts.auto) toast.error(`${job.errors} ta ishni tekshirib boʻlmadi — keyinroq qayta uriniladi`)
  } else if (!opts.auto && !ac.signal.aborted) toast.info('Kuzatuvdagi kompaniyalarda ish topilmadi')
}
