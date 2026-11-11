/**
 * The numbers behind the green look's home dashboard. Pure: the registry's cached meta goes in, shapes the charts draw
 * come out (no React, no DOM), so they are tested without a browser.
 */

export interface WinInput {
  cases?: number
  winRate?: number
}

/** The win rate over ALL the companies, weighted by their case counts (a company with 3 cases must not count like one with 300). null when nothing is known. */
export function weightedWinRate(list: WinInput[]): number | null {
  let won = 0
  let total = 0
  for (const c of list) {
    if (typeof c.winRate !== 'number' || !Number.isFinite(c.winRate) || !c.cases || c.cases <= 0) continue
    won += (c.cases * c.winRate) / 100
    total += c.cases
  }
  return total > 0 ? Math.round((won / total) * 100) : null
}

/** A word for a win rate (the card's headline). */
export function winLabel(rate: number | null): string {
  if (rate === null) return 'Maʼlumot yoʻq'
  if (rate >= 75) return 'Aʼlo'
  if (rate >= 55) return 'Yaxshi'
  if (rate >= 35) return 'Oʻrtacha'
  return 'Past'
}

export interface DayBar {
  iso: string
  /** day of the month, «11» */
  day: number
  /** «Du», «Se»… */
  weekday: string
  count: number
  today: boolean
}

const WD = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh']
const pad = (n: number) => String(n).padStart(2, '0')
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Hearings per day for `days` days starting today (local time), from a list of `yyyy-mm-dd` dates. Earlier dates are ignored. */
export function hearingsPerDay(isos: string[], today: Date, days = 14): DayBar[] {
  const counts = new Map<string, number>()
  for (const iso of isos) counts.set(iso, (counts.get(iso) ?? 0) + 1)
  const out: DayBar[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
    const iso = isoOf(d)
    out.push({ iso, day: d.getDate(), weekday: WD[d.getDay()], count: counts.get(iso) ?? 0, today: i === 0 })
  }
  return out
}

export type RatingKey = 'A' | 'B' | 'C' | 'D' | '—'
export interface RatingShare {
  key: RatingKey
  n: number
  /** whole percent of the companies */
  pct: number
}

/** How many companies hold each chamber rating letter (an unread or unknown rating is «—»). Always the five rows, in order. */
export function ratingShares(ratings: (string | null | undefined)[]): RatingShare[] {
  const keys: RatingKey[] = ['A', 'B', 'C', 'D', '—']
  const n = new Map<RatingKey, number>(keys.map((k) => [k, 0]))
  for (const r of ratings) {
    const letter = (r ?? '').trim().toUpperCase().charAt(0)
    const k: RatingKey = letter === 'A' || letter === 'B' || letter === 'C' || letter === 'D' ? letter : '—'
    n.set(k, (n.get(k) ?? 0) + 1)
  }
  const total = ratings.length
  return keys.map((key) => ({ key, n: n.get(key) ?? 0, pct: total ? Math.round(((n.get(key) ?? 0) / total) * 100) : 0 }))
}

export interface DonutArc {
  key: string
  /** stroke-dasharray `dash gap` for a circle of circumference `c` */
  dash: number
  gap: number
  /** stroke-dashoffset that starts the arc where the previous one ended */
  offset: number
}

/** Arcs for a donut drawn with circle strokes: each share becomes a dash of the circumference, with a small gap between arcs. */
export function donutArcs(shares: { key: string; n: number }[], circumference: number, gapPx = 4): DonutArc[] {
  const total = shares.reduce((s, x) => s + x.n, 0)
  if (total <= 0) return []
  const live = shares.filter((s) => s.n > 0)
  const gap = live.length > 1 ? gapPx : 0
  let used = 0
  return live.map((s) => {
    const len = (s.n / total) * circumference
    const arc = { key: s.key, dash: Math.max(0, len - gap), gap: circumference - Math.max(0, len - gap), offset: -used }
    used += len
    return arc
  })
}
