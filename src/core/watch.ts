/**
 * Kuzatuv (the watch): what counts as news in a company's court list, and the message that tells the operator. Pure: no network, no disk.
 *
 * A company's court lists (economic, civil, administrative) are read again every few hours. Each row is remembered by a SIGNATURE (status, result,
 * next hearing, which instance the hearing belongs to). Against what was remembered, a row is:
 *   new        a case number never seen: «sudga yangi ariza topshirildi»
 *   instance   the case reached a higher instance (appeal, cassation, supervision): known from the case DETAIL
 *   hearing    a hearing date or time that is new or moved
 *   status     the court's status word changed (tayinlash, ish yuritishga qabul …)
 * The first read of a company is the BASELINE: everything is remembered and nothing is announced (it would be hundreds of «new» cases).
 * Which side the company is comes from the parties' TINs in the case detail (exact); without a detail, from the names (`core/classify`).
 */

import type { CourtCase, FullCaseData } from '@/lib/court-case-types'
import { samePartyName } from './classify'
import { uzCyrToLat } from './translit'

export type WatchKind = 'new' | 'instance' | 'hearing' | 'status'

/** what is remembered about one case */
export interface SeenRow {
  sig: string
  /** the instances the detail showed last time (see `instancesOf`; '' = none), or null when no detail was ever read (then an instance is only recorded, never announced) */
  ins: string | null
}

/** a row's signature: change any part and the case is news */
export function rowSig(r: Pick<CourtCase, 'caseStatus' | 'result' | 'hearingDate' | 'hearingTime' | 'hearingStage'>): string {
  return [r.caseStatus, r.result, r.hearingDate, r.hearingTime, r.hearingStage ?? ''].map((x) => (x ?? '').trim()).join('|')
}

/** `A` appeal, `C` cassation, `I` supervision: the higher instances a case detail shows (the first instance is every case's) */
export function instancesOf(d: FullCaseData | null | undefined): string {
  if (!d) return ''
  return `${d.appellate ? 'A' : ''}${d.cassation ? 'C' : ''}${d.inspection ? 'I' : ''}`
}

export const INSTANCE_WORD: Record<string, string> = { A: 'Apellyatsiya', C: 'Kassatsiya', I: 'Taftish' }

/**
 * What a row is against what was remembered. `null` = nothing new. The instance kind cannot be told from a row alone: it is decided from the detail
 * by `instanceEvent`; here a changed row only says WHAT to look at (`recheck`).
 */
export function diffRow(prev: SeenRow | undefined, row: CourtCase): { kind: WatchKind | null; recheck: boolean } {
  if (!prev) return { kind: 'new', recheck: true }
  const sig = rowSig(row)
  if (sig === prev.sig) return { kind: null, recheck: false }
  const old = prev.sig.split('|')
  const now = sig.split('|')
  // status (0) / result (1) changed → status; the hearing (2, 3, 4) moved → hearing; either way the detail is read again (an appeal shows there)
  const kind: WatchKind = old[0] !== now[0] || old[1] !== now[1] ? 'status' : 'hearing'
  return { kind, recheck: true }
}

/** an instance that is new since the last detail (a case that had none and now has an appeal): the first one that appeared */
export function instanceEvent(prevIns: string | null, d: FullCaseData | null): string | null {
  if (prevIns === null) return null // never read before: a case may have been appealed long ago, that is not news
  const now = instancesOf(d)
  for (const c of now) if (!prevIns.includes(c)) return c
  return null
}

export type Role = 'plaintiff' | 'defendant' | ''

export interface Sides {
  role: Role
  plaintiff: { name: string; tin: string }
  defendant: { name: string; tin: string }
  /** how the role was decided: the TIN in the detail, the names, or not at all */
  by: 'tin' | 'name' | 'none'
}

const clean = (s: string | undefined | null): string => {
  const t = (s ?? '').trim()
  return t === '-' ? '' : t
}

/** The company's side of a case. A party's TIN in the detail decides (exact); otherwise the names (`companyName`), when exactly one party matches. */
export function sidesOf(tin: string, companyName: string, row: CourtCase, detail: FullCaseData | null): Sides {
  const g = detail?.general
  const plaintiff = { name: clean(g?.plaintiff) || clean(row.plaintiff), tin: clean(g?.plaintiffTin) }
  const defendant = { name: clean(g?.defendant) || clean(row.defendant), tin: clean(g?.defendantTin) }
  if (plaintiff.tin === tin && defendant.tin !== tin) return { role: 'plaintiff', plaintiff, defendant, by: 'tin' }
  if (defendant.tin === tin && plaintiff.tin !== tin) return { role: 'defendant', plaintiff, defendant, by: 'tin' }
  if (companyName) {
    const p = samePartyName(companyName, plaintiff.name)
    const d = samePartyName(companyName, defendant.name)
    if (p && !d) return { role: 'plaintiff', plaintiff, defendant, by: 'name' }
    if (d && !p) return { role: 'defendant', plaintiff, defendant, by: 'name' }
  }
  return { role: '', plaintiff, defendant, by: 'none' }
}

export interface WatchEvent {
  kind: WatchKind
  /** for `instance`: A | C | I */
  instance?: string
  tin: string
  companyName: string
  courtType: string
  row: CourtCase
  detail: FullCaseData | null
  sides: Sides
}

