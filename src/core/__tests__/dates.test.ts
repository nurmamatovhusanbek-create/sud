import { describe, expect, test } from 'bun:test'
import { dateKey, daysUntil, formatDmy, parseYmd } from '../dates'

describe('dateKey — sort dd.mm.yyyy by DATE, not by string', () => {
  test('the raw strings mis-order (the bug this guards against)', () => {
    expect('10.01.2023' < '15.12.2022').toBe(true) // wrong: Jan 2023 is AFTER Dec 2022
  })
  test('keys order chronologically', () => {
    expect(dateKey('10.01.2023') > dateKey('15.12.2022')).toBe(true)
    const sorted = ['10.01.2023', '15.12.2022', '02.12.2022'].sort((a, b) => dateKey(a).localeCompare(dateKey(b)))
    expect(sorted).toEqual(['02.12.2022', '15.12.2022', '10.01.2023'])
  })
  test('ISO passes through; garbage is returned unchanged', () => {
    expect(dateKey('2026-10-02')).toBe('2026-10-02')
    expect(dateKey('soon')).toBe('soon')
    expect(dateKey('')).toBe('')
    expect(dateKey(undefined)).toBe('')
  })
})

describe('parseYmd', () => {
  test('parses both formats and rejects the rest', () => {
    expect(parseYmd('29.09.2026')).toEqual({ y: 2026, m: 9, d: 29 })
    expect(parseYmd('2026-09-29')).toEqual({ y: 2026, m: 9, d: 29 })
    expect(parseYmd('29/09/2026')).toBeNull()
    expect(parseYmd('5.9.2026')).toBeNull()
    expect(parseYmd(null)).toBeNull()
  })
})

describe('daysUntil', () => {
  const NOW = new Date(2026, 8, 29, 15, 30) // 29 Sep 2026, mid-afternoon
  test('is calendar-day based (time of day does not matter)', () => {
    expect(daysUntil('29.09.2026', NOW)).toBe(0)
    expect(daysUntil('04.10.2026', NOW)).toBe(5)
    expect(daysUntil('28.09.2026', NOW)).toBe(-1)
    expect(daysUntil('2026-10-02', NOW)).toBe(3)
  })
  test('null when unparseable', () => {
    expect(daysUntil('', NOW)).toBeNull()
    expect(daysUntil('x', NOW)).toBeNull()
  })
})

describe('formatDmy', () => {
  test('zero-pads', () => expect(formatDmy(new Date(2026, 0, 5))).toBe('05.01.2026'))
})
