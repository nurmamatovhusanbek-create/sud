/**
 * The court-case memory (lib/case-store): feeds, merge, row patching, details, and that no path can be smuggled through a STIR or a case number.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'case-store-'))
process.env.CASE_STORE_DIR = DIR
const store = await import('../case-store')
import type { CourtCase, FullCaseData } from '../court-case-types'

const row = (n: string, extra: Partial<CourtCase> = {}): CourtCase => ({
  caseNumber: n, caseType: 'Qarz', caseStatus: 'Кўриб чиқиш жараёнида', result: '', courtName: 'Sud', dateFiled: '01.02.2026', plaintiff: 'A', defendant: 'B',
  claimAmount: '100', hearingDate: '', hearingTime: '', judge: '', ...extra,
})
const detail = (status = 'Якунланган (Ижро варақасиз)'): FullCaseData => ({
  general: { caseNumber: '4-1001-2621/1', caseType: '', caseStatus: status, court: 'Sud', judge: 'J', secretary: '-', plaintiff: 'A', plaintiffTin: '-', defendant: 'B', defendantTin: '-', thirdParty: '-', claimSubject: '', claimAmount: '-', applicationDate: '01.02.2025', initiatedDate: '01.02.2025', deadlineDate: '-', stateDuty: '-', representative: '-', prosecutor: '-' },
  firstInstance: null, appellate: null, cassation: null, inspection: null,
})

beforeEach(() => {
  store.forgetCaseStoreMemory()
  fs.rmSync(DIR, { recursive: true, force: true })
})
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }))

describe('feeds', () => {
  test('a feed survives a restart (read again from the disk) with its ETag', () => {
    expect(store.writeFeed('207324986', 'civil|host/x', { t: 5, etag: 'W/"abc"', complete: true, items: [row('2-1/1'), row('2-1/2')] })).toBe(true)
    store.forgetCaseStoreMemory()
    const f = store.readFeed('207324986', 'civil|host/x')
    expect(f?.etag).toBe('W/"abc"')
    expect(f?.items.map((r) => r.caseNumber)).toEqual(['2-1/1', '2-1/2'])
    expect(f?.complete).toBe(true)
  })

  test('the file is gzip, owner-only, and written atomically (no tmp file is left)', () => {
    store.writeFeed('207324986', 'k', { t: 1, complete: true, items: [row('2-1/1')] })
    const file = path.join(DIR, '207324986.json.gz')
    expect(JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString()).tin).toBe('207324986')
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(fs.readdirSync(DIR).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  test('a damaged file reads as nothing and the next write replaces it', () => {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(path.join(DIR, '207324986.json.gz'), 'not gzip')
    expect(store.readFeed('207324986', 'k')).toBeNull()
    expect(store.writeFeed('207324986', 'k', { t: 1, complete: true, items: [] })).toBe(true)
    store.forgetCaseStoreMemory()
    expect(store.readFeed('207324986', 'k')?.items).toEqual([])
  })

  test('only a 9-digit STIR becomes a file name', () => {
    for (const bad of ['../../etc/passwd', '12345678', '1234567890', '20732498a', '']) {
      expect(store.writeFeed(bad, 'k', { t: 1, complete: true, items: [] })).toBe(false)
      expect(store.readFeed(bad, 'k')).toBeNull()
    }
    expect(fs.existsSync(DIR)).toBe(false)
  })

  test('mergeRows: the arrived row wins, the rows that did not arrive stay, the stored order holds', () => {
    const kept = [row('2-1/1', { caseStatus: 'old' }), row('2-1/2'), row('2-1/3')]
    const arrived = [row('2-1/3', { caseStatus: 'new' }), row('2-1/1', { caseStatus: 'new' }), row('2-1/9')]
    const out = store.mergeRows(kept, arrived)
    expect(out.map((r) => r.caseNumber)).toEqual(['2-1/1', '2-1/2', '2-1/3', '2-1/9'])
    expect(out.find((r) => r.caseNumber === '2-1/1')?.caseStatus).toBe('new')
    expect(out.find((r) => r.caseNumber === '2-1/2')?.caseStatus).toBe('Кўриб чиқиш жараёнида')
  })

  test('patchRow replaces the case in the court\'s feeds, adds it when no feed has it, and leaves other courts alone', () => {
    store.writeFeed('207324986', 'civil|a', { t: 1, complete: true, items: [row('2-1/1'), row('2-1/2')] })
    store.writeFeed('207324986', 'economic|b', { t: 1, complete: true, items: [row('4-1/1')] })
    expect(store.patchRow('207324986', 'civil', row('2-1/2', { caseStatus: 'Архивда' }))).toBe(true)
    expect(store.readFeed('207324986', 'civil|a')?.items.map((r) => r.caseStatus)).toEqual(['Кўриб чиқиш жараёнида', 'Архивда'])
    store.patchRow('207324986', 'civil', row('2-1/77'))
    expect(store.readFeed('207324986', 'civil|a')?.items.map((r) => r.caseNumber)).toEqual(['2-1/1', '2-1/2', '2-1/77'])
    expect(store.readFeed('207324986', 'economic|b')?.items).toHaveLength(1)
    // no stored feed of that court: nothing to patch
    expect(store.patchRow('207324986', 'administrative', row('3-1/1'))).toBe(false)
    expect(store.patchRow('111111111', 'civil', row('2-1/1'))).toBe(false)
  })
})

describe('details', () => {
  test('a detail is stored under court and number and read back with its time', () => {
    expect(store.writeDetail('economic', '4-1001-2621/1', detail(), 1234)).toBe(true)
    const r = store.readDetail('economic', '4-1001-2621/1')
    expect(r?.t).toBe(1234)
    expect(r?.data.general?.caseStatus).toContain('Якунланган')
    expect(fs.existsSync(path.join(DIR, 'details', 'economic', '4-1001-2621@1.json.gz'))).toBe(true)
    expect(store.readDetail('civil', '4-1001-2621/1')).toBeNull()
  })

  test('only a case-number shape and a known court reach the disk', () => {
    for (const bad of ['../../x', '4-1001-2621/1/../2', '4-1001-2621', '4-1001-2621/1 ', '']) {
      expect(store.writeDetail('economic', bad, detail())).toBe(false)
      expect(store.readDetail('economic', bad)).toBeNull()
    }
    expect(store.writeDetail('../civil' as never, '4-1001-2621/1', detail())).toBe(false)
    expect(fs.existsSync(path.join(DIR, 'details'))).toBe(false)
  })

  test('stats count what is kept', () => {
    store.writeFeed('207324986', 'k', { t: 1, complete: true, items: [] })
    store.writeDetail('civil', '2-1-2/1', detail())
    store.writeDetail('economic', '4-1-2/1', detail())
    expect(store.caseStoreStats()).toEqual({ companies: 1, details: 2 })
  })
})
