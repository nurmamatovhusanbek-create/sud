import { describe, expect, test } from 'bun:test'
import { avatarHue, FIRST_DIR, nextSort, sortCompanies, type CompanySortRow } from '../company-sort'

const rows: CompanySortRow[] = [
  { stir: '3', name: '«UZAUTO MOTORS» AJ', score: 78, cases: 212, winRate: 64, hearingIso: '2026-11-15', debt: 0 },
  { stir: '1', name: '«ARTEL» MCHJ', score: 66, cases: 93, winRate: 58, hearingIso: '2026-11-13', debt: 500 },
  { stir: '2', name: 'Hamkorbank', score: null, cases: 1410, hearingIso: null },
  { stir: '4' },
]
const order = (key: Parameters<typeof sortCompanies>[1], dir: Parameters<typeof sortCompanies>[2]) => sortCompanies(rows, key, dir).map((r) => r.stir)

describe('sortCompanies', () => {
  test('name: quotes do not decide the alphabet, nameless last', () => {
    expect(order('name', 'asc')).toEqual(['1', '2', '3', '4'])
    expect(order('name', 'desc')).toEqual(['3', '2', '1', '4'])
  })
  test('numbers, unknown last in BOTH directions', () => {
    expect(order('rating', 'desc')).toEqual(['3', '1', '2', '4'])
    expect(order('rating', 'asc')).toEqual(['1', '3', '2', '4'])
  })
  test('a known zero is a value, not unknown', () => {
    expect(order('debt', 'desc')).toEqual(['1', '3', '2', '4'])
    expect(order('debt', 'asc')).toEqual(['3', '1', '2', '4'])
  })
  test('soonest hearing first, companies without one last', () => {
    expect(order('hearing', 'asc')).toEqual(['1', '3', '2', '4'])
  })
  test('does not mutate the input', () => {
    sortCompanies(rows, 'cases', 'desc')
    expect(rows[0].stir).toBe('3')
  })
})

describe('nextSort', () => {
  test('a new column starts in its natural direction', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'hearing')).toEqual({ key: 'hearing', dir: FIRST_DIR.hearing })
    expect(nextSort({ key: 'name', dir: 'asc' }, 'debt')).toEqual({ key: 'debt', dir: 'desc' })
  })
  test('the same column flips', () => {
    expect(nextSort({ key: 'debt', dir: 'desc' }, 'debt')).toEqual({ key: 'debt', dir: 'asc' })
  })
})

describe('avatarHue', () => {
  test('stable per STIR and always one of the six slots', () => {
    expect(avatarHue('302678824')).toBe(avatarHue('302678824'))
    for (const stir of ['200248856', '305111222', '306222333', '307333444', '308444555', '309555666', '', '1'])
      expect([0, 1, 2, 3, 4, 5]).toContain(avatarHue(stir))
  })
  test('different companies are spread over the palette', () => {
    const used = new Set(Array.from({ length: 60 }, (_, i) => avatarHue(String(300000000 + i * 7919))))
    expect(used.size).toBeGreaterThanOrEqual(5)
  })
})
