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
import { fetchPublicOrders, getStats, pausePublicOrdersJob, planPublicOrders, resumePublicOrdersJob } from '@/lib/api-client'
import { orderJobCase } from '@/core/public-orders'
import { orderCasesOf, watched } from '@/lib/registry'

// ---- settings (per browser) ---------------------------------------------------------------------

const AUTO_KEY = 'sud-orders-auto'
const LAST_KEY = 'sud-orders-auto-last'

export function autoEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === '1' // OFF unless the owner switched it on: nothing starts by itself
  } catch {
    return false
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
  /** paused by the user: no further company is read until resumed */
  paused: boolean
}

let state: RunnerState = { phase: 'idle', done: 0, total: 0, auto: false, paused: false }
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

/** Was the run in progress started by the idle check? (finish messages stay quiet for those) */
let lastRunAuto = false
export const runWasAuto = (): boolean => lastRunAuto

let current: AbortController | null = null
/** Give up the collecting phase (the auto-check does this when the user comes back). What is queued keeps going. */
export const stopWatchlistCheck = (): void => current?.abort()

/** Pause: stop reading further companies AND hold the server queue exactly where it is. Resume continues in order. */
export async function pauseWatchlistCheck(): Promise<void> {
  if (state.phase === 'collecting') set({ paused: true })
  await pausePublicOrdersJob()
}
export async function resumeWatchlistCheck(): Promise<void> {
  if (state.paused) set({ paused: false })
  await resumePublicOrdersJob()
}

// ---- the run ------------------------------------------------------------------------------------------

/** cases → the server's queue payload */
const payloadOf = (cases: { caseNumber: string; courtType: string; result: string; caseStatus?: string }[]) =>
  cases.filter((c) => c.caseNumber).map(orderJobCase)

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

/**
 * DETECT without scraping: how many of the watched companies' cases would really need a look. It works from the cases
 * each company already has cached in the registry (written whenever its stats are read), so it costs one local call
 * to the server and never touches the court sites. `null` when there is nothing cached to judge yet.
 */
export async function planWatchlistOrders(): Promise<{ need: number; known: number; ongoing: number } | null> {
  const cases = watched().flatMap((w) => orderCasesOf(w.meta))
  if (!cases.length) return null
  const r = await planPublicOrders(cases.map(orderJobCase))
  return r.ok ? r.data : null
}

/**
 * The run itself — only ever called from an explicit click or the opt-in idle check: read every watched company's
 * cases and hand them to the server's queue, which starts scraping what really needs a look.
 */
export async function checkWatchlistOrders(opts: { auto: boolean; signal?: AbortSignal }): Promise<void> {
  if (current) return // one run at a time
  const list = watched()
  if (!list.length) {
    if (!opts.auto) toast.info('Kuzatuv roʻyxati boʻsh')
    return
  }
  const ac = new AbortController()
  current = ac
  lastRunAuto = opts.auto
  opts.signal?.addEventListener('abort', () => ac.abort(), { once: true })
  set({ phase: 'collecting', done: 0, total: list.length, auto: opts.auto, paused: false })

  let ongoing = 0
  let known = 0
  let queued = 0
  try {
    for (const rec of list) {
      while (state.paused && !ac.signal.aborted) await sleep(300) // paused: hold before the next company
      if (ac.signal.aborted) break
      const r = await getStats(rec.stir, { signal: ac.signal }).catch(() => null)
      if (r && r.ok) {
        const items = payloadOf(r.data.cases ?? [])
        if (items.length) {
          const q = await fetchPublicOrders(items, { keepPaused: true })
          if (q.ok) {
            queued += q.data.queued
            ongoing += q.data.ongoing
            known += q.data.known
          }
        }
      }
      set({ done: state.done + 1 })
    }
  } finally {
    current = null
    set({ phase: 'idle', paused: false })
  }
  if (opts.auto && !ac.signal.aborted) markAutoRun() // an interrupted run does not use up the 6 h allowance
  // a run the user (or their coming back) cut short says nothing: the queue keeps going and the pill shows it
  if (ac.signal.aborted) return

  // When something was queued, the global pill follows it and announces the end (orders-loader). Only «there was nothing
  // to do» has no pill, so say that here — for a manual run only.
  if (queued === 0 && !opts.auto) {
    toast.info(
      known || ongoing
        ? `Yangi tekshiradigan ish yoʻq${known ? `: ${known} ta ish allaqachon maʼlum` : ''}${ongoing ? `${known ? ', ' : ': '}${ongoing} ta hali birinchi instansiyada koʻrilmoqda` : ''}`
        : 'Kuzatuvdagi kompaniyalarda ish topilmadi',
    )
  }
}
