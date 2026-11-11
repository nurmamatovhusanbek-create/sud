/**
 * Hearings as an AGENDA: grouped by calendar day, ordered by time, with a 7-day strip on top.
 * Pure (no React, no storage) so the grouping is tested once and every screen of the new look draws the same order:
 * Bosh sahifa and Kuzatuv (hearings of many companies) and a company's Majlislar.
 *
 * Why it exists: the same hearings used to be shown three times with no order — a run-on sentence in an alert
 * («NKMK · 12 Noy · NKMK · 12 Noy · …»), a flat list of date tiles, and once more on each company card.
 */

export interface AgendaItem {
  /** yyyy-mm-dd */
  iso: string
  /** hh:mm, when the court published one */
  time?: string
}

export interface AgendaDay<T> {
  iso: string
  /** whole calendar days from today (0 = today) */
  days: number
  items: T[]
}

export interface StripDay {
  iso: string
  days: number
  /** day of month */
  day: number
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
  count: number
}

const DAY_MS = 86_400_000
const p2 = (n: number) => String(n).padStart(2, '0')

function parts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return [y, mo, d]
}

/** Calendar days from `now`'s local date to `iso` (negative = past); null when `iso` is not a date. */
export function calendarDaysUntil(iso: string, now: Date = new Date()): number | null {
  const p = parts(iso)
  if (!p) return null
  // both sides as UTC midnights of their calendar date: a DST shift can never make a day 23 h and round it away
  return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS)
}

/** Upcoming rows (today included) grouped by day, days ascending; inside a day by time, rows without a time last. */
export function groupByDay<T extends AgendaItem>(rows: readonly T[], now: Date = new Date()): AgendaDay<T>[] {
  const byDay = new Map<string, AgendaDay<T>>()
  for (const r of rows) {
    const days = calendarDaysUntil(r.iso, now)
    if (days === null || days < 0) continue
    const iso = r.iso.slice(0, 10)
    const g = byDay.get(iso)
    if (g) g.items.push(r)
    else byDay.set(iso, { iso, days, items: [r] })
  }
  const out = [...byDay.values()].sort((a, b) => a.days - b.days)
  // a missing time sorts after every real one; equal keys keep their incoming order (Array.sort is stable)
  const key = (t?: string) => (t && /^\d{1,2}:\d{2}/.test(t) ? t.padStart(5, '0') : '99:99')
  for (const g of out) g.items.sort((a, b) => key(a.time).localeCompare(key(b.time)))
  return out
}

/** The next `length` calendar days starting today, each with how many rows fall on it (0 for an empty day). */
export function weekStrip(groups: readonly AgendaDay<unknown>[], now: Date = new Date(), length = 7): StripDay[] {
  const count = new Map(groups.map((g) => [g.days, g.items.length]))
  return Array.from({ length }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    return { iso: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, days: i, day: d.getDate(), weekday: d.getDay(), count: count.get(i) ?? 0 }
  })
}

export const WEEKDAYS_SHORT = ['Ya', 'Du', 'Se', 'Cho', 'Pa', 'Ju', 'Sha'] as const
const WEEKDAYS = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'] as const
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'] as const

/** «Bugun» / «Ertaga» / «3 kundan keyin». */
export function relativeDay(days: number): string {
  return days === 0 ? 'Bugun' : days === 1 ? 'Ertaga' : `${days} kundan keyin`
}

/** «payshanba, 12-noyabr» (the year only when it is not the current one). */
export function longDate(iso: string, now: Date = new Date()): string {
  const p = parts(iso)
  if (!p) return iso
  const wd = WEEKDAYS[new Date(p[0], p[1] - 1, p[2]).getDay()]
  return `${wd}, ${p[2]}-${MONTHS[p[1] - 1]}${p[0] !== now.getFullYear() ? ` ${p[0]}` : ''}`
}
