import { describe, expect, test } from 'bun:test'
import { NOTHING_NEW, PASS_SIZES, STABLE_OVERLAP, passIndexOfSize, passSize, passVerdict } from '../bill-passes'

describe('passVerdict', () => {
  test('a pass whose pages did not overlap covered every row once: finished, whatever the pass number', () => {
    expect(passVerdict({ rows: 241_541, overlap: 0, added: 200_000, total: 241_541 }, 0)).toEqual({ done: true, stable: true })
    expect(passVerdict({ rows: 100, overlap: 0, added: 5, total: 100 }, 2)).toEqual({ done: true, stable: true })
  })

  test('a handful of repeats (a bill split across a page boundary) is still stable', () => {
    expect(passVerdict({ rows: 100_000, overlap: 3, added: 1, total: 100_000 }, 0).stable).toBe(true)
    // the bank's real first pass: 400 + 9 109 + 1 021 of 100 000 rows repeated an earlier page: NOT stable
    expect(passVerdict({ rows: 100_000, overlap: 10_530, added: 86_318, total: 241_541 }, 0)).toEqual({ done: false, stable: false })
  })

  test('the stable share is the constant', () => {
    expect(passVerdict({ rows: 1000, overlap: Math.floor(1000 * STABLE_OVERLAP) - 1, added: 0, total: 1000 }, 0).stable).toBe(true)
    expect(passVerdict({ rows: 1000, overlap: Math.ceil(1000 * STABLE_OVERLAP) + 1, added: 0, total: 1000 }, 0).stable).toBe(false)
  })

  test('an unstable pass asks for another; a later pass that finds almost nothing new ends it, not stable', () => {
    expect(passVerdict({ rows: 241_541, overlap: 40_000, added: 100_000, total: 241_541 }, 0).done).toBe(false)
    expect(passVerdict({ rows: 241_541, overlap: 40_000, added: 100, total: 241_541 }, 1)).toEqual({ done: true, stable: false })
    expect(passVerdict({ rows: 241_541, overlap: 40_000, added: Math.ceil(241_541 * NOTHING_NEW) + 10, total: 241_541 }, 1).done).toBe(false)
  })

  test('the first pass never ends a load because it added little: a fresh store has nothing to compare with', () => {
    expect(passVerdict({ rows: 1000, overlap: 400, added: 0, total: 1000 }, 0).done).toBe(false)
  })

  test('the last pass ends it, not stable', () => {
    expect(passVerdict({ rows: 1000, overlap: 400, added: 900, total: 1000 }, PASS_SIZES.length - 1)).toEqual({ done: true, stable: false })
  })

  test('an empty pass is not stable', () => {
    expect(passVerdict({ rows: 0, overlap: 0, added: 0, total: 0 }, 0).stable).toBe(false)
  })
})

describe('pass sizes', () => {
  test('each pass has another page size so the boundaries move', () => {
    expect(new Set(PASS_SIZES).size).toBe(PASS_SIZES.length)
    expect(passSize(0)).toBe(10_000)
    expect(passSize(1)).not.toBe(passSize(0))
    expect(passSize(99)).toBe(PASS_SIZES.at(-1)!)
    expect(passIndexOfSize(9_000)).toBe(1)
    expect(passIndexOfSize(1234)).toBe(0)
  })
})
