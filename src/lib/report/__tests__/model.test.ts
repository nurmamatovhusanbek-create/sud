import { describe, expect, test } from 'bun:test'
import { buildReportModel, fmtInt, parseAmount, parseShare, shortSum } from '../model'
import { FULL, NOW, mkCase } from './fixtures'

describe('hero', () => {
  const m = buildReportModel(FULL)
  test('identity, status and rating', () => {
    expect(m.name).toContain('PROCAB')
    expect(m.status?.tone).toBe('pos')
    expect(m.rating).toEqual({ score: 94, category: 'AA', tone: 'pos' })
  })
  test('four KPI tiles', () => expect(m.kpis.map((k) => k.label)).toEqual(['Sud ishlari', 'Yutuq darajasi', 'Daʼvo summasi', 'Yaqin majlislar']))
})

describe('court cases block — numbers match Statistika', () => {
  const c = buildReportModel(FULL).cases!
  test('counts and win rate (win / total, whole percent)', () => {
    expect(c.total).toBe(6)
    expect(c.win).toBe(2)
    expect(c.winRate).toBe(50) // 2 won ÷ (2 won + 2 lost); neutral + in-progress are not in the base
    expect(c.inProgress).toBe(1)
    expect(c.decided).toBe(5)
    expect(c.asPlaintiff + c.asDefendant).toBe(6)
  })
  test('by court type', () => expect(c.byCourt).toEqual([{ label: 'Iqtisodiy', count: 4 }, { label: 'Fuqarolik', count: 1 }, { label: 'Maʼmuriy', count: 1 }]))
  test('result breakdown: grouped, sorted, percentages, dominant-class tone', () => {
    expect(c.results[0]).toMatchObject({ count: 2, pct: 33.3 })
    expect(c.results.map((r) => r.count).reduce((a, b) => a + b, 0)).toBe(6)
    const win = c.results.find((r) => r.label.includes('qanoatlantirilsin'))!
    expect(win.tone).toBe('pos')
    expect(c.results.find((r) => r.label === 'Jarayonda')!.tone).toBe('info') // pending + no result text
  })
  test('claim total counts each case once and skips blanks', () => {
    expect(c.claim).toEqual({ total: 272628881.58 + 1000000, count: 2 })
  })
  test('latest cases are newest first (by DATE, not by string) and carry amounts', () => {
    expect(c.latest.map((r) => r.date)).toEqual(['28.09.2026', '02.09.2026', '15.06.2026', '05.03.2026', '10.01.2026', '12.12.2025'])
    expect(c.latest.find((r) => r.number.endsWith('/01'))!.amount).toBe(272628881.58)
    expect(c.latest.find((r) => r.number.endsWith('/03'))!.amount).toBeNull()
  })
  test('monthly trend is 12 months', () => expect(c.monthly).toHaveLength(12))
  test('many distinct results collapse to top 6 + «Boshqalar»', () => {
    const many = Array.from({ length: 9 }, (_, i) => mkCase(i, 'neutral', `Natija ${i}`, '01.01.2026'))
    const r = buildReportModel({ ...FULL, stats: { ...(FULL.stats as object), cases: many, summary: { total: 9, win: 0, lose: 0, neutral: 9, pending: 0, asPlaintiff: 9, asDefendant: 0 } } as never }).cases!.results
    expect(r).toHaveLength(7)
    expect(r[6]).toMatchObject({ label: 'Boshqalar', count: 3 })
  })
  test('the same wording with opposite outcomes is split, never one bar with one color', () => {
    const cs = [mkCase(0, 'win', "Da'vo rad etilsin", '01.01.2026'), mkCase(1, 'win', "Da'vo rad etilsin", '01.01.2026'), mkCase(2, 'lose', "Da'vo rad etilsin", '01.01.2026'), mkCase(3, 'neutral', 'Qaytarilgan', '01.01.2026')]
    const r = buildReportModel({ ...FULL, stats: { ...(FULL.stats as object), cases: cs, summary: { total: 4, win: 2, lose: 1, neutral: 1, pending: 0, asPlaintiff: 1, asDefendant: 3 } } as never }).cases!.results
    expect(r.map((x) => [x.label, x.count, x.tone])).toEqual([
      ["Da'vo rad etilsin · yutgan", 2, 'pos'],
      ["Da'vo rad etilsin · yutqazgan", 1, 'neg'],
      ['Qaytarilgan', 1, 'neu'],
    ])
  })
})

