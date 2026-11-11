import { describe, expect, test } from 'bun:test'
import { donutArcs, hearingsPerDay, ratingShares, weightedWinRate, winLabel } from '../green-home'

describe('weightedWinRate', () => {
  test('weighted by cases: a big company outweighs a small one', () => {
    expect(weightedWinRate([{ cases: 100, winRate: 80 }, { cases: 4, winRate: 0 }])).toBe(77)
  })
  test('unknown companies are left out; nothing known → null', () => {
    expect(weightedWinRate([{ cases: 10, winRate: 50 }, { cases: 5 }, { winRate: 90 }, { cases: 0, winRate: 90 }])).toBe(50)
    expect(weightedWinRate([])).toBeNull()
    expect(weightedWinRate([{ cases: 5 }])).toBeNull()
  })
})

test('winLabel bands', () => {
  expect(winLabel(null)).toBe('Maʼlumot yoʻq')
  expect([90, 75, 74, 55, 54, 35, 34, 0].map(winLabel)).toEqual(['Aʼlo', 'Aʼlo', 'Yaxshi', 'Yaxshi', 'Oʻrtacha', 'Oʻrtacha', 'Past', 'Past'])
})

describe('hearingsPerDay', () => {
  const today = new Date(2026, 10, 11) // Wed 11 Nov 2026
  test('a window of days from today, with counts, weekday and the today flag', () => {
    const bars = hearingsPerDay(['2026-11-11', '2026-11-11', '2026-11-13', '2026-12-30', '2026-11-01'], today, 5)
    expect(bars.map((b) => [b.iso, b.count])).toEqual([['2026-11-11', 2], ['2026-11-12', 0], ['2026-11-13', 1], ['2026-11-14', 0], ['2026-11-15', 0]])
    expect(bars[0]).toMatchObject({ today: true, day: 11, weekday: 'Ch' })
    expect(bars[1].today).toBe(false)
  })
  test('crosses a month end', () => {
    const bars = hearingsPerDay(['2026-12-01'], new Date(2026, 10, 29), 4)
    expect(bars.map((b) => b.iso)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'])
    expect(bars[2].count).toBe(1)
  })
})

describe('ratingShares', () => {
  test('always five rows in order, unknown ratings are «—», percentages of the whole', () => {
    const r = ratingShares(['A', 'A', 'B', null, undefined, 'x', 'D'])
    expect(r.map((x) => x.key)).toEqual(['A', 'B', 'C', 'D', '—'])
    expect(r.map((x) => x.n)).toEqual([2, 1, 0, 1, 3])
    expect(r[0].pct).toBe(29)
  })
  test('a letter with a sign counts as its letter; an empty list is all zeros', () => {
    expect(ratingShares(['a+', ' B ']).map((x) => x.n)).toEqual([1, 1, 0, 0, 0])
    expect(ratingShares([]).every((x) => x.n === 0 && x.pct === 0)).toBe(true)
  })
})

describe('donutArcs', () => {
  test('arcs follow each other round the circle', () => {
    const arcs = donutArcs([{ key: 'A', n: 1 }, { key: 'B', n: 1 }, { key: 'C', n: 0 }], 100, 0)
    expect(arcs.map((a) => a.key)).toEqual(['A', 'B'])
    expect(arcs[0]).toMatchObject({ dash: 50, offset: -0 })
    expect(arcs[1]).toMatchObject({ dash: 50, offset: -50 })
  })
  test('a gap is left between arcs but never for a single one; nothing to draw → no arcs', () => {
    expect(donutArcs([{ key: 'A', n: 3 }], 100, 4)[0].dash).toBe(100)
    expect(donutArcs([{ key: 'A', n: 1 }, { key: 'B', n: 1 }], 100, 4)[0].dash).toBe(46)
    expect(donutArcs([{ key: 'A', n: 0 }], 100)).toEqual([])
  })
})
