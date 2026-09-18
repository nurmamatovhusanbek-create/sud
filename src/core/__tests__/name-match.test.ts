import { describe, expect, test } from 'bun:test'
import { normalizeName, nameKey } from '@/lib/name-match'

/**
 * v205: tests for the docket-index name normalizer (guide §5.3).
 * Pure functions — the Cyrillic fold + legal-form strip must collapse
 * real-world variants of the same company to the same token.
 */

describe('normalizeName', () => {
  test('folds Cyrillic to Latin', () => {
    expect(normalizeName('МЧЖ «АРТИКУЛ»')).toBe(normalizeName('ARTIKUL'))
  })

  test('strips legal forms both scripts', () => {
    const a = normalizeName('МЧЖ «SAMARQAND BUILDING»')
    const b = normalizeName('Samarqand Building LLC')
    expect(a).toBe(b)
    expect(a).not.toContain('mchj')
    expect(a).not.toContain('llc')
  })

  test('handles Uzbek-specific letters', () => {
    // ў->o, қ->q, ғ->g, ҳ->h
    expect(normalizeName('ҚҚ «ЎЗБЕК ТЕХНОЛИК»')).toBe(normalizeName('ozbek texnolik kk'))
  })

  test('drops punctuation and collapses spaces', () => {
    expect(normalizeName('Ooo "A-B, C.D"')).toBe('a b c d')
  })

  test('empty/null-safe', () => {
    expect(normalizeName('')).toBe('')
    expect(normalizeName(null)).toBe('')
    expect(normalizeName(undefined)).toBe('')
  })
})

describe('nameKey', () => {
  test('keeps first N significant tokens, drops short ones', () => {
    expect(nameKey('МЧЖ «АГРО ИНДУСТРИЯ СЕРВИС»', 3)).toBe('agro industriya servis')
  })
})
