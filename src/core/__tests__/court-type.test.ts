import { describe, expect, test } from 'bun:test'
import { courtTypeForCase, normalizeCourtType } from '../billing-format'

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

describe('courtTypeForCase: MILITARY and unknown billing codes are settled by the case number', () => {
  test('a known billing code wins over the prefix', () => {
    expect(courtTypeForCase('CITIZEN', '4-1234/2025')).toBe('civil')
  })
  test('MILITARY (no equivalent) uses the prefix: 1- criminal, 2-/3- civil, 4- economic, 5- administrative', () => {
    expect(courtTypeForCase('MILITARY', '1-1234/2025')).toBe('criminal')
    expect(courtTypeForCase('MILITARY', '2-77/2025')).toBe('civil')
    expect(courtTypeForCase('MILITARY', '3-77/2025')).toBe('civil')
    expect(courtTypeForCase('MILITARY', '4-5/2025')).toBe('economic')
    expect(courtTypeForCase('MILITARY', '5-5/2025')).toBe('administrative')
  })
  test('no code and no recognisable prefix → null (the caller chooses), never a guess', () => {
    expect(courtTypeForCase('MILITARY', 'X-1')).toBeNull()
    expect(courtTypeForCase(undefined, '')).toBeNull()
    expect(courtTypeForCase(null, undefined)).toBeNull()
  })
})
