import 'server-only'
import crypto from 'node:crypto'
import { getDb } from './db'
import { backupBusy, backupState } from './backup'
import { backupNow, type BackupNow } from './auto-backup'
import { billJobRunning, jobDone, startJob } from './bill-cases'
import { clearCourtCaseCache, searchCourtCasesDetailed } from './court-case'
import { ManualDownloadRequired } from './public-orders/order-pdf'
import { loadOrderPdf } from './public-orders/pdf-load'
import { readPdf } from './public-orders/pdf-store'
import { allOrders } from './public-orders/store'
import { isOrderFileId } from '@/core/public-orders'
import type { CourtType } from './court-case-types'
import { retireCaseSnapshots } from './snapshot-store'
import { readTelegram } from './telegram-config'
import { watchRunning } from './watch'
import { logger } from '@/infra/logger'

/**
 * THE LINK WITH THE BOT («Bot bilan ulanish»). The app (this computer) is the scraper and the writer; the bot on Render only reads the Telegram backup.
 * Two things the link adds, both OUTBOUND from this computer (no open port, nothing listens):
 *
 *  1. After every successful backup the app tells the bot («/link/synced»), so the bot reads the new manifest at once instead of at its next look.
 *  2. Every minute the app asks the bot «anything for me?» («/link/pull»). A person's `/refresh STIR` in Telegram waits there; the app reads that
 *     company's court lists again (and re-asks its open cases), takes a backup right away (`backupNow`, no 15-minute gap) and reports back, and the bot
 *     tells the person once it has read the backup. A «Yuklash» pressed under an order that was found but never downloaded is the same kind of job: the app
 *     downloads that one PDF (through the same loader as the Qarorlar page: one captcha at a time, and the pause after a refusal), backs up, and the bot
 *     sends the file. When the site wants a person, the job fails with the way to hand the file over (HAR) and nothing is retried.
 *
 * Opt-in: nothing is sent and nothing is asked until the setting is on (and a bot address is given). Each call is signed with a key derived from the bot
 * token (`HMAC-SHA256(token, "sud-link-v1")`, over time + path + body), so there is no new secret to keep. The bot's answer is never trusted beyond a
 * STIR of nine digits and a number.
 */

const log = logger('bot-link')

const META = 'bot_link'
export const POLL_MS = 60_000
const LIST_GAP_MS = 2_500
const COURTS: readonly CourtType[] = ['economic', 'civil', 'administrative']

export interface LinkConfig {
  enabled: boolean
  /** the bot's public address, e.g. https://sud-bot.onrender.com (no path) */
  url: string
}
const OFF: LinkConfig = { enabled: false, url: '' }

/** `https://host` only (plain http only for localhost, for a bot run on this computer); no path, no credentials. null = not an address */
export function normalizeBotUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return null
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
  if (u.username || u.password || !u.hostname) return null
  return u.origin
}

export function readLink(): LinkConfig {
  try {
    const r = getDb().prepare('SELECT v FROM meta WHERE k = ?').get(META)
    if (!r) return OFF
    const c = JSON.parse(String(r.v)) as Partial<LinkConfig>
    const url = normalizeBotUrl(c.url)
    return { enabled: c.enabled === true && !!url, url: url ?? '' }
  } catch {
    return OFF
  }
}

export function saveLink(cfg: LinkConfig): void {
  getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(META, JSON.stringify(cfg))
}

// ---- the signature (the bot checks the same) ------------------------------------------------------------------------------------------------

export const linkKey = (token: string): Buffer => crypto.createHmac('sha256', token).update('sud-link-v1').digest()

/** hex of HMAC(key, "<ts>\n<path>\n" + body) */
export const signLink = (token: string, ts: number, path: string, body: string): string =>
  crypto.createHmac('sha256', linkKey(token)).update(`${ts}\n${path}\n`).update(body).digest('hex')

// ---- what happens on a tick ------------------------------------------------------------------------------------------------------------------

export interface Reply {
  ok: boolean
  jobs?: unknown
  error?: string
}

