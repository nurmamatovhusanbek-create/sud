import { describe, expect, test } from 'bun:test'
import {
  addDays,
  caseSignature,
  CHECK_BACKOFF_MS,
  classifyPublicResult,
  compactPublication,
  daysBetween,
  isOngoingFirstInstance,
  isOrderFileId,
  normalizeCaseNumber,
  parseMultipartFile,
  pdfFileName,
  planCheck,
  sortOrders,
  splitDecisions,
  type CaseCheck,
  type StoredOrder,
} from '../public-orders'

// a real list row (public, anonymised) from the probe — trimmed
const ROW = {
  court_names: { qq: 'Ташкент районлар аралық экономикалық суды', ru: 'Ташкентский межрайонный экономический суд', uz: 'Тошкент туманлараро иқтисодий суди', uz_cyr: 'Тошкент туманлараро иқтисодий суди' },
  id: 'bbde5da6-97c9-4be0-9740-b7bb9a2903c7',
  instance: 'APPEAL',
  case_number: ' 4-1001-2619/21743 ',
  categories: [{ qq: 'Пудрат шартномаси юзасидан', ru: 'По договору подряда', uz: 'Pudrat shartnomasi yuzasidan', uz_cyr: 'Пудрат шартномаси юзасидан' }],
  responsible_judge_name: 'XUSANOV ULUG‘BEK RAVSHANOVICH',
  speaker_judge_name: 'RASHIDOV RAVSHAN USMONOVICH',
  result: 'FULFILLED',
  pdf: { id: '86db779e-9ba9-41c3-8d1a-15e9ef0a5dfb', name: '21743 апел 1  бек рад жарима 12.05.26', mime_type: 'application/pdf', size: 115156 },
}

describe('compactPublication', () => {
  test('keeps what a case lookup needs, in Latin/Cyrillic as the app shows it', () => {
    expect(compactPublication(ROW, 'ECONOMIC')).toEqual({
      id: 'bbde5da6-97c9-4be0-9740-b7bb9a2903c7',
      caseNumber: '4-1001-2619/21743',
      instance: 'APPEAL',
      result: 'FULFILLED',
      court: 'Тошкент туманлараро иқтисодий суди',
      judge: 'XUSANOV ULUG‘BEK RAVSHANOVICH',
      category: 'Pudrat shartnomasi yuzasidan',
      pdfId: '86db779e-9ba9-41c3-8d1a-15e9ef0a5dfb',
      pdfName: '21743 апел 1 бек рад жарима 12.05.26',
      pdfSize: 115156,
      courtType: 'ECONOMIC',
    })
  })
  test('rows without an id or a case number are dropped, missing optional parts become empty', () => {
    expect(compactPublication({ id: 'x' }, 'CIVIL')).toBeNull()
    expect(compactPublication({ case_number: '1-1/1' }, 'CIVIL')).toBeNull()
    expect(compactPublication({ id: 'x', case_number: '1-1/1' }, 'CIVIL')).toMatchObject({ court: '', judge: '', category: '', pdfId: '', pdfSize: 0 })
  })
  test('case numbers compare regardless of case and spaces', () => {
    expect(normalizeCaseNumber(' 4-1001-2619 / 21743 ')).toBe('4-1001-2619/21743')
    expect(normalizeCaseNumber('5-abc/1')).toBe('5-ABC/1')
  })
})

describe('classifyPublicResult reuses the app-wide rules', () => {
  test.each([
    ['FULFILLED', 'win', 'lose'],
    ['PARTIALLY_FULFILLED', 'win', 'lose'],
    ['REFUSED', 'lose', 'win'],
    ['RETURNED', 'neutral', 'neutral'],
    ['UNCONSIDERED', 'lose', 'neutral'],
    ['CASE_ENDED', 'lose', 'neutral'],
  ])('%s → plaintiff %s · defendant %s', (r, p, d) => {
    expect(classifyPublicResult('plaintiff', r)).toBe(p as never)
    expect(classifyPublicResult('defendant', r)).toBe(d as never)
  })
  test('an unknown value is pending, never a guess', () => expect(classifyPublicResult('plaintiff', 'SOMETHING_NEW')).toBe('pending'))
})

describe('dates', () => {
  test('addDays / daysBetween are calendar-exact across month, year and leap days', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26') // no DST drift
    expect(daysBetween('2026-05-12', '2026-05-19')).toBe(7)
  })
})

