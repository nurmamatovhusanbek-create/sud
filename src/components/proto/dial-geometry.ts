/**
 * Dial geometry — the hairline instrument gauge («Sirkul · Asbob»).
 *
 * ONE scale, 270° (from bottom-left over the top to bottom-right): 51 ticks (26 when the dial is
 * small), a longer tick every 20 points, numerals at 0 · 50 · 100, and — when `zones` are given —
 * longer coloured ticks at each zone limit. A needle (a long tick + a pointer outside the ring)
 * sits at the value; ticks the needle has passed are lit in the band colour.
 *
 * Pure module (no React/DOM): the in-app `Dial` (animated) and the PDF report (static) draw the
 * SAME geometry with their own paint, so the two can never drift. Contract (src/core/__tests__/dial.test.ts):
 * ticks run 0 → 100 evenly, majors land on multiples of 20, the needle angle spans −135° … +135°.
 */

export type DialBand = 'pos' | 'neg' | 'warn' | 'info' | 'neu'
/** [upTo, band] pairs, ascending; a value belongs to the first zone whose `upTo` is above it (the last zone takes 100). */
export type DialZones = readonly (readonly [number, DialBand])[]

export interface DialTick {
  /** position on the 0–100 scale */
  v: number
  x1: number
  y1: number
  x2: number
  y2: number
  major: boolean
  /** a zone limit (drawn long, in the zone's colour when unlit) */
  limit: boolean
  /** the zone this tick sits in (null when the dial has no zones) */
  zone: DialBand | null
  /** base stroke width (user units) */
  width: number
}

export interface DialGeom {
  size: number
  small: boolean
  ticks: DialTick[]
  labels: { v: number; x: number; y: number }[]
  cx: number
  cy: number
  /** outer radius of the tick ring */
  ro: number
  needle: { x1: number; y1: number; x2: number; y2: number; tri: string }
}

const START = 135 // degrees, SVG orientation (0° = 3 o'clock, clockwise)
const SWEEP = 270

export const clampPct = (v: number): number => Math.min(100, Math.max(0, Number.isFinite(v) ? v : 0))

/** needle rotation in degrees, −135 (0) … +135 (100), around the centre */
export const dialAngle = (v: number): number => (SWEEP * clampPct(v)) / 100 - SWEEP / 2

export function zoneBand(zones: DialZones | null | undefined, v: number): DialBand | null {
  if (!zones || !zones.length) return null
  for (const [upTo, band] of zones) if (v < upTo) return band
  return zones[zones.length - 1][1]
}

/** the band the value is painted in: its zone, else the explicit band */
export const bandFor = (value: number, zones: DialZones | null | undefined, band: DialBand = 'neu'): DialBand => zoneBand(zones, value) ?? band

export function dialGeom(size: number, zones: DialZones | null = null, labels = true): DialGeom {
  const small = size < 130
  const n = small ? 26 : 51
  const step = 100 / (n - 1)
  const major = small ? 5 : 10
  const cx = size / 2
  const cy = size / 2
  const ro = size / 2 - size * 0.05
  const l1 = size * (small ? 0.06 : 0.04)
  const l2 = size * (small ? 0.1 : 0.075)
  const pt = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
  const rad = (v: number) => ((START + (SWEEP * v) / 100) * Math.PI) / 180
  const limits = zones ? zones.slice(0, -1).map(([u]) => u) : []

  const ticks: DialTick[] = []
  for (let i = 0; i < n; i++) {
    const v = i === n - 1 ? 100 : i * step
    const isMajor = i % major === 0
    const limit = limits.some((u) => Math.abs(u - v) < step / 2)
    const len = isMajor || limit ? l2 : l1
    const [x1, y1] = pt(ro - len, rad(v))
    const [x2, y2] = pt(ro, rad(v))
    ticks.push({ v, x1, y1, x2, y2, major: isMajor, limit, zone: zoneBand(zones, v), width: isMajor || limit ? 2 : 1.4 })
  }

  const lr = ro - l2 - size * 0.06
  const lab = labels && !small ? [0, 50, 100].map((v) => { const [x, y] = pt(lr, rad(v)); return { v, x, y: y + 3 } }) : []

  // the needle is drawn pointing straight up and rotated by dialAngle(value) around (cx, cy)
  const needle = {
    x1: cx,
    y1: cy - (ro - l2 * 1.5),
    x2: cx,
    y2: cy - ro - 1,
    tri: `M${cx - 3.6} ${cy - ro - 4} L${cx + 3.6} ${cy - ro - 4} L${cx} ${cy - ro + 1.5} Z`,
  }
  return { size, small, ticks, labels: lab, cx, cy, ro, needle }
}

/** How far behind the needle a tick still glows (scale points) */
export const TRAIL = 12

/** Per-tick look at a given needle position: lit once passed; the few just behind the needle are heavier. */
export function tickLook(t: DialTick, shown: number): { lit: boolean; width: number } {
  const lit = t.v <= shown + 1e-6
  const d = shown - t.v
  const near = lit && d < TRAIL ? 1 - d / TRAIL : 0
  return { lit, width: t.width + near * 1.1 }
}
