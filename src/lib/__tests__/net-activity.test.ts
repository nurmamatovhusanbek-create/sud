import { describe, expect, test } from 'bun:test'
import { beginActivity, inflightCount } from '../net-activity'

describe('net-activity', () => {
  test('counts requests in flight and ends each exactly once', () => {
    const base = inflightCount()
    const a = beginActivity()
    const b = beginActivity()
    expect(inflightCount()).toBe(base + 2)
    a()
    a() // a second call of the same end function must not drop another request
    expect(inflightCount()).toBe(base + 1)
    b()
    expect(inflightCount()).toBe(base)
  })
})
