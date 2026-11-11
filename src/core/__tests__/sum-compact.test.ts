import { describe, expect, test } from 'bun:test'
import { formatSumCompact, groupDigits } from '../billing-format'

describe('formatSumCompact (input is tiyins)', () => {
  test('scales by size', () => {
    expect(formatSumCompact(90_000)).toBe('900')
    expect(formatSumCompact(85_000_000)).toBe('850 ming')
    expect(formatSumCompact(3_720_000_000)).toBe('37,2 mln')
    expect(formatSumCompact(140_000_000_000)).toBe('1,4 mlrd')
  })
  test('a zero decimal is dropped', () => {
    expect(formatSumCompact(500_000_000)).toBe('5 mln')
  })
  test('nothing is zero', () => {
    expect(formatSumCompact(null)).toBe('0')
    expect(formatSumCompact(0)).toBe('0')
  })
})

describe('groupDigits (a court claim amount, in soʻm)', () => {
  test('groups a plain number in threes with a non-breaking space', () => {
    expect(groupDigits('554300000')).toBe('554\u00a0300\u00a0000')
    expect(groupDigits('12500000.50')).toBe('12\u00a0500\u00a0000.50')
    expect(groupDigits('999')).toBe('999')
  })
  test('anything else comes back as written', () => {
    expect(groupDigits('554 300 000')).toBe('554 300 000')
    expect(groupDigits('1 mln dan 2 mlngacha')).toBe('1 mln dan 2 mlngacha')
    expect(groupDigits(undefined)).toBe('')
    expect(groupDigits('  ')).toBe('')
  })
})
