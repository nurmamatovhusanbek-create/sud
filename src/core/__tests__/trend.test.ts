import { describe, expect, test } from 'bun:test'
import { monthlyTrend } from '../trend'

const NOW = new Date(2026, 8, 29) // 29 Sep 2026

describe('monthlyTrend', () => {
  test('is always 12 months, oldest first, ending at the current month', () => {
    const t = monthlyTrend([], NOW)
    expect(t).toHaveLength(12)
    expect(t[0].label).toBe('Okt') // Oct 2025
    expect(t[11].label).toBe('Sen') // Sep 2026
    expect(t.every((p) => p.count === 0)).toBe(true)
  })

  test('counts cases into their registration month', () => {
    const t = monthlyTrend(
      [{ regDate: '02.09.2026' }, { regDate: '28.09.2026' }, { regDate: '15.06.2026' }, { regDate: '10.10.2025' }],
      NOW,
    )
    expect(t[11].count).toBe(2) // Sep 2026
    expect(t[8].count).toBe(1) // Jun 2026
    expect(t[0].count).toBe(1) // Oct 2025
  })

  test('ignores cases outside the window and malformed dates', () => {
    const t = monthlyTrend([{ regDate: '01.09.2025' }, { regDate: '' }, { regDate: '2026-09-02' }, { regDate: '5.9.2026' }], NOW)
    expect(t.reduce((a, p) => a + p.count, 0)).toBe(0)
  })

  test('the window rolls over a year boundary correctly', () => {
    const t = monthlyTrend([{ regDate: '05.01.2026' }], new Date(2026, 1, 10)) // now = Feb 2026
    expect(t[11].label).toBe('Fev')
    expect(t[10].label).toBe('Yan')
    expect(t[10].count).toBe(1)
    expect(t[0].label).toBe('Mar') // Mar 2025
  })
})
