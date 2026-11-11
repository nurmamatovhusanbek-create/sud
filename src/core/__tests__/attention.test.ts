import { describe, expect, test } from 'bun:test'
import { attentionItems, briefLine, BIG_DEBT_TIYINS, type AttentionInput } from '../attention'

const NOW = new Date(2026, 10, 11, 9, 0) // 11 Nov 2026
const iso = (d: number) => {
  const x = new Date(2026, 10, 11 + d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
const co = (o: Partial<AttentionInput> & { stir: string }): AttentionInput => ({ upcoming: [], ...o })

describe('attentionItems', () => {
  test('a hearing today or tomorrow is urgent, up to three days is 2, later ones are the agenda\'s job, the past is dropped', () => {
    const items = attentionItems([co({ stir: '1', name: 'A', upcoming: [{ iso: iso(0), time: '10:30' }, { iso: iso(1) }, { iso: iso(3) }, { iso: iso(6) }, { iso: iso(9) }, { iso: iso(-1) }] })], NOW)
    expect(items.map((i) => i.severity)).toEqual([3, 3, 2])
    expect(items[0].title).toBe('Bugun, 10:30: majlis')
    expect(items[1].title).toBe('Ertaga: majlis')
  })
  test('unknown debt is not a debt; a known one is; a huge one is urgent', () => {
    const items = attentionItems([co({ stir: '1', overdueTotal: null }), co({ stir: '2', overdueTotal: 0 }), co({ stir: '3', name: 'Small', overdueTotal: 5_000_00 }), co({ stir: '4', name: 'Big', overdueTotal: BIG_DEBT_TIYINS })], NOW)
    expect(items.map((i) => [i.name, i.severity])).toEqual([['Big', 3], ['Small', 2]])
  })
  test('liquidated is urgent, an unreadable status is silent', () => {
    const items = attentionItems([co({ stir: '1', status: 'Tugatilgan' }), co({ stir: '2', status: '' }), co({ stir: '3', status: 'Faoliyatda' })], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'status', severity: 3, target: 'profile' })
  })
  test('a weak rating is a low-priority note; no rating at all is not weak', () => {
    const items = attentionItems([co({ stir: '1', rating: 'D', winRate: 12 }), co({ stir: '2', score: null }), co({ stir: '3', rating: 'A', score: 90 })], NOW)
    expect(items.map((i) => i.kind)).toEqual(['rating'])
    expect(items[0].detail).toContain('12%')
  })
  test('ordered by severity, then date, then amount', () => {
    const items = attentionItems(
      [co({ stir: '1', name: 'Late', upcoming: [{ iso: iso(1) }] }), co({ stir: '2', name: 'Soon', upcoming: [{ iso: iso(0) }] }), co({ stir: '3', name: 'Debt', overdueTotal: 1_000_00 })],
      NOW,
    )
    expect(items.map((i) => i.name)).toEqual(['Soon', 'Late', 'Debt'])
  })
  test('a hearing item carries what the preparation screen needs; one without a case number says so', () => {
    const [a, b] = attentionItems([co({ stir: '1', name: 'A', upcoming: [{ iso: iso(0), time: '10:30', court: 'Sud', caseNumber: '4-1/1', judge: 'J' }, { iso: iso(1) }] })], NOW)
    expect(a.hearing).toEqual({ caseNumber: '4-1/1', iso: iso(0), time: '10:30', court: 'Sud', judge: 'J' })
    expect(a.action).toBe('Majlisga tayyorlanish')
    expect(b.action).toBe('Majlislarni ochish')
  })
  test('overdue invoices are described as the company\'s own payment discipline, never as a claim', () => {
    const [d] = attentionItems([co({ stir: '1', overdueTotal: 100 })], NOW)
    expect(d.title).toContain('kvitansiya')
    expect(d.detail).not.toContain('talabnoma')
    expect(d.action).toBe('Kvitansiyalarni koʻrish')
  })
  test('a nameless company falls back to its STIR', () => {
    expect(attentionItems([co({ stir: '302678824', overdueTotal: 100 })], NOW)[0].name).toBe('STIR 302678824')
  })
})

describe('briefLine', () => {
  test('says so when it is quiet', () => expect(briefLine([])).toContain('tinch'))
  test('counts the urgent ones', () => {
    const items = attentionItems([co({ stir: '1', upcoming: [{ iso: iso(0) }] }), co({ stir: '2', overdueTotal: 100 })], NOW)
    expect(briefLine(items)).toBe('1 ta shoshilinch ish, jami 2 ta narsa eʼtibor talab qiladi.')
  })
})
