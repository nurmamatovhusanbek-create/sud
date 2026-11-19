/**
 * The four instances of a case (first, appeal, cassation, taftish), each with ITS OWN court and judge. Reported: the first instance's judge was
 * shown for every instance (the case row, the court info, the decisions), and Taftish was missing. The network (workers) is faked.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'

mock.module('server-only', () => ({}))
const WORKERS = ['https://inst-w1.example/', 'https://inst-w2.example/']
const realPool = { ...(await import('@/lib/cf-worker-pool')) }
mock.module('@/lib/cf-worker-pool', () => ({
  getCfWorkerUrls: () => WORKERS,
  createWorkerPool: () => ({ nextProxyUrl: (u: string) => u }),
  OriginHealthPool: class {
    recordSuccess() {}
    recordFailure() {}
  },
}))

const CASE = '4-1001-2621/42936'
const raw = {
  casenumber: CASE, court: 'Toshkent shahar iqtisodiy sudi', category: 'Qarz undirish', status_name: 'Назоратда',
  instance: 'Биринчи инстанция', claiment: 'ALFA MCHJ', defendant: 'BETA MCHJ', reg_date: '01.02.2026',
  hearing_date: '03.03.2026', hearing_time: '10:00', responsible: 'Karimov', result: 'Даъво қаноатлантирилсин',
  reviews: [
    { instance: 'Апелляция инстанцияси', court: 'Appeal court', responsible: 'Aliyev', hearing_date: '04.05.2026', result: 'Рад этилсин', reg_date: '10.05.2026' },
    { instance: 'Кассация инстанцияси', court: 'Cassation court', responsible: 'Valiyev', hearing_date: '04.07.2026', result: '-' },
    { instance: 'Тафтиш инстанцияси', court: 'Taftish court', responsible: 'Tashev', hearing_date: '04.09.2026', result: 'Бекор қилинсин', reg_date: '10.09.2026' },
  ],
}

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const full = String(input)
  const worker = WORKERS.find((w) => full.startsWith(w)) ?? ''
  const url = full.slice(worker.length)
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  if (url.includes('findByTin/309922240')) return json([{ ...raw, casenumber: '4-1001-2621/42937', hearing_date: '', hearing_time: '', reviews: [{ instance: 'Апелляция инстанцияси', court: 'Appeal court', responsible: 'Aliyev' }] }])
  if (url.includes('jadval.sud.uz/case/findByNumber/') || url.includes('jadvalapi.sud.uz')) return json([raw])
  return new Response('[]', { status: 404 })
}) as typeof fetch
afterAll(() => {
  mock.module('@/lib/cf-worker-pool', () => realPool)
  globalThis.fetch = realFetch
})

const { getCaseDetails, searchCourtCases } = await import('../court-case')

describe('getCaseDetails: four instances, each with its own judge', () => {
  test('first / appeal / cassation / taftish carry their own court and judge', async () => {
    const d = await getCaseDetails('economic', CASE)
    expect(d.firstInstance).toMatchObject({ court: 'Toshkent shahar iqtisodiy sudi', judge: 'Karimov' })
    expect(d.appellate).toMatchObject({ court: 'Appeal court', judge: 'Aliyev' })
    expect(d.cassation).toMatchObject({ court: 'Cassation court', judge: 'Valiyev' })
    expect(d.inspection).toMatchObject({ court: 'Taftish court', judge: 'Tashev' })
  })
  test('the case is in Taftish now: the general judge and court are Taftish\'s, not the first instance\'s', async () => {
    const d = await getCaseDetails('economic', CASE)
    expect(d.general).toMatchObject({ currentInstance: 'inspection', judge: 'Tashev', court: 'Taftish court' })
  })
  test('each instance keeps ITS OWN hearing and decision', async () => {
    const d = await getCaseDetails('economic', CASE)
    expect(d.firstInstance?.hearings.map((h) => h.judge)).toEqual(['Karimov'])
    expect(d.appellate?.hearings.map((h) => [h.date, h.judge])).toEqual([['04.05.2026', 'Aliyev']])
    expect(d.inspection?.hearings.map((h) => h.judge)).toEqual(['Tashev'])
    expect(d.appellate?.decision?.text).toBe('Рад этилсин')
    expect(d.cassation?.decision).toBeNull() // «-» is no decision
    expect(d.inspection?.decision?.text).toBe('Бекор қилинсин')
  })
})

describe('the list row names the judge of the instance the case is in', () => {
  test('in appeal with no hearing known: the appeal judge and court, not the first instance\'s', async () => {
    const [c] = await searchCourtCases('economic', 'tin', '309922240')
    expect(c.caseNumber).toBe('4-1001-2621/42937')
    expect(c.hearingDate).toBe('')
    expect(c.judge).toBe('Aliyev')
    expect(c.courtName).toBe('Appeal court')
  })
})
