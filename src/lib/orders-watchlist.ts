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
import { fetchPublicOrders, getPublicOrdersStatus, getStats, pausePublicOrdersJob, resumePublicOrdersJob } from '@/lib/api-client'
import { orderJobCase } from '@/core/public-orders'
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
  /** paused by the user: no further company is read until resumed */
  paused: boolean
  /** DETECT only (which cases need a look, nothing scraped): the pill words it differently */
  detect: boolean
}

let state: RunnerState = { phase: 'idle', done: 0, total: 0, auto: false, paused: false, detect: false }
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

/**
 * Waits for the queue to finish. A PAUSED queue is not an answer (the user stopped it on purpose and will resume it),
 * so it resolves to null and nothing is announced — the toasts below are only for a run that really ended.
 */
async function waitForJob(signal: AbortSignal): Promise<{ searched: number; found: number; errors: number } | null> {
  for (let i = 0; i < 2400 && !signal.aborted; i++) {
    const r = await getPublicOrdersStatus(signal).catch(() => null)
    if (r && r.ok) {
      const st = r.data.job.state
      if (st === 'paused' || st === 'ready') return null
      if (st !== 'running') return r.data.job
    }
    await new Promise((res) => setTimeout(res, 1500))
  }
  return null
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

/**
 * `detect` = the first half of the sequence only: read the watched companies' cases and let the server work out which
 * ones really need a look, leaving them «ready» — nothing is scraped until the user presses «Boshlash» on the pill.
 * Without it the run scrapes at once (the button, or the idle auto-check).
 */
export async function checkWatchlistOrders(opts: { auto: boolean; detect?: boolean; signal?: AbortSignal }): Promise<void> {
  if (current) return // one run at a time
  const list = watched()
  if (!list.length) {
    if (!opts.auto) toast.info('Kuzatuv roʻyxati boʻsh')
    return
  }
  const ac = new AbortController()
  current = ac
  opts.signal?.addEventListener('abort', () => ac.abort(), { once: true })
  set({ phase: 'collecting', done: 0, total: list.length, auto: opts.auto, paused: false, detect: opts.detect === true })

  let ongoing = 0
  let known = 0
  try {
    for (const rec of list) {
      while (state.paused && !ac.signal.aborted) await sleep(300) // paused: hold before the next company
      if (ac.signal.aborted) break
      const r = await getStats(rec.stir, { signal: ac.signal }).catch(() => null)
      if (r && r.ok) {
        const items = payloadOf(r.data.cases ?? [])
        if (items.length) {
          const q = await fetchPublicOrders(items, { keepPaused: true, hold: opts.detect === true })
          if (q.ok) {
            ongoing += q.data.ongoing
            known += q.data.known
          }
        }
      }
      set({ done: state.done + 1 })
    }
  } finally {
    current = null
    set({ phase: 'idle', paused: false, detect: false })
  }
  if (opts.detect) return // detection announces nothing: the pill says what is waiting
  if (opts.auto && !ac.signal.aborted) markAutoRun() // an interrupted run does not use up the 6 h allowance
  // a run the user (or their coming back) cut short says nothing: the queue keeps going and the pill shows it
  if (ac.signal.aborted) return

  // tell the user how it went (auto runs stay silent unless something new arrived)
  const note = ongoing ? ` · ${ongoing} ta ish hali birinchi instansiyada koʻrilmoqda (qaror yoʻq)` : ''
  const job = await waitForJob(new AbortController().signal) // null while paused / held: nothing is announced then
  if (!job) return
  if (job.found > 0) toast.success(`${job.found} ta yangi qaror yuklandi${note}`)
  else if (job.searched > 0) {
    if (!opts.auto) toast.info('Yangi eʼlon qilingan qaror topilmadi' + note)
  } else if (!opts.auto) {
    toast.info(
      known || ongoing
        ? `Yangi tekshiradigan ish yoʻq${known ? `: ${known} ta ish allaqachon maʼlum` : ''}${ongoing ? `${known ? ', ' : ': '}${ongoing} ta hali birinchi instansiyada koʻrilmoqda` : ''}`
        : 'Kuzatuvdagi kompaniyalarda ish topilmadi',
    )
  }
  if (job.errors > 0 && !opts.auto) toast.error(`${job.errors} ta ishni tekshirib boʻlmadi — “Qayta urinish” tugmasi bilan yana urinish mumkin`)
}
