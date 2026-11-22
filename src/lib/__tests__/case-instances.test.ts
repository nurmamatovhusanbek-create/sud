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
  casenumber: CASE, region: 'Хоразм вилояти', court: 'Toshkent shahar iqtisodiy sudi', category: 'Qarz undirish', status_name: 'Назоратда',
  instance: 'Биринчи инстанция', claiment: 'ALFA MCHJ', defendant: 'BETA MCHJ', reg_date: '01.02.2026',
  hearing_date: '03.03.2026', hearing_time: '10:00', responsible: 'Karimov', result: 'Даъво қаноатлантирилсин',
  reviews: [
    { instance: 'Апелляция инстанцияси', court: 'Appeal court', responsible: 'Aliyev', hearing_date: '04.05.2026', result: 'Рад этилсин', reg_date: '10.05.2026' },
    { instance: 'Кассация инстанцияси', court: 'Cassation court', responsible: 'Valiyev', hearing_date: '04.07.2026', result: '-' },
    { instance: 'Тафтиш инстанцияси', court: 'Taftish court', responsible: 'Tashev', hearing_date: '04.09.2026', result: 'Бекор қилинсин', reg_date: '10.09.2026' },
  ],
}

// the shape the API really has (read live, Nov 2026): `reviews[]` holds EVERY earlier proceeding of the case number, each with its own
// case_id, hearing, judge, status and result: earlier first-instance proceedings, several appeals, a cassation and a repeated one
const MULTI = '4-1001-2621/42938'
const rev = (instance: string, date: string, judge: string, result: string, status = 'Якунланган (Ижро варақасиз)') => ({
  instance, court: instance + ' sudi', hearing_date: date, hearing_time: '10:00', responsible: judge, judge, reg_date: date, result, status_name: status,
})
const multi = {
  casenumber: MULTI, court: 'Toshkent iqtisodiy sudi', category: 'Qarz', status_name: 'Кўриб чиқиш жараёнида', instance: 'Биринчи инстанция',
  hearing_date: '26.11.2026', hearing_time: '10:20', responsible: 'Karimov', result: '', reg_date: '10.11.2026', claiment: 'A', defendant: 'B',
  reviews: [
    rev('Биринчи инстанция', '11.04.2022', 'Rahimov', 'Тўлиқ қаноатлантирилган'),
    rev('Апелляция инстанцияси', '01.06.2022', 'Aliyev', 'Рад қилинган'),
    rev('Апелляция инстанцияси', '01.09.2022', 'Aliyev2', 'Қайтарилган'),
    rev('Кассация инстанцияси', '01.01.2023', 'Valiyev', 'Рад қилинган'),
    rev('Такрорий кассация инстанцияси', '01.05.2023', 'Tashev', 'Рад қилинган'),
  ],
}

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const full = String(input)
  const worker = WORKERS.find((w) => full.startsWith(w)) ?? ''
  const url = full.slice(worker.length)
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  if (url.includes('findByTin/309922242')) {
    // a big list that breaks half way: two complete cases, then the connection resets in the middle of the third
    const one = (n: string) => JSON.stringify({ ...raw, casenumber: n, reviews: [] })
    const enc = new TextEncoder()
    let sent = false
    return new Response(new ReadableStream({ pull(c) { if (!sent) { sent = true; c.enqueue(enc.encode(`[${one('4-1001-2621/00001')},${one('4-1001-2621/00002')},{"casenumber":"4-1001-2621/0000`)) } else c.error(new Error('connection reset')) } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (url.includes('CRIMINAL/findByTin/309922241')) return json([{ ...raw, casenumber: '1-1001-2621/00001', instance: 'Биринчи инстанция', reviews: [] }])
  if (url.includes(MULTI.replace('/', '@'))) return json([multi])
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

describe('every proceeding of the case number counts (the real API shape)', () => {
  test('several appeals: all their hearings, the latest names the judge; the repeated cassation is flagged', async () => {
    const d = await getCaseDetails('economic', MULTI)
    expect(d.appellate?.hearings.map((h) => h.judge)).toEqual(['Aliyev', 'Aliyev2'])
    expect(d.appellate?.judge).toBe('Aliyev2')
    expect(d.appellate?.decision?.text).toBe('Қайтарилган') // the latest proceeding's result
    expect(d.cassation).toMatchObject({ judge: 'Tashev', repeated: true }) // the latest proceeding (the repeat) names the judge
    // «Такрорий кассация» is a cassation proceeding too: it joins the cassation instance and flags it
    expect(d.cassation?.hearings.map((h) => h.judge)).toEqual(['Valiyev', 'Tashev'])
    expect(d.cassation?.repeated).toBe(true)
  })
  test('the EARLIER first-instance proceeding joins the first instance\'s hearings', async () => {
    const d = await getCaseDetails('economic', MULTI)
    expect(d.firstInstance?.hearings.map((h) => h.judge).sort()).toEqual(['Karimov', 'Rahimov'].sort())
  })
})

describe('criminal and region', () => {
  test('a criminal search asks jadvalapi CRIMINAL/findByTin and maps the rows like the others', async () => {
    const r = await searchCourtCases('criminal', 'tin', '309922241')
    expect(r[0]).toMatchObject({ caseNumber: '1-1001-2621/00001', judge: 'Karimov' })
  })
  test('the court region reaches the case detail', async () => {
    const d = await getCaseDetails('economic', CASE)
    expect(d.general?.region).toBe('Хоразм вилояти')
  })
})

describe('a company with thousands of cases (a bank): one big list, no pagination', () => {
  test('a list that breaks half way keeps the complete cases and says the list is partial', async () => {
    const { searchCourtCasesDetailed } = await import('../court-case')
    const r = await searchCourtCasesDetailed('economic', 'tin', '309922242')
    expect(r.cases.map((c) => c.caseNumber)).toEqual(['4-1001-2621/00001', '4-1001-2621/00002'])
    expect(r.incomplete).toBe(true)
  })
})
