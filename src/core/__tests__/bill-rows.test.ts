import { describe, expect, test } from 'bun:test'
import { casesOfBills, compareBills, matchesBill, rowAsDetail, summarizeBills, toBillRow, type BillRow } from '../bill-rows'

// shaped like billing's search rows (read live, Nov 2026); names and numbers are made up
const raw = (extra: Record<string, unknown> = {}) => ({
  number: '262922634262', invoiceStatus: 'USED', issued: 1792388978788, amount: 4400000, paidAmount: 4400000, mustPayAmount: 0, balance: 0, overdue: null,
  payCategory: 'Почта харажатлари', payCategoryId: 3, court: 'Фуқаролик ишлари бўйича Учтепа туманлараро суди', courtId: 525, courtType: 'CITIZEN',
  claimCaseNumber: '2-1004-2608/64012', decisionDate: null, description: 'Почта харажатлари', payer: 'ALFA BANK', payerTin: '207324986', isInFavor: true,
  forAccount: '4014', historyList: null, ...extra,
})
const row = (extra: Record<string, unknown> = {}) => toBillRow(raw(extra))!

describe('toBillRow', () => {
  test('keeps what the tab and the cross-reference use', () => {
    expect(row()).toMatchObject({ number: '262922634262', status: 'USED', amount: 4400000, paid: 4400000, cat: 'Почта харажатлари', catId: 3, courtType: 'CITIZEN', caseNumber: '2-1004-2608/64012', payerTin: '207324986', inFavor: true })
  })
  test('a bill that was never used on a case has no case number; a malformed one is not a case number', () => {
    expect(row({ claimCaseNumber: null }).caseNumber).toBeNull()
    expect(row({ claimCaseNumber: 'abc' }).caseNumber).toBeNull()
    expect(row({ claimCaseNumber: '../../x/1' }).caseNumber).toBeNull()
  })
  test('anything that is not a bill is dropped, never thrown on', () => {
    for (const bad of [null, 5, 'x', {}, { number: 'abc' }, { number: '1' }]) expect(toBillRow(bad)).toBeNull()
  })
  test('the receipt reads a row as a status response (no usage history yet)', () => {
    const d = rowAsDetail(row({ decisionDate: 1789516800000 }))
    expect(d).toMatchObject({ number: '262922634262', invoiceStatus: 'USED', paidAmount: 4400000, claimCaseNumber: '2-1004-2608/64012', decisionDate: 1789516800000, historyList: null })
  })
})

describe('filters', () => {
  const rows: BillRow[] = [
    row({ number: '100000000001', invoiceStatus: 'USED', claimCaseNumber: '2-1004-2608/1', payCategory: 'Давлат божи', amount: 100 }),
    row({ number: '100000000002', invoiceStatus: 'USED', claimCaseNumber: '2-1004-2608/1', payCategory: 'Почта харажатлари', amount: 20 }),
    row({ number: '100000000003', invoiceStatus: 'OVERDUE', claimCaseNumber: '4-1001-2614/2', courtType: 'ECONOMIC', payCategory: 'Давлат божи', amount: 300, overdue: 300 }),
    row({ number: '100000000004', invoiceStatus: 'CREATED', claimCaseNumber: null, courtType: 'MILITARY', payCategory: 'Бошқа', amount: 5, court: 'Harbiy sud' }),
  ]
  const ids = (f: Parameters<typeof matchesBill>[1]) => rows.filter((r) => matchesBill(r, f)).map((r) => r.number.slice(-1))

  test('status segments', () => {
    expect(ids({ seg: 'paid' })).toEqual(['1', '2'])
    expect(ids({ seg: 'overdue' })).toEqual(['3'])
    expect(ids({ seg: 'all' })).toEqual(['1', '2', '3', '4'])
  })
  test('court type is the case API\'s (CITIZEN is civil); a bill with no usable type matches none', () => {
    expect(ids({ court: 'civil' })).toEqual(['1', '2'])
    expect(ids({ court: 'economic' })).toEqual(['3'])
    expect(ids({ court: 'criminal' })).toEqual([])
  })
  test('state duty and postal costs are told apart', () => {
    expect(ids({ kind: 'davlat_boji' })).toEqual(['1', '3'])
    expect(ids({ kind: 'pochta' })).toEqual(['2'])
    expect(ids({ kind: 'other' })).toEqual(['4'])
  })
  test('one case gives its bills (usually the two)', () => {
    expect(ids({ caseNumber: '2-1004-2608/1' })).toEqual(['1', '2'])
  })
  test('search finds a bill number, a case number, a court or the description', () => {
    expect(ids({ q: '100000000003' })).toEqual(['3'])
    expect(ids({ q: '4-1001-2614' })).toEqual(['3'])
    expect(ids({ q: 'harbiy' })).toEqual(['4'])
    expect(ids({ q: 'ПОЧТА' })).toEqual(['1', '2', '3', '4']) // the description, any case
  })
  test('sorts', () => {
    const by = (s: Parameters<typeof compareBills>[0]) => [...rows].sort(compareBills(s)).map((r) => r.number.slice(-1))
    expect(by('az')).toEqual(['1', '2', '3', '4'])
    expect(by('za')).toEqual(['4', '3', '2', '1'])
  })
  test('the summary counts by status, court type and category kind, and the distinct cases', () => {
    const s = summarizeBills(rows)
    expect(s).toMatchObject({ count: 4, paid: 2, overdue: 1, partial: 0, totalAmount: 425, overdueSum: 300, withCase: 3, cases: 2 })
    expect(s.byCourt).toEqual({ civil: 2, economic: 1 })
    expect(s.byKind).toEqual({ davlat_boji: 2, pochta: 1, other: 1 })
  })
})

describe('casesOfBills', () => {
  test('a case carries its two bills, state duty and postal costs', () => {
    const m = casesOfBills([
      row({ number: '100000000001', claimCaseNumber: '2-1004-2608/1', payCategory: 'Давлат божи' }),
      row({ number: '100000000002', claimCaseNumber: '2-1004-2608/1', payCategory: 'Почта харажатлари', decisionDate: 7 }),
      row({ number: '100000000003', claimCaseNumber: '4-1001-2614/2', courtType: 'ECONOMIC' }),
      row({ number: '100000000004', claimCaseNumber: null }),
    ])
    expect([...m.keys()]).toEqual(['2-1004-2608/1', '4-1001-2614/2'])
    const c = m.get('2-1004-2608/1')!
    expect(c.courtType).toBe('civil')
    expect(c.bills.map((b) => b.number)).toEqual(['100000000001', '100000000002'])
    expect(c.decision).toBe(7) // the second bill knew the ruling day the first one lacked
    expect(m.get('4-1001-2614/2')!.courtType).toBe('economic')
  })
})
