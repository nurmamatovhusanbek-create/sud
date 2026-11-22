import { describe, expect, test } from 'bun:test'
import { courtTypeOfNumber, extractBillCases, missingCases, registeredKey, rowFromDetail } from '../bill-cases'
import type { FullCaseData } from '@/lib/court-case-types'

// rows shaped like billing's search answer (read live for a large company, Nov 2026); names are made up
const bill = (extra: Record<string, unknown>) => ({ number: '1', invoiceStatus: 'USED', issued: 1, claimCaseNumber: null, courtType: 'CITIZEN', court: 'Sud', decisionDate: null, ...extra })

describe('extractBillCases', () => {
  test('a bill that names no case adds nothing; one that does gives its number, court type and court', () => {
    const m = extractBillCases([bill({}), bill({ claimCaseNumber: '2-1004-2603/8020', court: 'Uchtepa sudi', decisionDate: 1789516800000 }), bill({ claimCaseNumber: '4-1001-2614/11027', courtType: 'ECONOMIC' })])
    expect([...m.keys()]).toEqual(['2-1004-2603/8020', '4-1001-2614/11027'])
    expect(m.get('2-1004-2603/8020')).toEqual({ caseNumber: '2-1004-2603/8020', courtType: 'civil', court: 'Uchtepa sudi', decisionDate: 1789516800000 })
    expect(m.get('4-1001-2614/11027')?.courtType).toBe('economic')
  })

  test('billing\'s own vocabulary is translated (CITIZEN is civil) and a type the case API lacks falls back to the number\'s first digit', () => {
    const m = extractBillCases([bill({ claimCaseNumber: '2-1-2101/1', courtType: 'MILITARY' }), bill({ claimCaseNumber: '3-1-2101/2', courtType: 'ADMINISTRATIVE' }), bill({ claimCaseNumber: '9-1-2101/3', courtType: 'MILITARY' })])
    expect(m.get('2-1-2101/1')?.courtType).toBe('civil')
    expect(m.get('3-1-2101/2')?.courtType).toBe('administrative')
    expect(m.has('9-1-2101/3')).toBe(false)
  })

  test('garbage is ignored, never thrown on; the same case on two bills keeps what the first lacked', () => {
    const m = extractBillCases([null, 5, 'x', bill({ claimCaseNumber: 'not a number' }), bill({ claimCaseNumber: '../../x/1' }), bill({ claimCaseNumber: '2-1-2101/1', court: '' }), bill({ claimCaseNumber: '2-1-2101/1', court: 'Sud A', decisionDate: 7 })])
    expect([...m.keys()]).toEqual(['2-1-2101/1'])
    expect(m.get('2-1-2101/1')).toMatchObject({ court: 'Sud A', decisionDate: 7 })
  })

  test('pages add into the same map', () => {
    const m = extractBillCases([bill({ claimCaseNumber: '2-1-2101/1' })])
    extractBillCases([bill({ claimCaseNumber: '2-1-2101/1' }), bill({ claimCaseNumber: '2-1-2101/2' })], m)
    expect(m.size).toBe(2)
  })
})

describe('missingCases', () => {
  const cases = extractBillCases([2101, 2505, 2603, 2401].map((y, i) => bill({ claimCaseNumber: `2-1004-${y}/${i + 1}` }))).values()
  test('what the list has is left out, the rest comes newest first', () => {
    const out = missingCases(cases, new Set(['2-1004-2401/4']))
    expect(out.map((c) => c.caseNumber)).toEqual(['2-1004-2603/3', '2-1004-2505/2', '2-1004-2101/1'])
  })
  test('a number already settled (found or tried) is skipped', () => {
    const out = missingCases(extractBillCases([bill({ claimCaseNumber: '2-1-2101/1' }), bill({ claimCaseNumber: '2-1-2101/2' })]).values(), new Set(), { skip: (n) => n.endsWith('/1') })
    expect(out.map((c) => c.caseNumber)).toEqual(['2-1-2101/2'])
  })
  test('registeredKey / courtTypeOfNumber', () => {
    expect(registeredKey('2-1004-2603/8020')).toBe(2603)
    expect(registeredKey('garbage')).toBe(-1)
    expect(courtTypeOfNumber('4-1001-2614/1')).toBe('economic')
    expect(courtTypeOfNumber('7-1')).toBeNull()
  })
})

describe('rowFromDetail', () => {
  const detail = (over: Partial<NonNullable<FullCaseData['general']>>): FullCaseData => ({
    general: { caseNumber: '4-1001-2206/2909', caseType: 'Qarz', caseStatus: 'Архивга топширилган', court: 'Toshkent iqtisodiy sudi', judge: 'J', secretary: '-', plaintiff: 'A', plaintiffTin: '-', defendant: 'B', defendantTin: '-', thirdParty: '-', claimSubject: '', claimAmount: '100', applicationDate: '01.02.2022', initiatedDate: '-', deadlineDate: '-', stateDuty: '-', representative: '-', prosecutor: '-', ...over },
    firstInstance: { hearings: [], decision: { date: '-', text: 'Тўлиқ қаноатлантирилган', type: '', awardedAmount: '-', stateDutyRecovered: '-', enforcedDate: '-', appealDeadline: '-' }, documents: [] },
    appellate: null, cassation: null, inspection: null,
  })
  test('a detail becomes the row the list would have had', () => {
    const r = rowFromDetail(detail({}), { caseNumber: 'x' })
    expect(r).toMatchObject({ caseNumber: '4-1001-2206/2909', caseStatus: 'Архивга топширилган', result: 'Тўлиқ қаноатлантирилган', courtName: 'Toshkent iqtisodiy sudi', dateFiled: '01.02.2022', plaintiff: 'A', defendant: 'B' })
  })
  test('placeholders «-» become empty, and the bill\'s court fills a missing one', () => {
    const r = rowFromDetail(detail({ court: '-', judge: '-', caseType: '-' }), { caseNumber: 'x', court: 'Bill court' })
    expect(r.courtName).toBe('Bill court')
    expect(r.judge).toBe('')
    expect(r.caseType).toBe('')
  })
})
