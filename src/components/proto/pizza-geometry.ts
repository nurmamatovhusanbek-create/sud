/**
 * Pizza chart geometry — ported 1:1 from sud-tizimi-ui-v18.html.
 *
 * ONE circle = 100%. Each wedge = a slice (court type OR case category), one
 * hue. FILLED radius = won share of decided cases; empty remainder = lost.
 * Navy dotted seams part the slices; the total sits in a pill just outside.
 * Numbers: won inside the fill, lost inside the empty band; slice names live
 * in the legend, not on the pie. Do NOT re-derive the math — it is tuned.
 *
 * Pure module (no React/DOM) so src/core/__tests__ can verify the contract:
 * N items → N wedges + N seams, fill ratio = won/(won+lost), radius inside
 * [r0, R].
 */

import type { CaseWithClassification } from '@/lib/stats'

export interface PizzaItem {
  /** stable id for filter wiring (courtType in court mode) */
  id?: string
  label: string
  full: string
  won: number
  lost: number
  /** wedge fill (validated categorical palette hex — do not inline new colours) */
  col: string
  /** pill fill (darker step of the same hue) */
  pill: string
  /** extra context for the detail panel (non-decided cases) */
  pending?: number
  neutral?: number
}

export interface PizzaGeom {
  cx: number
  cy: number
  R: number
  r0: number
}

export const PIZZA_GEOM: PizzaGeom = { cx: 170, cy: 170, R: 120, r0: 18 }

export function polarPt(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

export function annSector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p0 = polarPt(cx, cy, r1, a0)
  const p1 = polarPt(cx, cy, r1, a1)
  const p2 = polarPt(cx, cy, r0, a1)
  const p3 = polarPt(cx, cy, r0, a0)
  const lg = a1 - a0 > 180 ? 1 : 0
  return (
    'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) +
    ' A' + r1 + ' ' + r1 + ' 0 ' + lg + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2) +
    ' L' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2) +
    ' A' + r0 + ' ' + r0 + ' 0 ' + lg + ' 0 ' + p3[0].toFixed(2) + ' ' + p3[1].toFixed(2) +
    ' Z'
  )
}

export interface PizzaWedge {
  index: number
  /** empty band (lost share) */
  lostPath: string
  /** filled share (won) — null when won === 0 */
  wonPath: string | null
  wonText: { x: number; y: number; v: number } | null
  lostText: { x: number; y: number; v: number } | null
  pill: { x: number; y: number; v: number; fill: string }
  aria: string
}