export interface Finished {
  id: number
  ok: boolean
  note: string
  /** when the company was read: a backup STARTED after this holds it */
  at: number
}

export interface BackupView {
  busy: boolean
  /** a backup (not a restore) ended well: when it started and its id */
  doneStartedAt: number
  doneId: string
}

export interface LinkDeps {
  now: () => number
  config: () => LinkConfig
  hasToken: () => boolean
  post: (path: '/link/pull' | '/link/synced', body: unknown) => Promise<Reply>
  /** read one company's court lists again and re-ask its open cases */
  refresh: (tin: string) => Promise<{ ok: boolean; note: string }>
  /** download one order's PDF (a found order that was never downloaded) */
  downloadOrder: (pdfId: string) => Promise<{ ok: boolean; note: string }>
  /** the bills job or Kuzatuv is running: wait for them */
  working: () => boolean
  backup: () => BackupView
  backupNow: () => BackupNow
}

export interface LinkStatus {
  enabled: boolean
  url: string
  hasBot: boolean
  /** epoch ms of the last answer from the bot to «anything for me?» (0 = none yet since the start) */
  lastPullAt: number
  lastPingAt: number
  lastError: string | null
  queued: number
  running: string | null
}

interface Slot {
  todo: LinkJob[]
  running: string | null
  awaiting: Finished[]
  ticking: boolean
  lastPingedId: string
  lastPullAt: number
  lastPingAt: number
  lastError: string | null
  timer?: ReturnType<typeof setInterval>
}
const g = globalThis as unknown as { __sudBotLink?: Slot }
const slot = (): Slot => (g.__sudBotLink ??= { todo: [], running: null, awaiting: [], ticking: false, lastPingedId: '', lastPullAt: 0, lastPingAt: 0, lastError: null })
/** tests start from nothing */
export const forgetLink = (): void => {
  const s = g.__sudBotLink
  if (s?.timer) clearInterval(s.timer)
  g.__sudBotLink = undefined
}

const TIN = /^\d{9}$/

/** a job the bot asks for: refresh a company (`tin`) or download one order's PDF (`pdfId`) */
export type LinkJob = { id: number; tin: string } | { id: number; pdfId: string }

/** the jobs in the bot's answer, checked: a whole number id and a STIR of nine digits, or an order file id of the shapes the app writes; anything else is dropped */
export function parseJobs(v: unknown): LinkJob[] {
  if (!Array.isArray(v)) return []
  const out: LinkJob[] = []
  for (const j of v.slice(0, 50)) {
    const o = j as { id?: unknown; tin?: unknown; kind?: unknown; pdfId?: unknown }
    if (typeof o?.id !== 'number' || !Number.isSafeInteger(o.id) || o.id <= 0) continue
    if (o.kind === 'order') {
      if (typeof o.pdfId === 'string' && isOrderFileId(o.pdfId)) out.push({ id: o.id, pdfId: o.pdfId.toLowerCase() })
    } else if (typeof o.tin === 'string' && TIN.test(o.tin)) out.push({ id: o.id, tin: o.tin })
  }
  return out
}

const NO_BACKUP = 'Avtomatik zaxira yoqilmagan: yangilash zaxiraga yozilmadi (Sozlamalar › Telegram › Avtomatik zaxira)'

async function ping(d: LinkDeps, s: Slot, done: Finished[]): Promise<boolean> {
  const r = await d.post('/link/synced', { done: done.map((f) => ({ id: f.id, ok: f.ok, note: f.note })) })
  if (r.ok) {
    s.lastPingAt = d.now()
    return true
  }
  s.lastError = r.error ?? 'Bot javob bermadi'
  return false
}

