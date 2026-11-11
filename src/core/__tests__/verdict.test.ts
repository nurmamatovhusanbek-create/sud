import { describe, expect, test } from 'bun:test'
import { BIG_OVERDUE_TIYINS, companyVerdict, type VerdictInput } from '../verdict'

const base: VerdictInput = { status: 'Faoliyatda', rating: 'A', score: 90, winRate: 70, cases: 10, overdueTotal: 0, hearingsAhead: 0 }
const v = (o: Partial<VerdictInput> = {}) => companyVerdict({ ...base, ...o })
const tone = (o: Partial<VerdictInput>, id: string) => v(o).signals.find((s) => s.id === id)!.tone

describe('companyVerdict', () => {
  test('a clean company is «ok» but the headline never says safe', () => {
    const r = v()
    expect(r.level).toBe('ok')
    expect(r.headline).toBe('Jiddiy belgilar topilmadi')
  })
  test('the worst signal sets the level, and the worst comes first', () => {
    const r = v({ status: 'Tugatilgan', rating: 'C' })
    expect(r.level).toBe('danger')
    expect(r.headline).toBe('Ehtiyot boʻling: 1 ta jiddiy belgi')
    expect(r.signals[0].id).toBe('status')
  })
  test('unread sources are unknown, not good: a company with nothing read is never «ok»', () => {
    const r = companyVerdict({ hearingsAhead: 0 })
    expect(r.level).toBe('unknown')
    expect(r.unread).toBe(4)
    expect(r.signals.every((s) => s.tone === 'unknown')).toBe(true)
  })
  test('one unread source does not stop a clean company being ok; two do', () => {
    expect(v({ overdueTotal: null }).level).toBe('ok')
    expect(v({ overdueTotal: null, rating: null }).level).toBe('unknown')
  })
  test('rating letters', () => {
    expect([tone({ rating: 'AA' }, 'rating'), tone({ rating: 'B+' }, 'rating'), tone({ rating: 'C' }, 'rating'), tone({ rating: 'D' }, 'rating')]).toEqual(['good', 'good', 'warn', 'bad'])
  })
  test('invoices: none overdue is good, some warn, a lot is bad, never opened is unknown', () => {
    expect([tone({ overdueTotal: 0 }, 'bills'), tone({ overdueTotal: 100 }, 'bills'), tone({ overdueTotal: BIG_OVERDUE_TIYINS }, 'bills'), tone({ overdueTotal: undefined }, 'bills')]).toEqual(['good', 'warn', 'bad', 'unknown'])
  })
  test('court: many cases with a low win rate is bad, low rate alone warns, many cases alone warns', () => {
    expect([tone({ cases: 40, winRate: 20 }, 'court'), tone({ cases: 5, winRate: 20 }, 'court'), tone({ cases: 40, winRate: 80 }, 'court'), tone({ cases: 5, winRate: 80 }, 'court')]).toEqual(['bad', 'warn', 'warn', 'good'])
  })
  test('an even record is information, not reassurance', () => {
    expect(tone({ cases: 9, winRate: 48 }, 'court')).toBe('info')
    expect(tone({ cases: 9, winRate: 50 }, 'court')).toBe('good')
  })
  test('hearings ahead are information, with the days to the nearest', () => {
    const s = v({ hearingsAhead: 2, nextHearingDays: 1 }).signals.find((x) => x.id === 'hearings')!
    expect(s).toMatchObject({ tone: 'info', title: '2 ta majlis rejada', detail: 'Eng yaqini ertaga' })
    expect(v().signals.some((x) => x.id === 'hearings')).toBe(false)
  })
})