describe('parseMultipartFile — the multipart envelope /public/onStream wraps the PDF in', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0, 255, 13, 10, 45, 45, 1, 2, 3]), Buffer.from('\n%%EOF\n')])
  const wrap = (opts: { length?: boolean } = { length: true }) =>
    Buffer.concat([
      Buffer.from(`--vdhX\r\nContent-Disposition: form-data; name="file"; filename="21743 апел.pdf"\r\nContent-Type: application/octet-stream\r\n${opts.length ? `Content-Length: ${pdf.length}\r\n` : ''}\r\n`),
      pdf,
      Buffer.from('\r\n--vdhX--\r\n'),
    ])
  test('cuts the payload out by Content-Length (binary safe, even with CRLF and dashes inside)', () => {
    const r = parseMultipartFile(wrap())!
    expect(Buffer.from(r.bytes).equals(pdf)).toBe(true)
    expect(r.filename).toBe('21743 апел.pdf')
  })
  test('falls back to the closing boundary when there is no Content-Length', () => {
    const r = parseMultipartFile(wrap({ length: false }))!
    expect(Buffer.from(r.bytes.subarray(0, 5)).toString()).toBe('%PDF-')
    expect(r.bytes.length).toBe(pdf.length)
  })
  test('anything that is not a multipart envelope is rejected, not guessed at', () => {
    expect(parseMultipartFile(Buffer.from('%PDF-1.7 plain'))).toBeNull()
    expect(parseMultipartFile(Buffer.from(''))).toBeNull()
  })
})

