import { describe, expect, test } from 'bun:test'
import type { CaseCheck, RawPublication, StoredOrder } from '@/core/public-orders'
import { lookupCase, type CaseLookupDeps } from '../engine'

const DAY = 86_400_000
const CN = '4-1001-2619/21743'
const T0 = Date.parse('2026-06-01T10:00:00Z')

const row = (id: string, instance: string, caseNumber = CN): RawPublication => ({
  id,
  case_number: caseNumber,
  instance,
  result: 'FULFILLED',
  pdf: { id: 'pdf-' + id, name: id + '.pdf', size: 10 },
})

function rig(searchImpl: (cn: string, ct: string, instance: string) => Promise<RawPublication[]>, start = T0) {
  let clock = start
  const stored: StoredOrder[] = []
  const checks = new Map<string, CaseCheck>()
  const calls: string[] = []
  const deps: CaseLookupDeps = {
    search: (cn, ct, instance) => {
      calls.push(instance)
      return searchImpl(cn, ct, instance)
    },
    append: async (o) => void stored.push(...o),
    getChecked: async (cn) => checks.get(cn) ?? null,
    markChecked: async (c) => void checks.set(c.caseNumber, c),
    now: () => new Date(clock),
  }
  return { deps, stored, checks, calls, advance: (ms: number) => (clock += ms) }
}
const job = { caseNumber: CN, courtType: 'ECONOMIC' as const, sig: 'a' }

describe('lookupCase', () => {
  test('a first check asks every instance and stores what it finds', async () => {
    const r = rig(async (_c, _t, i) => (i === 'FIRST' ? [row('o1', 'FIRST')] : []))
    const out = await lookupCase(r.deps, job)
    expect(out.skipped).toBe(false)
    expect(out.found).toBe(1)
    expect(r.calls.sort()).toEqual(['APPEAL', 'CASSATION', 'FIRST', 'INSPECTION'])
    expect(r.stored.map((o) => o.id)).toEqual(['o1'])
    expect(r.checks.get(CN)?.seen).toEqual(['FIRST'])
  })

  test('once an instance has a published order it is never asked again', async () => {
    const r = rig(async (_c, _t, i) => (i === 'FIRST' ? [row('o1', 'FIRST')] : []))
    await lookupCase(r.deps, job)
    r.calls.length = 0
    r.advance(4 * DAY)
    await lookupCase(r.deps, { ...job, sig: 'b' })
    expect(r.calls.sort()).toEqual(['APPEAL', 'CASSATION', 'INSPECTION'])
  })

  test('all instances published: permanently done, no request even when forced', async () => {
    const r = rig(async (_c, _t, i) => [row('o-' + i, i)])
    await lookupCase(r.deps, job)
    r.calls.length = 0
    r.advance(400 * DAY)
    const out = await lookupCase(r.deps, { ...job, sig: 'zzz' }, { force: true })
    expect(out.skipped).toBe(true)
    expect(out.reason).toBe('done')
    expect(r.calls).toEqual([])
  })

  test('an unchanged case with nothing published waits, then backs off 3 d, 14 d, 45 d, then stops', async () => {
    const r = rig(async () => [])
    await lookupCase(r.deps, job) // misses 1
    const steps: [number, boolean][] = [[1, false], [3, true], [10, false], [14, true], [30, false], [45, true], [400, false]]
    for (const [days, ran] of steps) {
      r.advance(days * DAY)
      const out = await lookupCase(r.deps, job)
      expect(out.skipped).toBe(!ran)
    }
  })

  test('a changed case (appealed, result set) is re-checked at once and the back-off starts over', async () => {
    const r = rig(async () => [])
    await lookupCase(r.deps, job)
    r.advance(1000)
    const out = await lookupCase(r.deps, { ...job, sig: 'appealed' })
    expect(out.skipped).toBe(false)
    expect(out.reason).toBe('sig-changed')
    expect(r.checks.get(CN)?.misses).toBe(0)
  })

  test('a failed search is an error to retry after 10 minutes, never «no orders», and does not eat a back-off step', async () => {
    let fail = true
    const r = rig(async () => {
      if (fail) throw new Error('upstream 504')
      return []
    })
    const bad = await lookupCase(r.deps, job)
    expect(bad.error).toBe('upstream 504')
    expect(r.checks.get(CN)?.misses).toBe(0)
    r.advance(60_000)
    expect((await lookupCase(r.deps, job)).skipped).toBe(true)
    r.advance(11 * 60_000)
    fail = false
    const ok = await lookupCase(r.deps, job)
    expect(ok.skipped).toBe(false)
    expect(ok.error).toBeUndefined()
    expect(r.checks.get(CN)?.misses).toBe(0)
  })

  test('one instance failing keeps the orders the others found and flags the run', async () => {
    const r = rig(async (_c, _t, i) => {
      if (i === 'APPEAL') throw new Error('timeout')
      return i === 'FIRST' ? [row('o1', 'FIRST')] : []
    })
    const out = await lookupCase(r.deps, job)
    expect(out.found).toBe(1)
    expect(out.error).toBeTruthy()
    expect(r.checks.get(CN)?.seen).toEqual(['FIRST'])
  })

  test('the search is a «contains»: rows of a longer case number are ignored', async () => {
    const r = rig(async (_c, _t, i) => (i === 'FIRST' ? [row('x', 'FIRST', CN + '9'), row('ok', 'FIRST')] : []))
    await lookupCase(r.deps, job)
    expect(r.stored.map((o) => o.id)).toEqual(['ok'])
  })

  test('force re-checks a waiting case', async () => {
    const r = rig(async () => [])
    await lookupCase(r.deps, job)
    r.calls.length = 0
    const out = await lookupCase(r.deps, job, { force: true })
    expect(out.reason).toBe('forced')
    expect(r.calls).toHaveLength(4)
  })
})