const lat = (s: string): string => uzCyrToLat(s)
const ROLE_WORD: Record<string, string> = { plaintiff: 'daʼvogarsiz', defendant: 'javobgarsiz' }
const COURT_WORD: Record<string, string> = { economic: 'Iqtisodiy', civil: 'Fuqarolik', administrative: 'Maʼmuriy' }

/** HTML-safe text: a party's name may hold any character, and the message is sent as Telegram HTML */
export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const party = (label: string, p: { name: string; tin: string }): string => (p.name ? `<b>${label}:</b> ${escapeHtml(lat(p.name))}${p.tin ? ` <i>(STIR ${escapeHtml(p.tin)})</i>` : ''}` : '')

/** the status line: the court's status, and the deadline when the court gave one («Muddat»). Telegram HTML. */
export function statusLine(row: CourtCase, detail: FullCaseData | null): string {
  const g = detail?.general
  const status = lat(clean(g?.caseStatus) || clean(row.caseStatus))
  const deadline = clean(g?.deadlineDate)
  return `<b>Holati:</b> ${escapeHtml(status || 'nomaʼlum')}${deadline ? ` · <b>Muddat:</b> ${escapeHtml(deadline)}` : ''}`
}

/**
 * The message the operator reads, as Telegram HTML (the same look as the bot's reminders): a bold headline, then who you are in the case, the case
 * number (tap to copy), both parties, the status and deadline, the hearing, and a dim line saying which company it came from. Latin Uzbek; every
 * piece of data is escaped.
 */
export function buildMessage(ev: WatchEvent): string {
  const { row, sides } = ev
  const head =
    ev.kind === 'new'
      ? '⚖️ <b>Sudga yangi ariza topshirildi</b>'
      : ev.kind === 'instance'
        ? `⚖️ <b>${INSTANCE_WORD[ev.instance ?? ''] ?? 'Yuqori instansiya'}ga shikoyat topshirildi</b>`
        : ev.kind === 'hearing'
          ? '📅 <b>Majlis sanasi yangilandi</b>'
          : '🔔 <b>Ish holati oʻzgardi</b>'
  const side = sides.role ? `<b>Siz: ${ROLE_WORD[sides.role]}</b>` : ''
  const hearing = [clean(row.hearingDate), clean(row.hearingTime)].filter(Boolean).join(' ')
  const case_ = `<b>Ish:</b> <code>${escapeHtml(row.caseNumber)}</code>${COURT_WORD[ev.courtType] ? ` · ${COURT_WORD[ev.courtType]}` : ''}`
  const body = [side, case_, party('Daʼvogar', sides.plaintiff), party('Javobgar', sides.defendant), statusLine(row, ev.detail), hearing && ev.kind !== 'status' ? `<b>Majlis:</b> ${escapeHtml(hearing)}` : '']
    .filter(Boolean)
    .join('\n')
  const from = ev.companyName ? `Kuzatuv: ${escapeHtml(lat(ev.companyName))} (STIR ${escapeHtml(ev.tin)})` : `Kuzatuv: STIR ${escapeHtml(ev.tin)}`
  return `${head}\n\n${body}\n\n<i>${from}</i>`
}

/** a long run is cut: at most `max` messages, then one that says how many more there are */
export function overflowMessage(n: number, tin: string): string {
  return `…yana <b>${n}</b> ta yangi xabar bor <i>(STIR ${escapeHtml(tin)})</i>. Ilovada «Sud ishlari» ni oching.`
}

// ---- the setting --------------------------------------------------------------------------------------------------------------------------

export interface WatchConfig {
  enabled: boolean
  /** how often the lists are read again, in hours (1 to 48) */
  intervalHours: number
  /** the companies watched; null = every company the database knows */
  tins: string[] | null
  /** Telegram user ids that get the messages */
  recipients: number[]
}

export const WATCH_DEFAULT: WatchConfig = { enabled: false, intervalHours: 6, tins: null, recipients: [] }

/** A setting from a form (a partial body keeps what it does not name). `null` = refused. Ids may come as a text of numbers. */
export function parseWatchConfig(raw: unknown, prev: WatchConfig = WATCH_DEFAULT): WatchConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const out: WatchConfig = { ...prev }
  if ('enabled' in o) {
    if (typeof o.enabled !== 'boolean') return null
    out.enabled = o.enabled
  }
  if ('intervalHours' in o) {
    const n = Number(o.intervalHours)
    if (!Number.isFinite(n) || n < 1 || n > 48) return null
    out.intervalHours = Math.round(n * 2) / 2
  }
  if ('tins' in o) {
    if (o.tins === null) out.tins = null
    else {
      const list = Array.isArray(o.tins) ? o.tins : typeof o.tins === 'string' ? o.tins.split(/[\s,;]+/) : null
      if (!list) return null
      const tins = [...new Set(list.map((t) => String(t).trim()).filter(Boolean))]
      if (tins.some((t) => !/^\d{9}$/.test(t)) || tins.length > 100) return null
      out.tins = tins.length ? tins : null
    }
  }
  if ('recipients' in o) {
    const list = Array.isArray(o.recipients) ? o.recipients : typeof o.recipients === 'string' ? o.recipients.split(/[\s,;]+/) : null
    if (!list) return null
    const ids = [...new Set(list.map((x) => String(x).trim()).filter(Boolean))]
    if (ids.some((x) => !/^\d{3,15}$/.test(x)) || ids.length > 10) return null
    out.recipients = ids.map(Number)
  }
  return out
}
