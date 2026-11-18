import { describe, expect, test } from 'bun:test'
import { ordersGapMs } from '../pace'

describe('ordersGapMs (PUBLIC_ORDERS_MIN_GAP_MS)', () => {
  test('defaults to one request every 10 seconds', () => {
    expect(ordersGapMs({})).toBe(10_000)
    expect(ordersGapMs({ PUBLIC_ORDERS_MIN_GAP_MS: '' })).toBe(10_000)
  })
  test('can be changed, and 0 switches pacing off', () => {
    expect(ordersGapMs({ PUBLIC_ORDERS_MIN_GAP_MS: '3000' })).toBe(3_000)
    expect(ordersGapMs({ PUBLIC_ORDERS_MIN_GAP_MS: '0' })).toBe(0)
  })
  test('nonsense falls back to the default; absurd values are capped', () => {
    expect(ordersGapMs({ PUBLIC_ORDERS_MIN_GAP_MS: 'abc' })).toBe(10_000)
    expect(ordersGapMs({ PUBLIC_ORDERS_MIN_GAP_MS: '-5' })).toBe(0)
    expect(ordersGapMs({ PUBLIC_ORDERS_MIN_GAP_MS: '99999999' })).toBe(120_000)
  })
})
