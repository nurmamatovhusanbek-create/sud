import { describe, expect, test } from 'bun:test'
import {
  addDays,
  classifyPublicResult,
  compactPublication,
  daysBetween,
  isOrderFileId,
  normalizeCaseNumber,
  parseMultipartFile,
  pdfFileName,
  sortOrders,
  splitDecisions,
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
