import { describe, expect, test } from 'bun:test'
import { ordersFileGapMs, ordersGapMs } from '../pace'

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

describe('ordersFileGapMs (PUBLIC_ORDERS_FILE_GAP_MS): the rest between two PDF downloads, counted from the end of the previous one', () => {
  test('defaults to 4 seconds; can be changed; 0 = no rest; nonsense falls back; capped', () => {
    expect(ordersFileGapMs({})).toBe(4_000)
    expect(ordersFileGapMs({ PUBLIC_ORDERS_FILE_GAP_MS: '2500' })).toBe(2_500)
    expect(ordersFileGapMs({ PUBLIC_ORDERS_FILE_GAP_MS: '0' })).toBe(0)
    expect(ordersFileGapMs({ PUBLIC_ORDERS_FILE_GAP_MS: 'abc' })).toBe(4_000)
    expect(ordersFileGapMs({ PUBLIC_ORDERS_FILE_GAP_MS: '99999999' })).toBe(120_000)
  })
})