describe('lookupCase: the pre-2024 system', () => {
  const legacyOrder = (instance: string, id = 'old-economic-1'): StoredOrder => ({ id, caseNumber: CN, instance, result: 'FULFILLED', court: 'c', judge: 'j', category: '', pdfId: 'old-economic-9', pdfName: '', pdfSize: 0, courtType: 'ECONOMIC' })

  test('both systems are asked; orders from either are stored; the legacy instance counts as seen', async () => {
    const r = rig(async (_c, _t, i) => (i === 'APPEAL' ? [row('n1', 'APPEAL')] : []))
    r.deps.searchLegacy = async () => [legacyOrder('FIRST'), { ...legacyOrder('FIRST', 'old-economic-2'), caseNumber: '4-1001-2619/99999' }]
    const out = await lookupCase(r.deps, job)
    expect(out.found).toBe(2) // the other case's row is dropped (the search is a «contains»)
    expect(r.stored.map((o) => o.id).sort()).toEqual(['n1', 'old-economic-1'])
    expect(r.checks.get(CN)!.seen.sort()).toEqual(['APPEAL', 'FIRST'])
  })
  test('a failing legacy search is a partial error, never a false «none published»', async () => {
    const r = rig(async () => [])
    r.deps.searchLegacy = async () => { throw new Error('HTTP 502') }
    const out = await lookupCase(r.deps, job)
    expect(out.found).toBe(0)
    expect(out.error).toContain('HTTP 502')
    expect(r.checks.get(CN)!.error).toBeDefined()
  })
  test('criminal has no library rows: only the pre-2024 endpoint is asked', async () => {
    const r = rig(async () => { throw new Error('the library must not be asked for criminal') })
    r.deps.searchLegacy = async () => [{ ...legacyOrder('FIRST'), courtType: 'CRIMINAL' }]
    const out = await lookupCase(r.deps, { ...job, courtType: 'CRIMINAL' })
    expect(r.calls).toEqual([])
    expect(out.found).toBe(1)
    expect(out.error).toBeUndefined()
  })
})
