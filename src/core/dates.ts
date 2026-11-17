/**
 * Dates as sud.uz sends them: `dd.mm.yyyy` (and sometimes ISO `yyyy-mm-dd`).
 *
 * NEVER compare the raw strings: `'10.01.2023' < '15.12.2022'` (day sorts first).
 * Use dateKey() to sort and daysUntil() for "how far away".
 */

export interface Ymd {
  y: number
  m: number // 1–12
  d: number
}

/** Parse `dd.mm.yyyy` or `yyyy-mm-dd` (prefix). Null when it is neither. */
export function parseYmd(s: string | null | undefined): Ymd | null {
  if (!s) return null
  const dmy = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s)
  if (dmy) return { y: +dmy[3], m: +dmy[2], d: +dmy[1] }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] }
  return null
}

/** Sortable `yyyy-mm-dd`; the input is returned unchanged when unparseable. */
export function dateKey(s: string | null | undefined): string {
  const p = parseYmd(s)
  if (!p) return s || ''
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/** Whole days from `now` (midnight) to the date; null when unparseable. */
export function daysUntil(s: string | null | undefined, now: Date = new Date()): number | null {
  const p = parseYmd(s)
  if (!p) return null
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((new Date(p.y, p.m - 1, p.d).getTime() - t.getTime()) / 86_400_000)
}

/**
 * The rows whose date has not passed (today counts), in the input order; rows with no readable date are dropped.
 *
 * A list of hearings is fetched once and then cached (in the browser and in the registry), so it OUTLIVES its own
 * dates: a hearing fetched last week for yesterday is still in it today. Every place that shows «the next hearing» or
 * counts «upcoming» ones must read through this, not trust the list.
 */
export function stillAhead<T>(rows: readonly T[], date: (row: T) => string | null | undefined, now: Date = new Date()): T[] {
  return rows.filter((r) => {
    const d = daysUntil(date(r), now)
    return d !== null && d >= 0
  })
}

/** `dd.mm.yyyy` for a Date. */
export function formatDmy(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()}`
}
