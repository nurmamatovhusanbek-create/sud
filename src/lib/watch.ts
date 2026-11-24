import 'server-only'
import { isConcludedStatus } from '@/core/case-status'
import { buildMessage, diffRow, instanceEvent, instancesOf, overflowMessage, rowSig, sidesOf, type WatchConfig, type WatchEvent } from '@/core/watch'
import type { CourtCase, CourtType, FullCaseData } from './court-case-types'
import { clearCourtCaseCache, getCaseLean, searchCourtCasesDetailed, type CaseLean, type CourtListResult } from './court-case'
import { companyNameOf } from './db-buckets'
import { readTelegram } from './telegram-config'
import { sendMessage } from './telegram-client'
import { hasBaseline, knownTins, markBaseline, readLastRun, readSeen, readWatchConfig, saveLastRun, writeSeen, type WatchRunSummary } from './watch-store'
import { logger } from '@/infra/logger'

/**
 * KUZATUV: every few hours, read each watched company's court lists again and tell the operator on Telegram what is NEW: a case filed against or by the
 * company, a case that reached an appeal / cassation / supervision, a moved hearing, a changed status. It runs INSIDE the app (the court sites are
 * reached through the app's own routes and pacing), so the computer the app runs on must stay on; the Render bot never scrapes.
 *
 * Opt-in: nothing runs unless the setting says `enabled` (Settings › Telegram › Kuzatuv). The first read of a company is silent (the baseline). What is
 * announced is remembered only after a message went out, so a failed send is tried again at the next run, never lost. Rules: `core/watch`.
 */

const log = logger('watch')

const COURTS: readonly CourtType[] = ['economic', 'civil', 'administrative']
/** at most this many messages per company per run; the rest go out at the next run */
export const MAX_MESSAGES = 15
/** open cases whose detail is read again per company per run (an appeal that the list row does not show), and how old a read must be */
export const SWEEP_PER_RUN = 15
export const SWEEP_AGE_MS = 24 * 3_600_000
const LIST_GAP_MS = 2_500
const DETAIL_GAP_MS = 2_600
const SEND_GAP_MS = 1_100

export interface WatchDeps {
  list: (courtType: CourtType, tin: string) => Promise<CourtListResult>
  detail: (courtType: CourtType, caseNumber: string) => Promise<CaseLean>
  /** one message to one person; true = it went out */
  send: (chat: number, text: string) => Promise<boolean>
  name: (tin: string) => string
  now: () => number
  sleep: (ms: number) => Promise<void>
}

interface Pending {
  ev: WatchEvent
  sig: string
  ins: string | undefined
}

const PRIORITY: Record<string, number> = { new: 0, instance: 1, hearing: 2, status: 3 }

