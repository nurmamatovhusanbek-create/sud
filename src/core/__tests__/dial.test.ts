import { describe, expect, test } from 'bun:test'
import { bandFor, clampPct, dialAngle, dialGeom, tickLook, zoneBand, type DialZones } from '@/components/proto/dial-geometry'

const WORKER: DialZones = [[60, 'neg'], [90, 'warn'], [100, 'pos']]

describe('dial scale', () => {
  test('big dial: 51 ticks, evenly 0 → 100, a major every 20 points', () => {
    const g = dialGeom(200)
    expect(g.ticks).toHaveLength(51)
    expect(g.ticks[0].v).toBe(0)
    expect(g.ticks[50].v).toBe(100)
    for (let i = 1; i < g.ticks.length; i++) expect(g.ticks[i].v - g.ticks[i - 1].v).toBeCloseTo(2, 6)
    expect(g.ticks.filter((t) => t.major).map((t) => t.v)).toEqual([0, 20, 40, 60, 80, 100])
  })
  test('small dial: 26 ticks, the same majors, no numerals', () => {
    const g = dialGeom(92)
    expect(g.small).toBe(true)
    expect(g.ticks).toHaveLength(26)
    expect(g.ticks.filter((t) => t.major).map((t) => t.v.toFixed(0))).toEqual(['0', '20', '40', '60', '80', '100'])
    expect(g.labels).toEqual([])
  })
  test('numerals sit at 0 · 50 · 100 (and can be switched off)', () => {
    expect(dialGeom(200).labels.map((l) => l.v)).toEqual([0, 50, 100])
    expect(dialGeom(200, null, false).labels).toEqual([])
  })
  test('ticks stay inside the dial', () => {
    const g = dialGeom(200)
    for (const t of g.ticks) for (const [x, y] of [[t.x1, t.y1], [t.x2, t.y2]]) {
      expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(200)
      expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(200)
    }
  })
  test('the 270° sweep leaves the bottom open: 0 is bottom-left, 50 is on top, 100 is bottom-right', () => {
    const t = dialGeom(200).ticks
    expect(t[0].x2).toBeLessThan(100); expect(t[0].y2).toBeGreaterThan(100)
    expect(t[25].x2).toBeCloseTo(100, 3); expect(t[25].y2).toBeLessThan(20)
    expect(t[50].x2).toBeGreaterThan(100); expect(t[50].y2).toBeGreaterThan(100)
  })
})

describe('needle and bands', () => {
  test('needle angle spans −135° … +135°, straight up at 50', () => {
    expect(dialAngle(0)).toBe(-135)
    expect(dialAngle(50)).toBe(0)
    expect(dialAngle(100)).toBe(135)
    expect(dialAngle(150)).toBe(135) // clamped
    expect(dialAngle(Number.NaN)).toBe(-135)
  })
  test('clampPct', () => {
    expect([clampPct(-5), clampPct(40), clampPct(120)]).toEqual([0, 40, 100])
  })
  test('zones use the app limits: < 60 dead · 60–89 slow · ≥ 90 healthy', () => {
    expect([0, 59.9, 60, 89, 90, 100].map((v) => zoneBand(WORKER, v))).toEqual(['neg', 'neg', 'warn', 'warn', 'pos', 'pos'])
    expect(zoneBand(null, 50)).toBeNull()
  })
  test('the band is the value\'s zone, else the explicit band', () => {
    expect(bandFor(72, WORKER)).toBe('warn')
    expect(bandFor(72, null, 'pos')).toBe('pos')
    expect(bandFor(72, null)).toBe('neu')
  })
  test('zone limits become long ticks and every tick knows its zone', () => {
    const g = dialGeom(200, WORKER)
    expect(g.ticks.filter((t) => t.limit).map((t) => t.v)).toEqual([60, 90])
    expect(g.ticks.every((t) => t.zone !== null)).toBe(true)
    expect(g.ticks.find((t) => t.v === 58)!.zone).toBe('neg')
    expect(g.ticks.find((t) => t.v === 60)!.zone).toBe('warn')
    expect(dialGeom(200).ticks.every((t) => t.zone === null)).toBe(true)
  })
  test('ticks light as the needle passes; the ones right behind it are heavier', () => {
    const t = dialGeom(200).ticks
    expect(t.filter((k) => tickLook(k, 50).lit)).toHaveLength(26) // 0 … 50
    expect(tickLook(t[25], 50).width).toBeGreaterThan(tickLook(t[0], 50).width)
    expect(tickLook(t[30], 50).lit).toBe(false)
    expect(t.some((k) => tickLook(k, 0).lit && k.v > 0)).toBe(false)
  })
})
