import { describe, expect, test } from 'bun:test'
import { normalizeCourtType } from '../billing-format'

describe('normalizeCourtType: billing codes → case API court types', () => {
  test('the case API vocabulary passes through, in any case', () => {
    for (const t of ['economic', 'civil', 'criminal', 'administrative'] as const) {
      expect(normalizeCourtType(t)).toBe(t)
      expect(normalizeCourtType(t.toUpperCase())).toBe(t)
    }
  })
  test('billing.sud.uz codes: ECONOMIC · CITIZEN · ADMINISTRATIVE · CRIMINAL (the receipt → «courtType notoʻgʻri» bug)', () => {
    expect(normalizeCourtType('ECONOMIC')).toBe('economic')
    expect(normalizeCourtType('CITIZEN')).toBe('civil')
    expect(normalizeCourtType('ADMINISTRATIVE')).toBe('administrative')
    expect(normalizeCourtType('CRIMINAL')).toBe('criminal')
  })
  test('what the case API has no equivalent for is null, never a guess', () => {
    for (const t of ['MILITARY', '', '  ', 'nonsense', null, undefined]) expect(normalizeCourtType(t as string | null | undefined)).toBeNull()
  })
  test('surrounding spaces are tolerated', () => {
    expect(normalizeCourtType(' Citizen ')).toBe('civil')
  })
})