/** Read one company's lists, find the news, announce it. Returns what happened (the counts are added to the run's). */
async function watchCompany(tin: string, cfg: WatchConfig, d: WatchDeps, run: WatchRunSummary): Promise<void> {
  const name = d.name(tin)
  const seen = readSeen(tin)
  const pending: Pending[] = []
  const changed = new Set<string>()
  const openRows: Array<{ court: CourtType; row: CourtCase }> = []

  for (const court of COURTS) {
    let res: CourtListResult
    try {
      res = await d.list(court, tin)
    } catch (e) {
      run.errors.push(`${tin} ${court}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200))
      await d.sleep(LIST_GAP_MS)
      continue
    }
    await d.sleep(LIST_GAP_MS)
    // an incomplete list says nothing about what is NOT in it, and must not become a baseline
    if (res.incomplete) {
      run.errors.push(`${tin} ${court}: roʻyxat toʻliq emas`)
      continue
    }
    const baseline = !hasBaseline(tin, court)
    for (const row of res.cases) {
      if (!row.caseNumber) continue
      run.rows++
      const sig = rowSig(row)
      const prev = seen.get(row.caseNumber)
      if (baseline) {
        writeSeen(tin, row.caseNumber, court, sig, { now: d.now() })
        run.baselines++
        continue
      }
      if (!isConcludedStatus(row.caseStatus)) openRows.push({ court, row })
      const diff = diffRow(prev, row)
      if (!diff.kind) continue
      let det: FullCaseData | null = null
      const r = await d.detail(court, row.caseNumber).catch((): CaseLean => ({ kind: 'error', message: 'detail' }))
      await d.sleep(DETAIL_GAP_MS)
      if (r.kind === 'found') det = r.data
      let kind = diff.kind
      let instance: string | undefined
      if (prev && det) {
        const ie = instanceEvent(prev.ins, det)
        if (ie) {
          kind = 'instance'
          instance = ie
        }
      }
      changed.add(row.caseNumber)
      pending.push({ ev: { kind, ...(instance ? { instance } : {}), tin, companyName: name, courtType: court, row, detail: det, sides: sidesOf(tin, name, row, det) }, sig, ins: det ? instancesOf(det) : undefined })
    }
    if (baseline) markBaseline(tin, court)
  }

  // the sweep: an open case whose row did not change may still have been appealed; its detail is read again, a few per run, oldest read first
  const stale = openRows
    .filter((o) => !changed.has(o.row.caseNumber) && (seen.get(o.row.caseNumber)?.checkedAt ?? 0) < d.now() - SWEEP_AGE_MS)
    .sort((a, b) => (seen.get(a.row.caseNumber)?.checkedAt ?? 0) - (seen.get(b.row.caseNumber)?.checkedAt ?? 0))
    .slice(0, SWEEP_PER_RUN)
  for (const o of stale) {
    const r = await d.detail(o.court, o.row.caseNumber).catch((): CaseLean => ({ kind: 'error', message: 'detail' }))
    await d.sleep(DETAIL_GAP_MS)
    if (r.kind !== 'found') continue
    const prev = seen.get(o.row.caseNumber)
    const ie = prev ? instanceEvent(prev.ins, r.data) : null
    if (ie && prev) {
      pending.push({ ev: { kind: 'instance', instance: ie, tin, companyName: name, courtType: o.court, row: o.row, detail: r.data, sides: sidesOf(tin, name, o.row, r.data) }, sig: rowSig(o.row), ins: instancesOf(r.data) })
    } else {
      writeSeen(tin, o.row.caseNumber, o.court, prev?.sig ?? rowSig(o.row), { ins: instancesOf(r.data), checkedAt: d.now(), now: d.now() })
    }
  }

  if (!pending.length) return
  run.events += pending.length
  if (!cfg.recipients.length) {
    run.errors.push('Xabar oluvchi koʻrsatilmagan: yangiliklar keyingi safar yuboriladi')
    return // nothing is remembered: they are announced once there is somebody to tell
  }
  pending.sort((a, b) => PRIORITY[a.ev.kind]! - PRIORITY[b.ev.kind]! || (a.ev.row.caseNumber < b.ev.row.caseNumber ? -1 : 1))
  const now = d.now()
  for (const p of pending.slice(0, MAX_MESSAGES)) {
    let ok = false
    for (const chat of cfg.recipients) {
      if (await d.send(chat, buildMessage(p.ev))) ok = true
      await d.sleep(SEND_GAP_MS)
    }
    if (ok) {
      run.sent++
      writeSeen(tin, p.ev.row.caseNumber, p.ev.courtType, p.sig, { ...(p.ins !== undefined ? { ins: p.ins } : {}), checkedAt: p.ins !== undefined ? now : undefined, now })
    } else run.errors.push(`${tin} ${p.ev.row.caseNumber}: xabar yuborilmadi`)
  }
  if (pending.length > MAX_MESSAGES) {
    for (const chat of cfg.recipients) {
      await d.send(chat, overflowMessage(pending.length - MAX_MESSAGES, tin))
      await d.sleep(SEND_GAP_MS)
    }
  }
}

/** One full pass over the watched companies. Never throws: a company that fails is reported and the next one is read. */
export async function runWatch(d: WatchDeps, cfg: WatchConfig, tins: string[]): Promise<WatchRunSummary> {
  const t0 = d.now()
  const run: WatchRunSummary = { at: t0, ms: 0, companies: 0, rows: 0, events: 0, sent: 0, baselines: 0, errors: [] }
  for (const tin of tins) {
    try {
      await watchCompany(tin, cfg, d, run)
      run.companies++
    } catch (e) {
      run.errors.push(`${tin}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200))
    }
  }
  run.ms = d.now() - t0
  run.errors = run.errors.slice(0, 20)
  return run
}