export interface PizzaSeam {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PizzaModel {
  rings: { r: number; edge: boolean }[]
  wedges: PizzaWedge[]
  seams: PizzaSeam[]
}

/** Build the full SVG model for one pizza — N items → N wedges + N seams. */
export function pizzaModel(items: PizzaItem[]): PizzaModel {
  const { cx, cy, R, r0 } = PIZZA_GEOM
  const N = items.length
  const step = 360 / Math.max(1, N)
  const rings = Array.from({ length: 5 }, (_, p) => ({
    r: +(r0 + ((R - r0) * (p + 1)) / 5).toFixed(1),
    edge: p === 4,
  }))
  const wedges: PizzaWedge[] = []
  const seams: PizzaSeam[] = []
  for (let i = 0; i < N; i++) {
    const it = items[i]
    // decided drives the win-rate fill; total (all statuses) is the case count
    // shown in the pill — pending/neutral cases still count toward the total.
    const decided = it.won + it.lost
    const tot = decided + (it.pending ?? 0) + (it.neutral ?? 0)
    const wr = decided ? it.won / decided : 0
    const a0 = -90 + i * step
    // Cap a wedge's span just under a full turn: a single item (N=1) spans 360°,
    // whose arc start/end coincide and the sector degenerates to nothing (the
    // pie wouldn't fill). 359.9° renders a full donut with a hairline seam.
    const a1 = a0 + Math.min(step, 359.9)
    const mid = (a0 + a1) / 2
    const fillR = r0 + (R - r0) * wr
    const pill = polarPt(cx, cy, R + 15, mid)
    const wp = polarPt(cx, cy, Math.max(r0 + 11, (r0 + fillR) / 2), mid)
    const lp = polarPt(cx, cy, Math.min(R - 9, (fillR + R) / 2), mid)
    wedges.push({
      index: i,
      lostPath: annSector(cx, cy, fillR, R, a0, a1),
      wonPath: wr > 0 ? annSector(cx, cy, r0, fillR, a0, a1) : null,
      wonText: it.won > 0 ? { x: +wp[0].toFixed(1), y: +(wp[1] + 4).toFixed(1), v: it.won } : null,
      lostText: it.lost > 0 ? { x: +lp[0].toFixed(1), y: +(lp[1] + 3.5).toFixed(1), v: it.lost } : null,
      pill: { x: +pill[0].toFixed(1), y: +pill[1].toFixed(1), v: tot, fill: it.pill },
      aria: `${it.full}, ${tot}, ${Math.round(wr * 100)}%`,
    })
    const sb = polarPt(cx, cy, r0, a0)
    const se = polarPt(cx, cy, R + 7, a0)
    seams.push({ x1: +sb[0].toFixed(1), y1: +sb[1].toFixed(1), x2: +se[0].toFixed(1), y2: +se[1].toFixed(1) })
  }
  return { rings, wedges, seams }
}

/** Win-rate ring (prototype ringSvg2) — pure path/attr model for the 88px detail ring. */
export function winRing(pct: number, col: string): { track: number; arc: number; dash: string; rotate: number } {
  const r = 34
  const C = 2 * Math.PI * r
  const len = (C * Math.min(100, Math.max(0, pct))) / 100
  return { track: r, arc: r, dash: `${len} ${C - len}`, rotate: -90 }
}

// ---- palette (validated with the prototype — CVD-safe, no red/orange) --------

const COURT_PALETTE: Record<string, { col: string; pill: string }> = {
  economic: { col: '#3b5bdb', pill: '#2b45b5' },
  civil: { col: '#0e9d8f', pill: '#0a726a' },
  administrative: { col: '#8a63d2', pill: '#6a44bb' },
}

const TURKUM_PALETTE: { col: string; pill: string }[] = [
  { col: '#3b5bdb', pill: '#2b45b5' },
  { col: '#0ca678', pill: '#0a7a58' },
  { col: '#9c36b5', pill: '#7a2a8e' },
  { col: '#15aabf', pill: '#0e7d8c' },
  { col: '#5c940d', pill: '#47730a' },
  { col: '#7048e8', pill: '#5735c4' },
  { col: '#1c7ed6', pill: '#1567b0' },
]
const OTHER_PALETTE = { col: '#868e96', pill: '#5c6270' }

export const COURT_LABELS: Record<string, { label: string; full: string }> = {
  economic: { label: 'Iqtisodiy', full: 'Iqtisodiy sud' },
  civil: { label: 'Fuqarolik', full: 'Fuqarolik sudi' },
  administrative: { label: 'Maʼmuriy', full: 'Maʼmuriy / soliq' },
}

/** Sud turi mode — group real cases by courtType, won/lose only (prototype math). */
export function courtItems(cases: CaseWithClassification[]): PizzaItem[] {
  const order = ['economic', 'civil', 'administrative'] as const
  const out: PizzaItem[] = []
  for (const ct of order) {
    const sub = cases.filter((c) => c.courtType === ct)
    if (sub.length === 0) continue
    const pal = COURT_PALETTE[ct] ?? OTHER_PALETTE
    const labels = COURT_LABELS[ct] ?? { label: ct, full: ct }
    out.push({
      id: ct,
      label: labels.label,
      full: labels.full,
      won: sub.filter((c) => c.classification === 'win').length,
      lost: sub.filter((c) => c.classification === 'lose').length,
      pending: sub.filter((c) => c.classification === 'pending').length,
      neutral: sub.filter((c) => c.classification === 'neutral').length,
      col: pal.col,
      pill: pal.pill,
    })
  }
  return out
}

/** Turkum mode — group by case category; top 7 + grey «Boshqa» tail. */
export function turkumItems(cases: CaseWithClassification[], cap = 7): PizzaItem[] {
  const counts = new Map<string, { won: number; lost: number; pending: number; neutral: number }>()
  for (const c of cases) {
    const key = (c.category || '').trim() || 'Boshqa'
    const e = counts.get(key) ?? { won: 0, lost: 0, pending: 0, neutral: 0 }
    if (c.classification === 'win') e.won++
    else if (c.classification === 'lose') e.lost++
    else if (c.classification === 'pending') e.pending++
    else e.neutral++
    counts.set(key, e)
  }
  const entries = [...counts.entries()]
    .map(([k, v]) => ({ key: k, ...v, total: v.won + v.lost + v.pending + v.neutral }))
    .sort((a, b) => b.total - a.total)
  const head = entries.slice(0, cap)
  const tail = entries.slice(cap)
  const out: PizzaItem[] = head.map((e, i) => ({
    label: e.key.length > 14 ? e.key.slice(0, 13) + '…' : e.key,
    full: e.key,
    won: e.won,
    lost: e.lost,
    pending: e.pending,
    neutral: e.neutral,
    col: TURKUM_PALETTE[i % TURKUM_PALETTE.length].col,
    pill: TURKUM_PALETTE[i % TURKUM_PALETTE.length].pill,
  }))
  if (tail.length) {
    const acc = tail.reduce(
      (a, e) => ({ won: a.won + e.won, lost: a.lost + e.lost, pending: a.pending + e.pending, neutral: a.neutral + e.neutral }),
      { won: 0, lost: 0, pending: 0, neutral: 0 },
    )
    out.push({ label: 'Boshqa', full: 'Boshqa ishlar', ...acc, col: OTHER_PALETTE.col, pill: OTHER_PALETTE.pill })
  }
  return out
}
