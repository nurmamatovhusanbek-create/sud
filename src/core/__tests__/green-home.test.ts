import { describe, expect, test } from 'bun:test'
import { weightedWinRate, winLabel } from '../green-home'

describe('weightedWinRate', () => {
  test('weighted by cases: a big company outweighs a small one', () => {
    expect(weightedWinRate([{ cases: 100, winRate: 80 }, { cases: 4, winRate: 0 }])).toBe(77)
  })
  test('unknown companies are left out; nothing known → null', () => {
    expect(weightedWinRate([{ cases: 10, winRate: 50 }, { cases: 5 }, { winRate: 90 }, { cases: 0, winRate: 90 }])).toBe(50)
    expect(weightedWinRate([])).toBeNull()
    expect(weightedWinRate([{ cases: 5 }])).toBeNull()
  })
})

test('winLabel bands', () => {
  expect(winLabel(null)).toBe('Maʼlumot yoʻq')
  expect([90, 75, 74, 55, 54, 35, 34, 0].map(winLabel)).toEqual(['Aʼlo', 'Aʼlo', 'Yaxshi', 'Yaxshi', 'Oʻrtacha', 'Oʻrtacha', 'Past', 'Past'])
})
