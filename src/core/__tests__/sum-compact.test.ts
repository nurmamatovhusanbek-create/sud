import { describe, expect, test } from 'bun:test'
import { formatSumCompact } from '../billing-format'

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
