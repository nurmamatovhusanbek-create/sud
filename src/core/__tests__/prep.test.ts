import { describe, expect, test } from 'bun:test'
import { prepChecklist, prepProgress } from '../prep'

const none = { caseRead: false, representative: false, documentPrepared: false }

describe('prepChecklist', () => {
  test('nothing known: nothing done', () => {
    const items = prepChecklist(none, new Set())
    expect(items.map((i) => i.done)).toEqual([false, false, false, false, false])
    expect(prepProgress(items)).toEqual({ done: 0, total: 5, ready: false })
  })
  test('what the app can tell it ticks itself and cannot be unticked', () => {
    const items = prepChecklist({ caseRead: true, representative: true, documentPrepared: true }, new Set())
    expect(items.filter((i) => i.auto).map((i) => i.id)).toEqual(['case', 'representative', 'documents'])
    expect(items.filter((i) => i.done)).toHaveLength(3)
  })
  test('the lawyer ticks the rest; the representative and documents can also be ticked by hand', () => {
    const items = prepChecklist({ ...none, caseRead: true }, new Set(['counterparty', 'orders', 'representative', 'documents']))
    expect(prepProgress(items)).toEqual({ done: 5, total: 5, ready: true })
    expect(items.find((i) => i.id === 'representative')!.auto).toBe(false)
  })
})
