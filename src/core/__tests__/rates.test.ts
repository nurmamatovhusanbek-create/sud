import { describe, expect, test } from 'bun:test'
import { contested, winRate, winRateText } from '../rates'

describe('winRate = won ÷ (won + lost)', () => {
  test('counts only contested cases', () => {
    expect(winRate(1, 4)).toBe(20)
    expect(winRate(2, 2)).toBe(50)
    expect(winRate(3, 0)).toBe(100)
    expect(winRate(0, 5)).toBe(0)
  })
  test('rounds to a whole percent', () => {
    expect(winRate(1, 2)).toBe(33)
    expect(winRate(2, 1)).toBe(67)
  })
  test('nothing decided is null, never 0%', () => {
    expect(winRate(0, 0)).toBeNull()
    expect(winRateText(0, 0)).toBe('–')
    expect(winRateText(1, 1)).toBe('50%')
  })
  test('contested', () => expect(contested(3, 4)).toBe(7))
})