/** One look. Never throws; one at a time. */
export async function linkTick(d: LinkDeps): Promise<void> {
  const s = slot()
  if (s.ticking) return
  const cfg = d.config()
  if (!cfg.enabled || !cfg.url || !d.hasToken()) return
  s.ticking = true
  try {
    // 1. anything for me? (this is also how the bot knows the app is on)
    const r = await d.post('/link/pull', {})
    if (r.ok) {
      s.lastPullAt = d.now()
      s.lastError = null
      for (const j of parseJobs(r.jobs)) if (!s.todo.some((t) => t.id === j.id) && s.running !== ('tin' in j ? j.tin : j.pdfId)) s.todo.push(j)
    } else {
      s.lastError = r.error ?? 'Bot javob bermadi'
    }

    // 2. one company at a time, and not while the bills job or Kuzatuv is using the sites
    if (!s.running && s.todo.length && !d.working()) {
      const job = s.todo.shift()!
      const label = 'tin' in job ? job.tin : job.pdfId
      s.running = label
      void ('tin' in job ? d.refresh(job.tin) : d.downloadOrder(job.pdfId))
        .catch((e) => ({ ok: false, note: e instanceof Error ? e.message.slice(0, 200) : 'xato' }))
        .then((res) => {
          s.awaiting.push({ id: job.id, ok: res.ok, note: res.note, at: d.now() })
        })
        .finally(() => {
          s.running = null
        })
    }

    // 3. what the bot should hear: a failed run needs no backup; a good one needs a backup that STARTED after it
    const failed = s.awaiting.filter((f) => !f.ok)
    if (failed.length && (await ping(d, s, failed))) s.awaiting = s.awaiting.filter((f) => f.ok)
    const bk = d.backup()
    if (bk.busy) return
    const covered = s.awaiting.filter((f) => bk.doneStartedAt > 0 && bk.doneStartedAt >= f.at)
    const fresh = bk.doneId !== '' && bk.doneId !== s.lastPingedId
    if (covered.length || fresh) {
      if (await ping(d, s, covered)) {
        s.lastPingedId = bk.doneId
        s.awaiting = s.awaiting.filter((f) => !covered.includes(f))
      }
      return
    }
    if (s.awaiting.length) {
      const now = d.backupNow()
      if (now === 'unchanged') {
        // nothing new since the last automatic backup: what the channel holds is already the whole database
        if (await ping(d, s, s.awaiting)) s.awaiting = []
      } else if (now === 'unavailable') {
        const all = s.awaiting.map((f) => ({ ...f, ok: false, note: NO_BACKUP }))
        if (await ping(d, s, all)) s.awaiting = []
      }
    }
  } catch (e) {
    s.lastError = e instanceof Error ? e.message.slice(0, 200) : String(e)
  } finally {
    s.ticking = false
  }
}