describe('facts and founders', () => {
  const m = buildReportModel(FULL)
  test('founders sorted by share, shares parsed', () => {
    expect(m.founders.rows.map((f) => [f.name, f.share])).toEqual([['A', 44.9], ['C', 44.9], ['B', 10.2]])
  })
  test('more than 6 founders: the rest are counted, not dropped silently', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `F${i}`, share: `${10 - i}%` }))
    const f = buildReportModel({ ...FULL, info: { ...FULL.info!, company: { ...FULL.info!.company!, founders: many } } }).founders
    expect(f.rows).toHaveLength(6)
    expect(f.others).toBe(3)
  })
  test('empty / dash values are dropped, never printed', () => {
    const blank = buildReportModel({ ...FULL, info: { ...FULL.info!, company: { ...FULL.info!.company!, email: '-', phone: '', address: '—' } } })
    expect(blank.contacts).toEqual([])
    expect(JSON.stringify(blank.facts)).not.toContain('"-"')
  })
  test('OKED code + name from chamber; IFUT only when it adds something', () => {
    expect(m.codes[0].value).toBe('24440 · Misni ishlab chiqarish')
    expect(m.codes.find((c) => c.label === 'IFUT')?.value).toBe('24440')
  })
})

describe('bills', () => {
  test('shown only once the Bills section has loaded them', () => {
    expect(buildReportModel(FULL).bills).toMatchObject({ count: 12, paidCount: 9, paidTotal: 150000000, overdueTotal: 20000000 })
    expect(buildReportModel({ ...FULL, bills: { billCount: 12 } }).bills).toBeNull()
    expect(buildReportModel({ ...FULL, bills: null }).bills).toBeNull()
  })
})

describe('failed sources are stated, never turned into zeros', () => {
  test('everything missing → no throw, honest notes, dashes not zeros', () => {
    const m = buildReportModel({ stir: '123456789', generatedAt: NOW, info: null, stats: null, cases: null, hearings: null, bills: null, failed: { stats: 'sud.uz 500' } })
    expect(m.name).toBe('STIR 123456789')
    expect(m.cases).toBeNull()
    expect(m.hearings).toBeNull()
    expect(m.notes.map((n) => n.section)).toEqual(['Kompaniya profili', 'Sud ishlari', 'Yaqin majlislar'])
    expect(m.notes.find((n) => n.section === 'Sud ishlari')!.message).toBe('sud.uz 500')
    expect(m.kpis.every((k) => k.value === '—')).toBe(true)
  })
  test('cases list failed but stats fine: counts stay, amount is unknown (not 0)', () => {
    const m = buildReportModel({ ...FULL, cases: null })
    expect(m.cases!.total).toBe(6)
    expect(m.cases!.claim).toBeNull()
    expect(m.kpis[2].value).toBe('—')
  })
  test('zero hearings is "none scheduled", not a failure', () => {
    const m = buildReportModel({ ...FULL, hearings: [] })
    expect(m.hearings).toEqual([])
    expect(m.notes.find((n) => n.section === 'Yaqin majlislar')).toBeUndefined()
    expect(m.kpis[3].sub).toBe('belgilanmagan')
  })
})

describe('parsers and formatters', () => {
  test.each([
    ['272 628 881,58', 272628881.58], ['272628881.58', 272628881.58], ['1,234,567', 1234567], ['1.234.567', 1234567],
    ['1,5', 1.5], ['100', 100], ['1 000 000', 1000000], ['0', 0], ['12.345,67', 12345.67], ['12,345.67', 12345.67],
  ])('parseAmount(%p) = %p', (s, n) => expect(parseAmount(s)).toBe(n))
  test.each([['-'], [''], ['n/a'], [null], [undefined]])('parseAmount(%p) = null', (s) => expect(parseAmount(s as never)).toBeNull())
  test.each([['44.9%', 44.9], ['44,9 %', 44.9], ['45', 45], ['10.2', 10.2]])('parseShare(%p) = %p', (s, n) => expect(parseShare(s)).toBe(n))
  test('parseShare(no number) = null', () => expect(parseShare('yoʻq')).toBeNull())
  test('shortSum', () => {
    expect(shortSum(325_700_000)).toBe('325,7 mln')
    expect(shortSum(2_400_000_000)).toBe('2,4 mlrd')
    expect(shortSum(5_000_000)).toBe('5 mln')
    expect(shortSum(950_000)).toBe('950 000')
  })
  test('fmtInt groups thousands', () => expect(fmtInt(1234567)).toBe('1 234 567'))
})