describe('small guards', () => {
  test('only real uuids may reach the upstream URL', () => {
    expect(isOrderFileId('86db779e-9ba9-41c3-8d1a-15e9ef0a5dfb')).toBe(true)
    for (const bad of ['', '../etc/passwd', '86db779e-9ba9-41c3-8d1a-15e9ef0a5dfb/../x', 'x'.repeat(36)]) expect(isOrderFileId(bad)).toBe(false)
  })
  test('download names are plain and end in .pdf', () => {
    expect(pdfFileName('21743 апел 12.05.26', 'order')).toBe('21743 апел 12.05.26.pdf')
    expect(pdfFileName('a/b\\c:d.pdf', 'order')).toBe('a_b_c_d.pdf')
    expect(pdfFileName('', 'order')).toBe('order.pdf')
  })
  test('orders sort first instance → appeal → cassation', () => {
    const o = (instance: string, id: string) => ({ instance, id }) as StoredOrder
    expect(sortOrders([o('CASSATION', 'c'), o('FIRST', 'a'), o('APPEAL', 'b')]).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('splitDecisions — published PDFs vs decisions we only know from the case data', () => {
  const known = [
    { instance: 'FIRST' as const, date: '01.06.2026', text: 'Daʼvo qanoatlantirilsin' },
    { instance: 'APPEAL' as const, date: '12.05.2026', text: 'Apellyatsiya rad etilsin' },
  ]
  const pub = (instance: string, id: string) => ({ id, instance }) as StoredOrder

  test('a decision with a published order of the same instance is published, the rest are unpublished', () => {
    const v = splitDecisions(known, [pub('APPEAL', 'b')])
    expect(v.published.map((p) => [p.order.id, p.decision?.date])).toEqual([['b', '12.05.2026']])
    expect(v.unpublished.map((d) => d.instance)).toEqual(['FIRST'])
  })
  test('nothing published: every known decision is unpublished; nothing known: empty views', () => {
    expect(splitDecisions(known, []).unpublished).toHaveLength(2)
    expect(splitDecisions([], [])).toEqual({ published: [], unpublished: [] })
  })
  test('a published order without a case-data decision keeps decision = null', () => {
    expect(splitDecisions([], [pub('CASSATION', 'c')]).published[0].decision).toBeNull()
  })
})

describe('planCheck — published orders are permanent; only a changed case or a publication lag justifies asking again', () => {
  const D = 86_400_000
  const T0 = Date.parse('2026-06-10T00:00:00Z')
  const prev = (over: Partial<CaseCheck> = {}): CaseCheck => ({ caseNumber: 'x', at: new Date(T0).toISOString(), sig: 'a|b|c', seen: [], misses: 0, ...over })

  test('never checked → check all three instances', () => {
    expect(planCheck(null, 's', T0)).toEqual({ run: true, instances: ['FIRST', 'APPEAL', 'CASSATION'], reason: 'new' })
  })
  test('instances that already have an order are never asked again', () => {
    const p = planCheck(prev({ seen: ['FIRST'], sig: 'old' }), 'new', T0 + 1)
    expect(p).toMatchObject({ run: true, reason: 'sig-changed' })
    expect(p.instances).toEqual(['APPEAL', 'CASSATION'])
  })
  test('all instances published → done for good, even if the case changes', () => {
    expect(planCheck(prev({ seen: ['FIRST', 'APPEAL', 'CASSATION'] }), 'changed', T0 + 99 * D)).toMatchObject({ run: false, reason: 'done' })
  })
  test('unchanged case, nothing found: wait out the publication lag (3 d, then 14 d, then 45 d, then stop)', () => {
    const at = (misses: number, age: number) => planCheck(prev({ misses }), 'a|b|c', T0 + age)
    expect(at(0, 2 * D).run).toBe(false)
    expect(at(0, 3 * D)).toMatchObject({ run: true, reason: 'backoff' })
    expect(at(1, 10 * D).run).toBe(false)
    expect(at(1, 14 * D).run).toBe(true)
    expect(at(2, 44 * D).run).toBe(false)
    expect(at(2, 45 * D).run).toBe(true)
    expect(at(CHECK_BACKOFF_MS.length, 999 * D)).toMatchObject({ run: false, reason: 'waiting' }) // exhausted
  })
  test('a changed case is re-checked at once, even after the back-off ran out', () => {
    expect(planCheck(prev({ misses: 3 }), 'appealed', T0 + 60_000)).toMatchObject({ run: true, reason: 'sig-changed' })
  })
  test('a failed check is retried after 10 minutes, not immediately', () => {
    expect(planCheck(prev({ error: 'timeout' }), 'a|b|c', T0 + 5 * 60_000).run).toBe(false)
    expect(planCheck(prev({ error: 'timeout' }), 'a|b|c', T0 + 11 * 60_000)).toMatchObject({ run: true, reason: 'retry-error' })
  })
  test('force re-checks the missing instances regardless', () => {
    expect(planCheck(prev(), 'a|b|c', T0 + 1, true)).toMatchObject({ run: true, reason: 'forced' })
  })
  test('the signature moves with the case and ignores case/space noise', () => {
    expect(caseSignature({ caseStatus: ' Ko‘rilmoqda ', result: '', hearingDate: '02.10.2026' })).toBe(caseSignature({ caseStatus: 'ko‘rilmoqda', result: '', hearingDate: '02.10.2026' }))
    expect(caseSignature({ caseStatus: 'A', result: '', hearingDate: '' })).not.toBe(caseSignature({ caseStatus: 'A', result: 'Apellyatsiya', hearingDate: '' }))
  })
})

describe('isOngoingFirstInstance — a case still heard in the first instance has no order to look for', () => {
  test('no result + «ish yurituvda» / «koʻrib chiqilmoqda» (both scripts) / no status → ongoing', () => {
    expect(isOngoingFirstInstance({ result: '', caseStatus: 'Иш юритувда' })).toBe(true)
    expect(isOngoingFirstInstance({ result: '-', caseStatus: 'Ish yurituvda' })).toBe(true)
    expect(isOngoingFirstInstance({ result: '', caseStatus: "Ko'rib chiqilmoqda" })).toBe(true)
    expect(isOngoingFirstInstance({ result: '', caseStatus: 'Кўриб чиқилмоқда' })).toBe(true)
    expect(isOngoingFirstInstance({ result: undefined, caseStatus: '-' })).toBe(true)
    expect(isOngoingFirstInstance({})).toBe(true)
  })
  test('a decided case is never ongoing, whatever the status says', () => {
    expect(isOngoingFirstInstance({ result: 'Daʼvo qanoatlantirilsin', caseStatus: 'Ish yurituvda' })).toBe(false)
    expect(isOngoingFirstInstance({ result: 'Да’во рад этилсин', caseStatus: '' })).toBe(false)
  })
  test('in appeal / cassation / supervision the first-instance order exists → check', () => {
    for (const st of ['Апелляцияда', 'Apellyatsiyada', 'Кассацияда', 'Kassatsiyada', 'Назоратда', 'Nazoratda']) {
      expect(isOngoingFirstInstance({ result: '', caseStatus: st })).toBe(false)
    }
  })
  test('terminated / suspended / unknown wording is still checked (conservative)', () => {
    for (const st of ['Тугатилган', 'Tugatilgan', "To'xtatilgan", 'Ijro etilmoqda', 'Nomaʼlum holat']) {
      expect(isOngoingFirstInstance({ result: '', caseStatus: st })).toBe(false)
    }
  })
})
