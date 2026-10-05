/**
 * «Upcoming hearings» for a case that is in APPEAL.
 *
 * Reported: economic case 4-1001-2621/42935, in appeal, heard today, did not show
 * under the defendant's TIN. jadvalapi keeps the first-instance hearing at the top of
 * the row and the appeal hearing inside `reviews[]`; the list mapper read only the top.
 * The network (workers, through fetch) is faked; nothing here leaves the machine.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'

mock.module('server-only', () => ({}))
const WORKERS = ['https://w1.example/', 'https://w2.example/']
mock.module('@/lib/cf-worker-pool', () => ({
  getCfWorkerUrls: () => WORKERS,
  createWorkerPool: () => ({ nextProxyUrl: (u: string) => u }),
  OriginHealthPool: class {
    recordSuccess() {}
    recordFailure() {}
  },
}))

const today = new Date()
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
const TODAY = dmy(today)
const OLD = dmy(new Date(today.getFullYear(), today.getMonth() - 6, 3))

const appealCase = {
  casenumber: '4-1001-2621/42935', court: 'Toshkent shahar iqtisodiy sudi', category: 'Qarz undirish',
  status_name: 'Apellyatsiya', instance: 'Биринчи инстанция', claiment: 'ALFA MCHJ', defendant: 'BETA MCHJ',
  hearing_date: OLD, hearing_time: '10:00', responsible: 'Karimov',
  reviews: [{
    instance: 'Апелляция инстанцияси', court: 'Toshkent shahar iqtisodiy apellyatsiya sudi',
    hearing_date: TODAY, hearing_time: '14:30', responsible: 'Aliyev',
  }],
}

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const full = String(input)
  const worker = WORKERS.find((w) => full.startsWith(w)) ?? ''
  const url = full.slice(worker.length)
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  if (url.includes('jadvalapi.sud.uz') && url.includes('ECONOMIC/findByTin/309922239')) return json([appealCase])
  return new Response('[]', { status: 404 })
}) as typeof fetch
afterAll(() => {
  globalThis.fetch = realFetch
})

const { searchCourtCases } = await import('../court-case')
const { upcomingHearingsSource } = await import('@/sources')

describe('appeal hearing under the defendant\'s TIN', () => {
  test('the list row carries the appeal hearing, its court and judge', async () => {
    const [c] = await searchCourtCases('economic', 'tin', '309922239')
    expect(c.caseNumber).toBe('4-1001-2621/42935')
    expect(c.hearingDate).toBe(TODAY)
    expect(c.hearingTime).toBe('14:30')
    expect(c.hearingStage).toBe('appeal')
    expect(c.courtName).toContain('apellyatsiya')
    expect(c.judge).toBe('Aliyev')
  })

  test('upcoming hearings lists it for today', async () => {
    const r = await upcomingHearingsSource.run('309922239')
    expect(r.hearings.map((h) => h.caseNumber)).toContain('4-1001-2621/42935')
    expect(r.hearings[0].isoDate).toBe(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`)
  })
})
