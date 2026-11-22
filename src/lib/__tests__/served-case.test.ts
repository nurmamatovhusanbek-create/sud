/**
 * What the case drawer is shown (lib/served-case): the court, the disk copy, and «Yangilash». The court is faked.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'served-case-'))
process.env.CASE_STORE_DIR = DIR
process.env.SNAPSHOT_DIR = path.join(DIR, 'snap')
const store = await import('../case-store')
const snaps = await import('../snapshot-store')
const { servedCaseDetail, freezeOf } = await import('../served-case')
import type { CourtCase, FullCaseData } from '../court-case-types'

const NOW = new Date(2026, 10, 22)
const dmy = (daysAgo: number): string => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
const CASE = '4-1001-2621/1'
const TIN = '207324986'
const detail = (status: string, hearingAgo: number, tag = 'x'): FullCaseData => ({
  general: { caseNumber: CASE, caseType: tag, caseStatus: status, court: 'Sud', judge: 'J', secretary: '-', plaintiff: 'A', plaintiffTin: '-', defendant: 'B', defendantTin: '-', thirdParty: '-', claimSubject: '', claimAmount: '-', applicationDate: dmy(hearingAgo + 30), initiatedDate: '-', deadlineDate: '-', stateDuty: '-', representative: '-', prosecutor: '-' },
  firstInstance: { hearings: [{ date: dmy(hearingAgo), time: '10:00', status: '-', postponementReason: '', courtroom: '', judge: 'J' }], decision: null, documents: [] },
  appellate: null, cassation: null, inspection: null,
})
const row = (n: string, extra: Partial<CourtCase> = {}): CourtCase => ({
  caseNumber: n, caseType: 'Qarz', caseStatus: 'Кўриб чиқиш жараёнида', result: '', courtName: 'Sud', dateFiled: '', plaintiff: 'A', defendant: 'B', claimAmount: '1', hearingDate: '', hearingTime: '', judge: '', ...extra,
})

let calls = 0
let answer: () => Promise<{ data: FullCaseData; row: CourtCase | null }>
const fetcher = async () => {
  calls++
  return answer()
}
const EMPTY: FullCaseData = { general: null, firstInstance: null, appellate: null, cassation: null, inspection: null }

beforeEach(() => {
  store.forgetCaseStoreMemory()
  fs.rmSync(DIR, { recursive: true, force: true })
  snaps.__resetSnapshotsForTests()
  calls = 0
})
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }))

describe('servedCaseDetail', () => {
  test('a first open reads the court and stores the answer', async () => {
    answer = async () => ({ data: detail('Кўриб чиқиш жараёнида', 3), row: null })
    const s = await servedCaseDetail('economic', CASE, fetcher, { now: NOW })
    expect(s).toMatchObject({ fromStore: false, stale: false, frozen: false })
    expect(store.readDetail('economic', CASE)?.data.general?.caseStatus).toBe('Кўриб чиқиш жараёнида')
  })

  test('a case that ended long ago is served from disk and the court is NOT asked', async () => {
    store.writeDetail('economic', CASE, detail('Якунланган (Ижро варақасиз)', 400, 'stored'), 1000)
    answer = async () => { throw new Error('must not be asked') }
    const s = await servedCaseDetail('economic', CASE, fetcher, { now: NOW })
    expect(calls).toBe(0)
    expect(s).toMatchObject({ fromStore: true, frozen: true, stale: false, fetchedAt: 1000 })
    expect(s.data.general?.caseType).toBe('stored')
  })

  test('a case that ended recently is still read live (an appeal may have been filed since)', async () => {
    store.writeDetail('economic', CASE, detail('Якунланган (Ижро варақасиз)', 20, 'stored'), 1000)
    answer = async () => ({ data: detail('Якунланган (Ижро варақасиз)', 5, 'fresh'), row: null })
    const s = await servedCaseDetail('economic', CASE, fetcher, { now: NOW })
    expect(calls).toBe(1)
    expect(s.data.general?.caseType).toBe('fresh')
  })

  test('«Yangilash» asks the court even for a frozen case', async () => {
    store.writeDetail('economic', CASE, detail('Архивда', 500, 'stored'), 1000)
    answer = async () => ({ data: detail('Архивда', 500, 'again'), row: null })
    const s = await servedCaseDetail('economic', CASE, fetcher, { refresh: true, now: NOW })
    expect(calls).toBe(1)
    expect(s.data.general?.caseType).toBe('again')
    expect(store.readDetail('economic', CASE)?.data.general?.caseType).toBe('again')
  })

  test('a plain open whose court call FAILS shows the stored copy flagged stale', async () => {
    store.writeDetail('economic', CASE, detail('Кўриб чиқиш жараёнида', 3, 'stored'), 1000)
    answer = async () => { throw new Error('timeout') }
    const s = await servedCaseDetail('economic', CASE, fetcher, { now: NOW })
    expect(s).toMatchObject({ fromStore: true, stale: true, fetchedAt: 1000 })
    expect(s.data.general?.caseType).toBe('stored')
  })

  test('«Yangilash» that FAILS throws and leaves the stored copy exactly as it was', async () => {
    store.writeDetail('economic', CASE, detail('Кўриб чиқиш жараёнида', 3, 'stored'), 1000)
    answer = async () => { throw new Error('timeout') }
    await expect(servedCaseDetail('economic', CASE, fetcher, { refresh: true, now: NOW })).rejects.toThrow('timeout')
    expect(store.readDetail('economic', CASE)).toMatchObject({ t: 1000 })
    expect(store.readDetail('economic', CASE)?.data.general?.caseType).toBe('stored')
  })

  test('an answer of «no such case» is a failed source, never an erased case', async () => {
    store.writeDetail('economic', CASE, detail('Кўриб чиқиш жараёнида', 3, 'stored'), 1000)
    answer = async () => ({ data: EMPTY, row: null })
    const plain = await servedCaseDetail('economic', CASE, fetcher, { now: NOW })
    expect(plain).toMatchObject({ stale: true, fromStore: true })
    await expect(servedCaseDetail('economic', CASE, fetcher, { refresh: true, now: NOW })).rejects.toThrow()
    expect(store.readDetail('economic', CASE)?.data.general).not.toBeNull()
  })

  test('with nothing stored a failure is the answer and nothing is written', async () => {
    answer = async () => { throw new Error('timeout') }
    await expect(servedCaseDetail('economic', CASE, fetcher, { now: NOW })).rejects.toThrow('timeout')
    answer = async () => ({ data: EMPTY, row: null })
    const s = await servedCaseDetail('economic', CASE, fetcher, { now: NOW })
    expect(s.data.general).toBeNull()
    expect(store.readDetail('economic', CASE)).toBeNull()
  })

  test('a fresh answer puts its row into the company\'s stored list AND its day snapshot, keeping the snapshot\'s own age', async () => {
    store.writeFeed(TIN, 'civil|h/p', { t: 1, complete: true, items: [row('2-1-2/1'), row(CASE)] })
    const T0 = Date.now() - 3_600_000
    snaps.writeSnapshot(TIN, 'court:civil', { cases: [row('2-1-2/1'), row(CASE)] }, T0)
    answer = async () => ({ data: detail('Якунланган (Ижро варақасиз)', 5), row: row(CASE, { caseStatus: 'Якунланган (Ижро варақасиз)', result: 'Рад' }) })
    await servedCaseDetail('civil', CASE, fetcher, { refresh: true, tin: TIN, now: NOW })
    expect(store.readFeed(TIN, 'civil|h/p')?.items.find((r) => r.caseNumber === CASE)?.result).toBe('Рад')
    const snap = snaps.readSnapshot<{ cases: CourtCase[] }>(TIN, 'court:civil')
    expect(snap?.fetchedAt).toBe(T0)
    expect(snap?.data.cases.find((r) => r.caseNumber === CASE)?.result).toBe('Рад')
    expect(snap?.data.cases).toHaveLength(2)
  })

  test('freezeOf reads every instance\'s hearings and rulings', () => {
    const d = detail('Якунланган (Ижро варақасиз)', 400)
    d.cassation = { hearings: [{ date: dmy(10), time: '', status: '', postponementReason: '', courtroom: '', judge: '' }], decision: null, documents: [] }
    expect(freezeOf(d, NOW).frozen).toBe(false) // the cassation hearing 10 days ago keeps it open
    expect(freezeOf(detail('Якунланган (Ижро варақасиз)', 400), NOW).frozen).toBe(true)
  })
})
