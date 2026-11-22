import { describe, expect, test } from 'bun:test'
import { salvageJsonArray } from '../json-salvage'

describe('salvageJsonArray', () => {
  const rows = [{ a: 1, s: 'x}"y' }, { a: 2, n: { deep: [1, 2, { z: '\\"' }] } }, { a: 3 }]
  const whole = JSON.stringify(rows)

  test('a complete array parses normally', () => {
    expect(salvageJsonArray(whole)).toEqual({ items: rows, complete: true })
  })
  test('cut in the middle of the 3rd element: the first two come back, marked incomplete', () => {
    const cut = whole.slice(0, whole.lastIndexOf('{') + 4)
    const r = salvageJsonArray(cut)
    expect(r.complete).toBe(false)
    expect(r.items).toEqual(rows.slice(0, 2))
  })
  test('braces, brackets, quotes and escapes inside strings do not confuse the scan', () => {
    const cut = whole.slice(0, whole.indexOf('{"a":2') + 6)
    expect(salvageJsonArray(cut).items).toEqual([rows[0]])
  })
  test('cut right after a comma, after the last element, or at "["', () => {
    expect(salvageJsonArray('[{"a":1},').items).toEqual([{ a: 1 }])
    expect(salvageJsonArray('[{"a":1},{"a":2}').items).toEqual([{ a: 1 }, { a: 2 }])
    expect(salvageJsonArray('[')).toEqual({ items: [], complete: false })
  })
  test('garbage and empty input', () => {
    expect(salvageJsonArray('')).toEqual({ items: [], complete: false })
    expect(salvageJsonArray('Web Page Blocked!')).toEqual({ items: [], complete: false })
    expect(salvageJsonArray('[]')).toEqual({ items: [], complete: true })
  })
  test('thousands of rows cut at an arbitrary byte keep every complete row', () => {
    const big = Array.from({ length: 5000 }, (_, i) => ({ i, name: `Mijoz ${i} "MCHJ"`, reviews: [{ i }] }))
    const text = JSON.stringify(big)
    const cut = text.slice(0, Math.floor(text.length * 0.8))
    const r = salvageJsonArray(cut)
    expect(r.complete).toBe(false)
    expect(r.items.length).toBeGreaterThan(3900)
    expect(r.items.length).toBeLessThan(4100)
    r.items.forEach((x, i) => expect((x as { i: number }).i).toBe(i)) // in order, none damaged
  })
})
