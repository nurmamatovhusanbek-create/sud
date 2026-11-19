import { describe, expect, test } from 'bun:test'
import { formatClaimAmount, formatDate } from '../billing-format'

describe('formatDate (receipts, bills list)', () => {
  test('dd.mm.yyyy HH:MM, never an English month', () => {
    const d = new Date(2026, 8, 12, 10, 5).getTime()
    expect(formatDate(d)).toBe('12.09.2026 10:05')
    expect(formatDate(d)).not.toMatch(/[A-Za-z]/)
  })
  test('empty / invalid → «-»', () => {
    expect(formatDate(null)).toBe('-')
    expect(formatDate(0)).toBe('-')
    expect(formatDate(Number.NaN)).toBe('-')
  })
})

describe('formatClaimAmount', () => {
  test('a bare number is grouped, decimals keep a comma', () => {
    expect(formatClaimAmount('1000000')).toBe('1 000 000')
    expect(formatClaimAmount('9999999')).toBe('9 999 999')
    expect(formatClaimAmount('1234567.5')).toBe('1 234 567,5')
    expect(formatClaimAmount('950')).toBe('950')
  })
  test('what the site already formatted, text and dashes are returned as they are', () => {
    expect(formatClaimAmount('272 628 881,58')).toBe('272 628 881,58')
    expect(formatClaimAmount('-')).toBe('-')
    expect(formatClaimAmount('  ')).toBe('')
    expect(formatClaimAmount(undefined)).toBe('')
    expect(formatClaimAmount('aniqlanmagan')).toBe('aniqlanmagan')
  })
})
