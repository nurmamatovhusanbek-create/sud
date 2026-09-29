import { describe, expect, it } from 'bun:test'
import {
  annSector,
  courtItems,
  pizzaModel,
  polarPt,
  turkumItems,
  winRing,
  PIZZA_GEOM,
  MIN_LABEL_THICKNESS,
  type PizzaItem,
} from '../../components/proto/pizza-geometry'

const item = (label: string, won: number, lost: number, i = 0): PizzaItem => ({
  label,
  full: label,
  won,
  lost,
  col: '#3b5bdb',
  pill: '#2b45b5',
})

describe('pizza geometry (v18 port)', () => {
  it('polarPt places 0° to the right and 90° below (screen coords)', () => {
    const [x0, y0] = polarPt(0, 0, 10, 0)
    const [x90, y90] = polarPt(0, 0, 10, 90)
    expect(x0).toBeCloseTo(10)
    expect(y0).toBeCloseTo(0)
    expect(x90).toBeCloseTo(0, 5)
    expect(y90).toBeCloseTo(10)
  })

  it('annSector emits a closed path with two arcs', () => {
    const d = annSector(170, 170, 18, 120, -90, -30)
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d.match(/A/g)?.length).toBe(2)
  })

  it('N items → N wedges + N seams + 5 rings (seams count = N)', () => {
    const items = [item('A', 16, 8, 0), item('B', 5, 4, 1), item('C', 2, 3, 2)]
    const m = pizzaModel(items)
    expect(m.wedges.length).toBe(3)
    expect(m.seams.length).toBe(3)
    expect(m.rings.length).toBe(5)
    expect(m.rings[4].edge).toBe(true)
  })

  const item4 = (label: string, won: number, lost: number, neutral: number, pending: number): PizzaItem => ({ ...item(label, won, lost), neutral, pending })

  it('radial stack: the four statuses nest hub → rim, each as thick as its share of the slice', () => {
    const w = pizzaModel([item4('A', 1, 4, 1, 1)]).wedges[0] // 7 cases
    expect(w.bands.map((b) => b.status)).toEqual(['won', 'lost', 'neutral', 'pending'])
    const span = PIZZA_GEOM.R - PIZZA_GEOM.r0
    // contiguous, starting at the hub and ending at the rim
    expect(w.bands[0].rIn).toBeCloseTo(PIZZA_GEOM.r0, 1)
    expect(w.bands[3].rOut).toBeCloseTo(PIZZA_GEOM.R, 1)
    for (let i = 1; i < w.bands.length; i++) expect(w.bands[i].rIn).toBeCloseTo(w.bands[i - 1].rOut, 1)
    // thickness ∝ count
    expect(w.bands[1].rOut - w.bands[1].rIn).toBeCloseTo((span * 4) / 7, 1)
  })

  it('EVERY case is drawn: band counts sum to the pill total, and nothing is dropped', () => {
    for (const it of [item4('A', 1, 4, 1, 1), item4('B', 0, 0, 0, 6), item4('C', 22, 6, 5, 9), item4('D', 0, 1, 0, 0)]) {
      const w = pizzaModel([it]).wedges[0]
      expect(w.bands.reduce((a, b) => a + b.value, 0)).toBe(w.pill.v)
      expect(w.pill.v).toBe(it.won + it.lost + (it.neutral ?? 0) + (it.pending ?? 0))
    }
  })

  it('a slice with only in-progress cases is still a full wedge (the old chart drew an empty circle)', () => {
    const w = pizzaModel([item4('A', 0, 0, 0, 6)]).wedges[0]
    expect(w.bands).toHaveLength(1)
    expect(w.bands[0]).toMatchObject({ status: 'pending', value: 6 })
    expect(w.bands[0].rIn).toBeCloseTo(PIZZA_GEOM.r0, 1)
    expect(w.bands[0].rOut).toBeCloseTo(PIZZA_GEOM.R, 1)
  })

  it('numbers stay quiet: a count is printed only where its band is thick enough to hold it', () => {
    const w = pizzaModel([item4('A', 1, 60, 0, 0)]).wedges[0]
    expect(w.bands[0].text).toBeNull() // 1 of 61 → a sliver
    expect(w.bands[1].text?.v).toBe(60)
    for (const b of w.bands) if (b.text) expect(b.rOut - b.rIn).toBeGreaterThanOrEqual(MIN_LABEL_THICKNESS)
  })

  it('aria reads all statuses', () => {
    const w = pizzaModel([item4('A', 1, 4, 1, 1)]).wedges[0]
    expect(w.aria).toContain('7 ish')
    expect(w.aria).toContain('1 yutgan')
    expect(w.aria).toContain('4 yutqazgan')
    expect(w.aria).toContain('1 neytral')
    expect(w.aria).toContain('1 jarayonda')
  })

  it('pill total is ALL cases (won+lost+pending+neutral)', () => {
    expect(pizzaModel([item('A', 7, 3)]).wedges[0].pill.v).toBe(10)
    expect(pizzaModel([{ ...item('B', 2, 0), pending: 3, neutral: 2 }]).wedges[0].pill.v).toBe(7)
  })

  it('single item (N=1) fills: wedge spans a near-full turn, not a degenerate 360°', () => {
    // A 360° sector collapses (arc start == end → nothing renders). One court
    // type must still fill the pie, so the span is capped just under a full turn.
    const m = pizzaModel([item('A', 10, 0)])
    expect(m.wedges.length).toBe(1)
    const b = m.wedges[0].bands[0]
    expect(b.path).toMatch(/A120 120 0 1 1/) // outer arc drawn with the large-arc flag (span > 180°)
    const pts = b.path.match(/-?\d+\.\d+ -?\d+\.\d+/g) ?? []
    expect(pts[0]).not.toBe(pts[1]) // and its two arc endpoints differ
  })

  it('selection contract: wedge index maps 1:1 to items order', () => {
    const items = [item('A', 1, 1, 0), item('B', 2, 1, 1), item('C', 3, 1, 2), item('D', 4, 1, 3)]
    const m = pizzaModel(items)
    expect(m.wedges.map((w) => w.index)).toEqual([0, 1, 2, 3])
  })

  it('winRing dash array never exceeds the circumference', () => {
    const r = winRing(61, '#3b5bdb')
    const [len, rest] = r.dash.split(' ').map(Number)
    expect(len).toBeGreaterThan(0)
    expect(len).toBeLessThan(len + rest)
  })

  it('courtItems groups by courtType with the validated palette', () => {
    const cases = [
      mk('economic', 'win'),
      mk('economic', 'lose'),
      mk('economic', 'pending'),
      mk('civil', 'win'),
      mk('administrative', 'lose'),
    ] as unknown as CaseWithClassification[]
    const items = courtItems(cases)
    expect(items.map((i) => i.label)).toEqual(['Iqtisodiy', 'Fuqarolik', 'Maʼmuriy'])
    expect(items[0]).toMatchObject({ won: 1, lost: 1, pending: 1, neutral: 0, col: '#3b5bdb' })
    expect(items[1].col).toBe('#0e9d8f')
    expect(items[2].col).toBe('#8a63d2')
  })

  it('turkumItems caps to 7 buckets + grey Boshqa tail', () => {
    const cases: CaseWithClassification[] = []
    for (let i = 0; i < 10; i++) cases.push(mkCat(`Kat-${i}`, 'win'))
    cases.push(mkCat('Kat-0', 'lose'))
    const items = turkumItems(cases)
    expect(items.length).toBe(8) // 7 head + Boshqa
    expect(items[items.length - 1].label).toBe('Boshqa')
    expect(items[items.length - 1].col).toBe('#868e96')
    // Kat-0 aggregated win+lose
    expect(items[0].full).toBe('Kat-0')
    expect(items[0].won).toBe(1)
    expect(items[0].lost).toBe(1)
  })
})

import type { CaseWithClassification } from '../../lib/stats'

function mk(courtType: string, classification: string) {
  return { courtType, classification, category: 'Yetkazib berish' } as unknown as CaseWithClassification
}
function mkCat(category: string, classification: string) {
  return { courtType: 'economic', classification, category } as unknown as CaseWithClassification
}
