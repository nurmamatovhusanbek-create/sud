/**
 * Statistika counts the cases the bills named too (lib/bill-cases, «found by number»): the court lists are capped at 100-200 rows, so a company's
 * older cases are only known through its bills. A case in a list AND in the found rows is counted once, the list's row first. The sites are faked.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

mock.module('server-only', () => ({}))
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-found-'))
process.env.CASE_STORE_DIR = DIR
process.env.SUD_DB = path.join(DIR, 'sud.db')

const TIN = '309922250'
const row = (n: number, over: Record<string, unknown> = {}) => ({ caseNumber: `4-1001-2601/${n}`, caseType: '', caseStatus: 'Кўриб чиқиш жараёнида', result: '', courtName: '', dateFiled: '', plaintiff: 'TEST SAVDO MCHJ', defendant: `Javobgar ${n}`, claimAmount: '', hearingDate: '', hearingTime: '', judge: '', ...over })

let listed: unknown[] = []
const realCourt = { ...(await import('../court-case')) }
const realOrginfo = { ...(await import('../orginfo')) }
const realChamber = { ...(await import('../chamber')) }
mock.module('../court-case', () => ({
  ...realCourt,
  searchCourtCasesDetailed: async (ct: string) => ({ cases: ct === 'economic' ? listed : [], incomplete: false }),
  clearCourtCaseCache: () => {},
}))
mock.module('../orginfo', () => ({ getCompanyByTin: async () => ({ tin: TIN, shortName: 'TEST SAVDO MCHJ', officialName: 'TEST SAVDO MCHJ', address: '', status: '' }) }))
mock.module('../chamber', () => ({ getCompanyRatingDetailed: async () => ({ rating: null, failed: false }) }))

const dbm = await import('../db')
const store = await import('../case-store')
const { getCompanyStats } = await import('../stats')

beforeEach(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
  fs.mkdirSync(DIR, { recursive: true })
  store.forgetCaseStoreMemory()
  listed = []
})
afterAll(() => {
  mock.module('../court-case', () => realCourt)
  mock.module('../orginfo', () => realOrginfo)
  mock.module('../chamber', () => realChamber)
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('Statistika and the cases found by number', () => {
  test('the found cases are counted with the list; one in both is counted once', async () => {
    listed = [row(1), row(2)]
    store.addFound(TIN, [{ courtType: 'economic', row: row(2) }, { courtType: 'economic', row: row(3) }, { courtType: 'economic', row: row(4, { caseStatus: 'Тугатилган', result: 'Даъво қаноатлантирилди' }) }], {})
    const s = await getCompanyStats(TIN, { force: true })
    expect(s.cases.map((c) => c.caseNumber).sort()).toEqual(['4-1001-2601/1', '4-1001-2601/2', '4-1001-2601/3', '4-1001-2601/4'])
    expect(s.summary.total).toBe(4)
  })

  test('with no found cases nothing changes', async () => {
    listed = [row(1)]
    const s = await getCompanyStats(TIN, { force: true })
    expect(s.summary.total).toBe(1)
  })

  test('a found case is counted under the court its number says', async () => {
    store.addFound(TIN, [{ courtType: 'economic', row: row(9) }], {})
    const s = await getCompanyStats(TIN, { force: true })
    expect(s.cases[0]!.courtType).toBe('economic')
  })
})
