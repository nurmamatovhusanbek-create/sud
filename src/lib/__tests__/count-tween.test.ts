import { describe, expect, test } from 'bun:test'
import { COUNT_MAX_MS, COUNT_MIN_MS, countAt, countDuration, easeOutCubic } from '../count-tween'

/** drives the same loop as `CountUp`: targets arrive while a count runs, each retarget continues from what is on screen */
function simulate(targets: number[], arriveEveryMs: number): number[] {
  let current = 0
  const shown: number[] = []
  for (let i = 0; i < targets.length; i++) {
    const to = targets[i]
    const from = current
    const dur = countDuration(to - from)
    const until = i === targets.length - 1 ? dur : arriveEveryMs
    for (let step = 16; step <= until + 15; step += 16) {
      const p = Math.min(1, step / dur)
      current = p >= 1 ? to : countAt(from, to, p)
      shown.push(Math.round(current))
      if (p >= 1 || step >= until) break
    }
  }
  return shown
}

describe('count tween', () => {
  test('easing runs 0 → 1 and is clamped', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(-3)).toBe(0)
    expect(easeOutCubic(9)).toBe(1)
  })

  test('a tween starts at `from` and ends at `to`', () => {
    expect(countAt(3, 8, 0)).toBe(3)
    expect(countAt(3, 8, 1)).toBe(8)
  })

  test('duration: short for a step, full for a jump, never outside the limits', () => {
    expect(countDuration(1)).toBeGreaterThanOrEqual(COUNT_MIN_MS)
    expect(countDuration(1)).toBeLessThan(countDuration(40))
    expect(countDuration(10_000)).toBe(COUNT_MAX_MS)
    expect(countDuration(-1)).toBe(countDuration(1))
  })

  test('invoices arriving one by one count 1 → 5 and never drop back (the «1-2-1-2-3-1-2-3-4» bug)', () => {
    for (const gap of [40, 120, 300, 700]) {
      const shown = simulate([1, 2, 3, 4, 5], gap)
      for (let i = 1; i < shown.length; i++) expect(shown[i]).toBeGreaterThanOrEqual(shown[i - 1])
      expect(shown[shown.length - 1]).toBe(5)
    }
  })

  test('a retarget in mid-count continues from the value on screen, not from the old start', () => {
    const half = countAt(0, 10, 0.5)
    const next = countAt(half, 12, 0.01)
    expect(next).toBeGreaterThan(half - 0.001)
    expect(next).toBeGreaterThan(5) // restarting from 0 would be < 1
  })
})
