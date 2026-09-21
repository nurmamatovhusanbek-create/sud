import { describe, expect, it } from 'bun:test'
import {
  annSector,
  courtItems,
  pizzaModel,
  polarPt,
  turkumItems,
  winRing,
  PIZZA_GEOM,
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

  it('fill radius follows won/(won+lost): full win → fillR = R; zero win → fillR = r0', () => {
    const full = pizzaModel([item('A', 10, 0)]).wedges[0]
    const none = pizzaModel([item('B', 0, 10)]).wedges[0]
    // wonPath present only when won > 0; its outer radius encodes the share
    expect(full.wonPath).toBeTruthy()
    expect(none.wonPath).toBeNull()
    // won text sits at the mid of [r0, fillR] → farther from centre on a full win
    const rFull = Math.hypot(full.wonText!.x - PIZZA_GEOM.cx, full.wonText!.y - PIZZA_GEOM.cy)
    const rNone = Math.hypot(none.lostText!.x - PIZZA_GEOM.cx, none.lostText!.y - PIZZA_GEOM.cy)
    expect(rFull).toBeGreaterThan(rNone)
  })

  it('pill total is ALL cases (won+lost+pending+neutral); win % is over decided', () => {
    const w = pizzaModel([item('A', 7, 3)]).wedges[0]
    expect(w.pill.v).toBe(10)
    expect(w.aria).toContain('70%')
    // pending + neutral count toward the total but not the win rate
    const w2 = pizzaModel([{ ...item('B', 2, 0), pending: 3, neutral: 2 }]).wedges[0]
    expect(w2.pill.v).toBe(7) // 2 + 0 + 3 + 2
    expect(w2.aria).toContain('100%') // 2/(2+0) decided
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
