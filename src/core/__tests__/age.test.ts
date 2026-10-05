import { describe, expect, test } from 'bun:test'
import { ageLabel } from '../age'

const MIN = 60_000
const NOW = 1_700_000_000_000

describe('ageLabel', () => {
  test.each([
    [0, 'hozirgina'],
    [59_000, 'hozirgina'],
    [MIN, '1 daqiqa oldin'],
    [59 * MIN, '59 daqiqa oldin'],
    [60 * MIN, '1 soat oldin'],
    [23 * 60 * MIN + 59 * MIN, '23 soat oldin'],
    [24 * 60 * MIN, '1 kun oldin'],
    [3 * 24 * 60 * MIN, '3 kun oldin'],
  ])('%d ms → %s', (ms, label) => expect(ageLabel(NOW - ms, NOW)).toBe(label))

  test('a time in the future (clock skew) reads as just now', () => {
    expect(ageLabel(NOW + 5 * MIN, NOW)).toBe('hozirgina')
  })
})
