/**
 * Pizza chart geometry — "radial stack".
 *
 * ONE circle = 100% of the cases. Each wedge = a slice (court type OR case category),
 * one hue, equal angle. The wedge's radius is that slice's OWN 100%, stacked outward
 * from the hub: yutgan → yutqazgan → neytral → jarayonda, each band as thick as its
 * share of the slice's cases. So every case is drawn, the pill total (all cases) equals
 * the sum of the bands, and nothing is hidden the way the old «won ÷ decided» fill did.
 * Status is told by fill DENSITY in the slice's hue (solid · tint · hatch · dashed), not
 * by hue, so it never clashes with the slice colours and survives colour blindness.
 * Navy dotted seams part the slices; the total sits in a pill just outside.
 *
 * The win rate is NOT drawn as a radius any more — it is the number next to the chart
 * (src/core/rates.ts: won ÷ (won + lost)).
 *
 * Pure module (no React/DOM) so src/core/__tests__ can verify the contract:
 * N items → N wedges + N seams, bands sum to the total, band radii nest in [r0, R].
 */

import type { CaseWithClassification } from '@/lib/stats'

export interface PizzaItem {
  /** stable id for filter wiring (courtType in court mode) */
  id?: string
  label: string
  full: string
  won: number
  lost: number
  /** wedge hue (validated categorical palette hex — do not inline new colours) */
  col: string
  /** pill fill (darker step of the same hue) */
  pill: string
  /** cases still being heard */
  pending?: number
  /** decided without a winner (qaytarilgan …) */
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

export type PizzaStatus = 'won' | 'lost' | 'neutral' | 'pending'

/** Centre → rim. Won first: it is the number people look for. */
export const PIZZA_STATUS_ORDER: PizzaStatus[] = ['won', 'lost', 'neutral', 'pending']

export const PIZZA_STATUS_LABEL: Record<PizzaStatus, string> = {
  won: 'Yutgan',
  lost: 'Yutqazgan',
  neutral: 'Neytral',
  pending: 'Jarayonda',
}

/**
 * Paint shared by the app and the PDF report, so the two charts can never drift.
 * Density (not hue) tells the status apart: solid · tint · hatch · dashed.
 */
export const PIZZA_PAINT = {
  /** «yutqazgan» tint — a touch stronger on dark surfaces */
  lostOpacity: (dark: boolean) => (dark ? 0.5 : 0.34),
  /** «neytral» hatch: pattern box, faint ground and the (strong) stripe */
  hatch: { size: 4.5, groundOpacity: 0.16, stripeWidth: 2, stripeOpacity: 0.95 },
  /** «jarayonda»: pale ground + a full-strength dashed outline */
  pending: { fillOpacity: 0.16, strokeWidth: 1.4, dash: '3.2 2.2' },
  /** thickness of the clear channel that parts decided from undecided cases */
  splitGap: 3,
} as const

/** A band's number is printed only when the band is at least this thick (viewBox units). */
export const MIN_LABEL_THICKNESS = 11

export interface PizzaBand {
  status: PizzaStatus
  value: number
  /** inner / outer radius of the band */
  rIn: number
  rOut: number
  path: string
  /** the count, printed inside the band — null when the band is too thin to hold it */
  text: { x: number; y: number; v: number } | null
}

export interface PizzaWedge {
  index: number
  /** only the non-empty bands, hub → rim */
  bands: PizzaBand[]
  /**
   * A clear channel between the DECIDED bands (yutgan + yutqazgan) and the UNDECIDED ones
   * (neytral + jarayonda), so the part of the pie that has no winner yet reads as its own
   * zone. null when the slice has only one kind.
   */
  split: string | null
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

/** Every status count of an item, in stacking order. */
export function pizzaCounts(it: PizzaItem): Record<PizzaStatus, number> {
  return { won: it.won, lost: it.lost, neutral: it.neutral ?? 0, pending: it.pending ?? 0 }
}

/** Total of ALL cases in an item (what the pill shows). */
export const pizzaTotal = (it: PizzaItem): number => it.won + it.lost + (it.neutral ?? 0) + (it.pending ?? 0)

/** Build the full SVG model for one pizza — N items → N wedges + N seams. */
export function pizzaModel(items: PizzaItem[]): PizzaModel {
  const { cx, cy, R, r0 } = PIZZA_GEOM
  const N = items.length
  const step = 360 / Math.max(1, N)
  // guide rings at every 20% of a slice's own total
  const rings = Array.from({ length: 5 }, (_, p) => ({
    r: +(r0 + ((R - r0) * (p + 1)) / 5).toFixed(1),
    edge: p === 4,
  }))
  const wedges: PizzaWedge[] = []
  const seams: PizzaSeam[] = []
  for (let i = 0; i < N; i++) {
    const it = items[i]
    const counts = pizzaCounts(it)
    const tot = pizzaTotal(it)
    const a0 = -90 + i * step
    // Cap a wedge's span just under a full turn: a single item (N=1) spans 360°,
    // whose arc start/end coincide and the sector degenerates to nothing (the
    // pie wouldn't fill). 359.9° renders a full donut with a hairline seam.
    const a1 = a0 + Math.min(step, 359.9)
    const mid = (a0 + a1) / 2

    const bands: PizzaBand[] = []
    let cum = 0
    if (tot > 0) {
      for (const status of PIZZA_STATUS_ORDER) {
        const v = counts[status]
        if (v <= 0) continue
        const rIn = r0 + ((R - r0) * cum) / tot
        cum += v
        const rOut = r0 + ((R - r0) * cum) / tot
        const mp = polarPt(cx, cy, (rIn + rOut) / 2, mid)
        bands.push({
          status,
          value: v,
          rIn: +rIn.toFixed(2),
          rOut: +rOut.toFixed(2),
          path: annSector(cx, cy, rIn, rOut, a0, a1),
          text: rOut - rIn >= MIN_LABEL_THICKNESS ? { x: +mp[0].toFixed(1), y: +(mp[1] + 3).toFixed(1), v } : null,
        })
      }
    }
    const decidedBand = bands.filter((b) => b.status === 'won' || b.status === 'lost').at(-1)
    const hasUndecided = bands.some((b) => b.status === 'neutral' || b.status === 'pending')
    const split =
      decidedBand && hasUndecided
        ? annSector(cx, cy, decidedBand.rOut - PIZZA_PAINT.splitGap / 2, decidedBand.rOut + PIZZA_PAINT.splitGap / 2, a0, a1)
        : null
    const pill = polarPt(cx, cy, R + 15, mid)
    wedges.push({
      index: i,
      bands,
      split,
      pill: { x: +pill[0].toFixed(1), y: +pill[1].toFixed(1), v: tot, fill: it.pill },
      aria:
        `${it.full}, ${tot} ish: ${counts.won} yutgan, ${counts.lost} yutqazgan` +
        (counts.neutral ? `, ${counts.neutral} neytral` : '') +
        (counts.pending ? `, ${counts.pending} jarayonda` : ''),
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
