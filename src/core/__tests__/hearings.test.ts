import { describe, expect, test } from 'bun:test'
import { hearingDateKey, todayKeyUz } from '../hearings'

describe('hearing dates', () => {
  test('dd.mm.yyyy becomes a sortable number; anything else is 0', () => {
    expect(hearingDateKey('15.12.2030')).toBe(20301215)
    expect(hearingDateKey('5.1.2031 10:00')).toBe(20310105)
    for (const bad of ['', '-', null, undefined, '2030-12-15', '32.01.2030', '10.13.2030']) expect(hearingDateKey(bad)).toBe(0)
  })
  test('never compare the strings: 10.01.2023 is after 15.12.2022', () => {
    expect('10.01.2023' < '15.12.2022').toBe(true)
    expect(hearingDateKey('10.01.2023')).toBeGreaterThan(hearingDateKey('15.12.2022'))
  })
  test('«today» is the date in Uzbekistan (UTC+5): 20:00 UTC is already tomorrow there', () => {
    expect(todayKeyUz(Date.parse('2026-11-22T18:59:00Z'))).toBe(20261122)
    expect(todayKeyUz(Date.parse('2026-11-22T19:00:00Z'))).toBe(20261123)
  })
})
