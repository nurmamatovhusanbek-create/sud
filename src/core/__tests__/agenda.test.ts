import { describe, expect, test } from 'bun:test'
import { calendarDaysUntil, groupByDay, longDate, relativeDay, weekStrip } from '../agenda'

// Thursday 12 November 2026, late in the evening (the hour must not matter)
const NOW = new Date(2026, 10, 12, 23, 30)

describe('calendarDaysUntil', () => {
  test('counts calendar days, whatever the hour', () => {
    expect(calendarDaysUntil('2026-11-12', NOW)).toBe(0)
    expect(calendarDaysUntil('2026-11-13', NOW)).toBe(1)
    expect(calendarDaysUntil('2026-11-11', NOW)).toBe(-1)
    expect(calendarDaysUntil('2026-11-12', new Date(2026, 10, 12, 0, 0, 1))).toBe(0)
    expect(calendarDaysUntil('2027-01-01', NOW)).toBe(50)
  })
  test('rejects what is not a date', () => {
    for (const bad of ['', '12.11.2026', '2026-13-01', 'abc']) expect(calendarDaysUntil(bad, NOW)).toBeNull()
  })
})

describe('groupByDay', () => {
  const rows = [
    { iso: '2026-11-14', time: '14:00', id: 'c' },
    { iso: '2026-11-12', time: '11:30', id: 'b' },
    { iso: '2026-11-12', id: 'no-time' },
    { iso: '2026-11-12', time: '9:00', id: 'a' },
    { iso: '2026-11-10', time: '10:00', id: 'past' },
    { iso: 'nonsense', id: 'bad' },
    { iso: '2026-11-14', time: '14:00', id: 'd' },
  ]
  const g = groupByDay(rows, NOW)

  test('one group per day, nearest first, past and invalid dropped', () => {
    expect(g.map((d) => [d.iso, d.days])).toEqual([['2026-11-12', 0], ['2026-11-14', 2]])
  })
  test('inside a day: by time (9:00 before 11:30), no time last, ties keep their order', () => {
    expect(g[0].items.map((r) => r.id)).toEqual(['a', 'b', 'no-time'])
    expect(g[1].items.map((r) => r.id)).toEqual(['c', 'd'])
  })
  test('does not reorder the input', () => {
    expect(rows[0].id).toBe('c')
  })
  test('nothing upcoming is an empty list', () => {
    expect(groupByDay([{ iso: '2020-01-01' }], NOW)).toEqual([])
  })
})

describe('weekStrip', () => {
  test('seven days from today with their counts, empty days included', () => {
    const strip = weekStrip(groupByDay([{ iso: '2026-11-12' }, { iso: '2026-11-12' }, { iso: '2026-11-18' }, { iso: '2026-11-19' }], NOW), NOW)
    expect(strip.map((s) => s.count)).toEqual([2, 0, 0, 0, 0, 0, 1])
    expect(strip[0]).toEqual({ iso: '2026-11-12', days: 0, day: 12, weekday: 4, count: 2 })
    expect(strip[6].iso).toBe('2026-11-18')
  })
  test('crosses a month end', () => {
    const strip = weekStrip([], new Date(2026, 10, 28, 8))
    expect(strip.map((s) => s.day)).toEqual([28, 29, 30, 1, 2, 3, 4])
    expect(strip[3].iso).toBe('2026-12-01')
  })
})

describe('labels', () => {
  test('relative day', () => {
    expect(relativeDay(0)).toBe('Bugun')
    expect(relativeDay(1)).toBe('Ertaga')
    expect(relativeDay(5)).toBe('5 kundan keyin')
  })
  test('long date, year only when it differs', () => {
    expect(longDate('2026-11-12', NOW)).toBe('payshanba, 12-noyabr')
    expect(longDate('2027-01-04', NOW)).toBe('dushanba, 4-yanvar 2027')
    expect(longDate('bad', NOW)).toBe('bad')
  })
})
