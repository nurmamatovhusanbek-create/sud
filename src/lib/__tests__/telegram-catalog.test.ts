import { describe, expect, mock, test } from 'bun:test'

mock.module('server-only', () => ({}))
const { buildCatalog } = await import('../telegram-catalog')

const b = (name: string, rows: number) => ({ name, id: name, rows, bytes: 1, parts: [] })

describe('what «Kanaldagi kompaniyalar» counts per company', () => {
  test('bills, cases found by number, the court lists and the hearings are counted apart (the two kinds of cases overlap, so they are not added)', () => {
    const c = buildCatalog({
      v: 2, id: 'x', created: '2026-11-26T10:00:00.000Z', since: '2026-11-20T10:00:00.000Z', app: 'sud-tizimi',
      companies: { '207324986': { firstAt: 1, refreshedAt: 2 } },
      buckets: [b('bills:207324986:2025', 100), b('bills:207324986:2026', 40), b('found:207324986:civil:25', 30), b('found:207324986:economic:26', 10), b('lists:207324986', 196), b('hearings:207324986', 3), b('state:207324986', 1), b('orders:26', 9)],
      prev: null,
    } as never)
    expect(c.companies).toEqual([{ tin: '207324986', firstAt: 1, refreshedAt: 2, bills: 140, found: 40, listed: 196, hearings: 3 }])
  })
})