// ---- the real thing ---------------------------------------------------------------------------------------------------------------------

const g = globalThis as unknown as { __sudWatch?: { running: boolean; timer: ReturnType<typeof setInterval> | null } }
const slot = (): { running: boolean; timer: ReturnType<typeof setInterval> | null } => (g.__sudWatch ??= { running: false, timer: null })

export const watchRunning = (): boolean => slot().running

function realDeps(token: string): WatchDeps {
  return {
    list: (court, tin) => {
      clearCourtCaseCache(tin) // a fresh read, never the ten-minute memory
      return searchCourtCasesDetailed(court, 'tin', tin)
    },
    detail: (court, num) => getCaseLean(court, num),
    send: async (chat, text) => (await sendMessage(token, chat, text)).ok,
    name: (tin) => {
      try {
        return companyNameOf(tin) ?? ''
      } catch {
        return ''
      }
    },
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }
}

/** The companies to read: the ones the setting names, else every company the database knows. */
export const watchedTins = (cfg: WatchConfig): string[] => cfg.tins ?? knownTins()

/** Start a run now (a click, or the schedule). Returns an error text when it cannot start. */
export function startWatchRun(): { ok: true } | { ok: false; error: string } {
  const s = slot()
  if (s.running) return { ok: false, error: 'Kuzatuv allaqachon ishlayapti' }
  const tg = readTelegram()
  if (!tg) return { ok: false, error: 'Avval Telegram botini saqlang (Sozlamalar › Telegram)' }
  const cfg = readWatchConfig()
  const tins = watchedTins(cfg)
  if (!tins.length) return { ok: false, error: 'Kuzatiladigan kompaniya yoʻq' }
  s.running = true
  void runWatch(realDeps(tg.token), cfg, tins)
    .then((summary) => {
      saveLastRun(summary)
      log.info('watch run', { companies: summary.companies, rows: summary.rows, events: summary.events, sent: summary.sent, errors: summary.errors.length })
    })
    .catch((e) => log.warn('watch run failed', { error: e instanceof Error ? e.message : String(e) }))
    .finally(() => {
      s.running = false
    })
  return { ok: true }
}

/** a message to the recipients that proves the setting works (Settings › «Sinash») */
export async function sendWatchTest(): Promise<{ ok: boolean; sent: number; error?: string }> {
  const tg = readTelegram()
  const cfg = readWatchConfig()
  if (!tg) return { ok: false, sent: 0, error: 'Avval Telegram botini saqlang' }
  if (!cfg.recipients.length) return { ok: false, sent: 0, error: 'Xabar oluvchi koʻrsatilmagan' }
  let sent = 0
  for (const chat of cfg.recipients) if ((await sendMessage(tg.token, chat, '🔔 <b>Kuzatuv</b>: sinov xabari.\nSozlama ishlayapti: yangi ish, instansiya, majlis va holat oʻzgarishlari shu yerga keladi.')).ok) sent++
  return { ok: sent > 0, sent, ...(sent === 0 ? { error: 'Xabar yuborilmadi: oluvchi botga /start bosganmi?' } : {}) }
}

export function nextWatchAt(): number | null {
  const cfg = readWatchConfig()
  if (!cfg.enabled) return null
  const last = readLastRun()
  return (last?.at ?? 0) + cfg.intervalHours * 3_600_000
}

function tick(): void {
  try {
    const cfg = readWatchConfig()
    if (!cfg.enabled || slot().running) return
    const next = nextWatchAt()
    if (next !== null && Date.now() >= next) startWatchRun()
  } catch {
    /* a failed tick is tried again in a minute */
  }
}

/** Start the schedule (once per process). Does nothing until the setting is switched on. */
export function startWatchScheduler(): void {
  const s = slot()
  if (s.timer) return
  s.timer = setInterval(tick, 60_000)
  s.timer.unref?.()
}
