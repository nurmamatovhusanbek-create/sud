/**
 * The «Instansiyalar» track of a case: first instance, appeal, cassation, taftish. They are NOT a fixed chain a case must walk in order:
 * an appeal (about a month from the ruling) can be skipped and the case goes straight to cassation (months later), and taftish
 * (supervision) comes after whichever of them was the last. A step that was never used must therefore not read as a gap or a failure:
 *   done      the instance has a record (hearings or a ruling)
 *   skipped   no record, but a LATER instance has one: the complaint was not filed there, the case jumped over it
 *   open      no record yet and the filing window (counted from the last ruling) is still running: «N kun qoldi»
 *   closed    no record and the window has passed: «Berilmagan» (neutral: the court can restore a missed term for a good reason,
 *             so «too late» is never claimed)
 *   none      no record and no window to count (the case is still being heard, or the instance has no fixed window: taftish)
 * The windows are ESTIMATES for the hint only (appeal 1 month; cassation 6 months, 12 for administrative cases, where the law gave
 * a year after the appeal ruling); they never block anything and are not legal advice (see docs/design-notes.md).
 */

import { daysUntil, formatDmy, parseYmd } from './dates'

export type TrackKey = 'first' | 'appeal' | 'cassation' | 'inspection'
export type TrackState = 'done' | 'skipped' | 'open' | 'closed' | 'none'

export interface TrackInput {
  /** the instance has a record (hearings or a ruling) */
  has: boolean
  /** `dd.mm.yyyy` of its ruling, when it has one */
  decisionDate?: string
  /** it has a ruling (not just hearings) */
  decided?: boolean
}

export interface TrackStep {
  key: TrackKey
  state: TrackState
  /** short state word for the step */
  note: string
  /** the hint under the step (a tooltip) */
  hint: string
  /** the filing window's last day (`dd.mm.yyyy`) for `open` / `closed` */
  until?: string
  daysLeft?: number
  /** the case is in this instance now */
  current: boolean
  /** the line from this step to the next: solid (the case went on), dashed (it jumped over a skipped instance), none */
  link: 'solid' | 'dash' | 'none'
}

export const TRACK_ORDER: TrackKey[] = ['first', 'appeal', 'cassation', 'inspection']
export const TRACK_NAME: Record<TrackKey, string> = { first: 'Birinchi', appeal: 'Apellyatsiya', cassation: 'Kassatsiya', inspection: 'Taftish' }

export const APPEAL_MONTHS = 1
export const cassationMonths = (courtType: string): number => (courtType === 'administrative' ? 12 : 6)

/** `dd.mm.yyyy` + n calendar months, the day clamped to the month's length (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsDmy(dmy: string, n: number): string | null {
  const p = parseYmd(dmy)
  if (!p) return null
  const first = new Date(p.y, p.m - 1 + n, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return formatDmy(new Date(first.getFullYear(), first.getMonth(), Math.min(p.d, last)))
}

export function buildTrack(
  input: Partial<Record<TrackKey, TrackInput>>,
  opts: { courtType: string; current?: TrackKey; now?: Date },
): TrackStep[] {
  const now = opts.now ?? new Date()
  const has = (k: TrackKey) => !!input[k]?.has
  const idx = (k: TrackKey) => TRACK_ORDER.indexOf(k)
  const laterHas = (k: TrackKey) => TRACK_ORDER.slice(idx(k) + 1).some(has)
  const lastDone = TRACK_ORDER.reduce((n, k, i) => (has(k) ? i : n), -1)

  // the ruling a window is counted from: the latest ruling among the instances before this one
  const rulingBefore = (k: TrackKey): { date?: string; pending: boolean } => {
    let date: string | undefined
    let pending = false
    for (const p of TRACK_ORDER.slice(0, idx(k))) {
      const i = input[p]
      if (!i?.has) continue
      if (i.decisionDate) date = i.decisionDate
      else pending = true // heard there, no ruling yet: the next instance is not due
    }
    return { date: pending ? undefined : date, pending }
  }

  const states: { state: TrackState; note: string; hint: string; until?: string; daysLeft?: number }[] = TRACK_ORDER.map((k) => {
    const i = input[k]
    if (has(k)) {
      return i?.decided
        ? { state: 'done', note: 'Koʻrib chiqilgan', hint: i.decisionDate ? `Qaror: ${i.decisionDate}` : 'Qaror chiqarilgan' }
        : { state: 'done', note: 'Koʻrib chiqilmoqda', hint: 'Majlislar bor, qaror hali yoʻq' }
    }
    if (k === 'first') return { state: 'none', note: 'Maʼlumot yoʻq', hint: 'Birinchi instansiya yozuvi topilmadi (eski yozuv boʻlishi mumkin)' }
    if (laterHas(k)) {
      return { state: 'skipped', note: 'Oʻtkazilgan', hint: 'Bu instansiyaga shikoyat berilmagan: ish keyingisiga oʻtgan' }
    }
    if (k === 'appeal' || k === 'cassation') {
      const months = k === 'appeal' ? APPEAL_MONTHS : cassationMonths(opts.courtType)
      const base = rulingBefore(k)
      const until = base.date ? addMonthsDmy(base.date, months) : null
      if (!until) return { state: 'none', note: 'Hali yoʻq', hint: base.pending ? 'Avvalgi instansiyada qaror hali chiqmagan' : 'Qaror chiqqach shikoyat berish mumkin' }
      const left = daysUntil(until, now)
      const word = k === 'appeal' ? 'apellyatsiya' : 'kassatsiya'
      const why = ` (oxirgi qaror sanasidan ${months} oy; taxminiy). Uzrli sabab boʻlsa sud oʻtkazib yuborilgan muddatni tiklashi mumkin.`
      if (left !== null && left >= 0) return { state: 'open', note: left === 0 ? 'Bugun oxirgi kun' : `${left} kun qoldi`, hint: `${until} gacha ${word} shikoyati berish mumkin${why}`, until, daysLeft: left }
      return { state: 'closed', note: 'Berilmagan', hint: `${word[0].toUpperCase()}${word.slice(1)} shikoyati berilmagan; muddat ${until} da tugagan${why}`, until }
    }
    return { state: 'none', note: 'Hali yoʻq', hint: 'Taftish (nazorat tartibida koʻrish) oxirgi instansiyadan keyin, alohida tartibda' }
  })

  const current = opts.current ?? (TRACK_ORDER[lastDone] ?? 'first')
  return TRACK_ORDER.map((key, i) => {
    const s = states[i]
    // the line out of a step: it carries the case forward only while a later instance has a record
    const link: TrackStep['link'] = i >= lastDone ? 'none' : s.state === 'done' && states[i + 1].state === 'done' ? 'solid' : 'dash'
    return { key, ...s, current: key === current, link }
  })
}