// ---- the real thing ---------------------------------------------------------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function refreshCompany(tin: string): Promise<{ ok: boolean; note: string }> {
  const errors: string[] = []
  let read = 0
  for (const court of COURTS) {
    try {
      clearCourtCaseCache(tin) // a fresh read, never the ten-minute memory
      const res = await searchCourtCasesDetailed(court, 'tin', tin)
      if (res.incomplete) errors.push(`${court}: roʻyxat toʻliq emas`)
      else read++
    } catch (e) {
      errors.push(`${court}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 150))
    }
    await sleep(LIST_GAP_MS)
  }
  if (read === 0) return { ok: false, note: errors[0] ?? 'Sud roʻyxatlari oʻqilmadi' }
  // the open cases found earlier are asked again (an appeal or a new date the list row does not show); best effort
  try {
    if (!billJobRunning()) {
      startJob(tin, { refresh: 'open' })
      await jobDone()
    }
  } catch (e) {
    log.warn('refresh of open cases failed', { tin, error: e instanceof Error ? e.message : String(e) })
  }
  try {
    retireCaseSnapshots(tin)
  } catch {
    /* the copies expire after a day */
  }
  return { ok: true, note: read < COURTS.length ? `${read}/${COURTS.length} sud oʻqildi` : '' }
}

const MANUAL_NOTE = 'Sayt qarorni faqat odam tasdiqlagandan keyin beradi. Kompyuterda: brauzerda qarorni oching, HAR faylni Qarorlar › «HAR fayldan yuklash» orqali yuklang: bot faylni oʻzi yuboradi.'

/** One order's PDF for the phone: only an order the app KNOWS (its record is in the store), once, through the shared loader; a refusal is reported with the way out, never retried. */
export async function downloadOrder(pdfId: string, load: (id: string) => Promise<{ saved: boolean; saveError?: string }> = loadOrderPdf): Promise<{ ok: boolean; note: string }> {
  const id = pdfId.toLowerCase()
  if (!(await allOrders()).some((o) => (o.pdfId ?? '').toLowerCase() === id)) return { ok: false, note: 'Bu qaror ilovada topilmadi: avval ishni ilovada tekshiring.' }
  if (await readPdf(id)) return { ok: true, note: '' } // already on disk: only the backup is left
  try {
    const r = await load(id)
    return r.saved ? { ok: true, note: '' } : { ok: false, note: `PDF diskka saqlanmadi: ${r.saveError ?? ''}`.slice(0, 200) }
  } catch (e) {
    if (e instanceof ManualDownloadRequired) return { ok: false, note: MANUAL_NOTE }
    return { ok: false, note: e instanceof Error ? e.message.slice(0, 200) : 'Qarorni yuklab boʻlmadi' }
  }
}

async function realPost(path: '/link/pull' | '/link/synced', body: unknown): Promise<Reply> {
  const cfg = readLink()
  const tg = readTelegram()
  if (!cfg.url || !tg) return { ok: false, error: 'Bot manzili yoki tokeni yoʻq' }
  const text = JSON.stringify(body)
  const ts = Math.floor(Date.now() / 1000)
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sud-ts': String(ts), 'x-sud-sig': signLink(tg.token, ts, path, text) },
      body: text,
      signal: AbortSignal.timeout(20_000), // a sleeping free-plan bot wakes within ~a minute
      cache: 'no-store',
    })
    const j = (await res.json().catch(() => null)) as { ok?: unknown; jobs?: unknown; error?: unknown } | null
    if (res.status === 401) return { ok: false, error: 'Bot imzoni qabul qilmadi: bot tokeni ikkala joyda bir xilmi?' }
    if (!res.ok || j?.ok !== true) return { ok: false, error: typeof j?.error === 'string' ? j.error.slice(0, 200) : `Bot javobi: HTTP ${res.status}` }
    return { ok: true, jobs: j.jobs }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? (e.name === 'TimeoutError' ? 'Bot javob bermadi (vaqt tugadi)' : e.message.slice(0, 200)) : 'Botga ulanib boʻlmadi' }
  }
}

const REAL: LinkDeps = {
  now: Date.now,
  config: readLink,
  hasToken: () => readTelegram() !== null,
  post: realPost,
  refresh: refreshCompany,
  downloadOrder,
  working: () => billJobRunning() || watchRunning(),
  backup: () => {
    const b = backupState()
    const ok = b.kind === 'backup' && b.phase === 'done' && !!b.result
    return { busy: backupBusy(), doneStartedAt: ok ? b.startedAt : 0, doneId: ok ? b.result!.id : '' }
  },
  backupNow: () => backupNow(),
}

export function linkStatus(): LinkStatus {
  const s = slot()
  const cfg = readLink()
  return { enabled: cfg.enabled, url: cfg.url, hasBot: readTelegram() !== null, lastPullAt: s.lastPullAt, lastPingAt: s.lastPingAt, lastError: s.lastError, queued: s.todo.length + s.awaiting.length, running: s.running }
}

/** switch on (with the bot's address) or off */
export function setLink(enabled: boolean, url?: string): { ok: true } | { ok: false; error: string } {
  if (!enabled) {
    saveLink({ ...readLink(), enabled: false })
    return { ok: true }
  }
  const u = normalizeBotUrl(url ?? readLink().url)
  if (!u) return { ok: false, error: 'Bot manzili https://… koʻrinishida boʻlishi kerak' }
  const s = slot()
  s.lastError = null
  saveLink({ enabled: true, url: u })
  return { ok: true }
}

export function startBotLink(): void {
  const s = slot()
  if (s.timer) return
  s.timer = setInterval(() => void linkTick(REAL), POLL_MS)
  s.timer.unref?.()
}

/** a first look straight after switching on, so the status fills in without waiting a minute */
export const linkNow = (): Promise<void> => linkTick(REAL)
