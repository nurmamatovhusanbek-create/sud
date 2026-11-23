import { describe, expect, test } from 'bun:test'
import { linkOfBill, tallyLinks } from '../bill-link'

// shaped like the real rows (billing.sud.uz search, Nov 2026)
const base = { invoiceStatus: 'CREATED', payCategory: 'Почта харажатлари', description: 'Почта харажатлари', isInFavor: true, decisionDate: null, claimCaseNumber: null, purpose: null }

describe('which bills belong to a case', () => {
  test('billing names the case: kept as it is', () => {
    expect(linkOfBill({ ...base, claimCaseNumber: '4-1001-2129/44390', decisionDate: 1639149000000, isInFavor: false })).toEqual({ link: 'case', caseNumber: '4-1001-2129/44390' })
    expect(linkOfBill({ ...base, claimCaseNumber: ' 2-1801-21/13753 ' }).caseNumber).toBe('2-1801-21/13753') // an old-style number is still a number
  })
  test('the field is empty but the description holds the case number: recovered from the text', () => {
    const r = linkOfBill({ ...base, description: '10.12.2021 санадаги 4-1001-2129/44390-сонли ҳал қилув қарори (ажрим)' })
    expect(r).toEqual({ link: 'text', caseNumber: '4-1001-2129/44390' })
    expect(linkOfBill({ ...base, description: 'x', purpose: 'иш 2-1004-2503/8020 бўйича' }).caseNumber).toBe('2-1004-2503/8020')
  })
  test('postal / court-payment / video costs of a claim with no ruling are «claim costs»: not kept, but named', () => {
    for (const cat of ['Почта харажатлари', 'Суд тўловлар', 'Видеоконференцалоқа харажатлари']) {
      expect(linkOfBill({ ...base, payCategory: cat, description: cat })).toEqual({ link: 'claim-cost', caseNumber: null })
    }
  })
  test('anything else with no case is «unlinked»: a ruling date with no case, an owed bill, a state duty, a free-text payment', () => {
    expect(linkOfBill({ ...base, decisionDate: 1639149000000 }).link).toBe('unlinked')
    expect(linkOfBill({ ...base, isInFavor: false }).link).toBe('unlinked')
    expect(linkOfBill({ ...base, payCategory: 'Давлат божи', description: 'Давлат божи' }).link).toBe('unlinked')
    expect(linkOfBill({ ...base, payCategory: 'x', description: 'Кудратова Мавлуда Усипалиевна' }).link).toBe('unlinked')
  })
  test('rubbish never throws and is never a case', () => {
    for (const v of [null, undefined, 5, 'x', [], { claimCaseNumber: 7 }, { claimCaseNumber: '-' }, { claimCaseNumber: '0' }]) expect(linkOfBill(v).caseNumber).toBeNull()
  })
  test('a case number inside a longer number is not one', () => {
    expect(linkOfBill({ ...base, description: 'ref 12-1001-2129/44390x' }).link).not.toBe('text')
  })
  test('a page divides into the four kinds', () => {
    const page = [{ ...base, claimCaseNumber: '2-1004-2503/1' }, { ...base }, { ...base }, { ...base, description: 'кк 2-1004-2503/2' }, { ...base, isInFavor: false }, null]
    expect(tallyLinks(page)).toEqual({ case: 1, text: 1, claimCost: 2, unlinked: 1 })
  })
})
