/**
 * Kuzatuv (lib/watch) with the court, the case detail and Telegram faked: the first read is silent, news is announced once and remembered only after a
 * message went out, a failed send or a missing recipient loses nothing, one failing company does not stop the next, a crowded run is paced.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

mock.module('server-only', () => ({}))
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'))
process.env.SUD_DB = path.join(DIR, 'sud.db')
const dbm = await import('../db')
const lib = await import('../watch')
const store = await import('../watch-store')
import type { WatchDeps } from '../watch'
import type { CourtCase, CourtType, FullCaseData } from '../court-case-types'
import type { CaseLean, CourtListResult } from '../court-case'
import { WATCH_DEFAULT, type WatchConfig } from '@/core/watch'

const TIN = '207275139'
const OTHER = '302678824'
const CFG: WatchConfig = { ...WATCH_DEFAULT, enabled: true, recipients: [4242] }

const row = (n: number, o: Partial<CourtCase> = {}): CourtCase => ({ caseNumber: `2-1004-2611/${n}`, caseType: '', caseStatus: 'Тайинлаш', result: '', courtName: '', dateFiled: '', plaintiff: 'Универсал Савдо МЧЖ', defendant: '«SAMARQAND KABEL» МЧЖ', claimAmount: '', hearingDate: '', hearingTime: '', judge: '', ...o })
const detail = (n: number, ins: Partial<FullCaseData> = {}): FullCaseData => ({
  general: { caseNumber: `2-1004-2611/${n}`, caseType: '', caseStatus: 'Тайинлаш', court: '', judge: '', secretary: '', plaintiff: 'Универсал Савдо МЧЖ', plaintiffTin: '201234567', defendant: '«SAMARQAND KABEL» МЧЖ', defendantTin: TIN, thirdParty: '', claimSubject: '', claimAmount: '', applicationDate: '', initiatedDate: '', deadlineDate: '05.12.2030', stateDuty: '', representative: '', prosecutor: '' },
  firstInstance: { hearings: [], decision: null, documents: [] }, appellate: null, cassation: null, inspection: null, ...ins,
})
const appeal = { hearings: [], decision: null, documents: [] }

let lists: Record<string, CourtCase[]>   // `${court}:${tin}` → rows
let listFail: Set<string>
let incomplete: Set<string>
let details: Record<string, CaseLean>    // case number → answer
let sent: Array<{ chat: number; text: string }>
let sendOk: boolean
let t = 0

const deps: WatchDeps = {
  list: async (court: CourtType, tin: string): Promise<CourtListResult> => {
    const k = `${court}:${tin}`
    if (listFail.has(k)) throw new Error('sud saytiga ulanib boʻlmadi')
    return { cases: lists[k] ?? [], incomplete: incomplete.has(k) }
  },
  detail: async (_c, num) => details[num] ?? { kind: 'found', via: 'new', data: detail(Number(num.split('/')[1])), row: null },
  send: async (chat, text) => { if (!sendOk) return false; sent.push({ chat, text }); return true },
  name: (tin) => (tin === TIN ? '«SAMARQAND KABEL» МЧЖ' : ''),
  now: () => (t += 1000),
  sleep: async () => {},
}
const run = (cfg = CFG, tins = [TIN]) => lib.runWatch(deps, cfg, tins)

beforeEach(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
  fs.mkdirSync(DIR, { recursive: true })
  lists = {}; listFail = new Set(); incomplete = new Set(); details = {}; sent = []; sendOk = true; t = 1_700_000_000_000
})
afterAll(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('the first read and what is new after it', () => {
  test('the first read of a company is silent: it only remembers; the second read announces a new case once', async () => {
    lists[`civil:${TIN}`] = [row(1), row(2), row(3)]
    const first = await run()
    expect(first).toMatchObject({ companies: 1, rows: 3, baselines: 3, events: 0, sent: 0 })
    expect(sent).toEqual([])
    lists[`civil:${TIN}`] = [row(1), row(2), row(3), row(4)]
    const second = await run()
    expect(second).toMatchObject({ events: 1, sent: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.chat).toBe(4242)
    expect(sent[0]!.text).toContain('Sudga yangi ariza topshirildi')
    expect(sent[0]!.text).toContain('<b>Siz: javobgarsiz</b>') // the TIN in the detail is the company's, on the defendant's side
    expect(sent[0]!.text).toContain('<b>Daʼvogar:</b> Universal Savdo MChJ <i>(STIR 201234567)</i>')
    expect(sent[0]!.text).toContain('<b>Holati:</b> Tayinlash · <b>Muddat:</b> 05.12.2030')
    // and never again
    expect((await run()).events).toBe(0)
    expect(sent).toHaveLength(1)
  })

  test('a changed status and a moved hearing are news; an unchanged row is not', async () => {
    lists[`economic:${TIN}`] = [row(1), row(2)]
    await run()
    lists[`economic:${TIN}`] = [row(1, { caseStatus: 'Кўриб чиқиш жараёнида' }), row(2, { hearingDate: '15.12.2030', hearingTime: '10:00' })]
    const r = await run()
    expect(r.events).toBe(2)
    expect(sent.map((s) => s.text.split('\n')[0]).sort()).toEqual(['📅 <b>Majlis sanasi yangilandi</b>', '🔔 <b>Ish holati oʻzgardi</b>'])
    expect(sent.find((s) => s.text.includes('Majlis sanasi'))!.text).toContain('<b>Majlis:</b> 15.12.2030 10:00')
  })

  test('a case that reached the appeal court is announced as such (the detail shows it), and an instance that was already there is not news', async () => {
    lists[`civil:${TIN}`] = [row(1)]
    details['2-1004-2611/1'] = { kind: 'found', via: 'new', data: detail(1), row: null }
    await run()
    // the row changes (an appeal hearing is set) and the detail now shows the appellate instance
    lists[`civil:${TIN}`] = [row(1, { hearingDate: '20.12.2030', hearingTime: '11:00', hearingStage: 'appeal' })]
    details['2-1004-2611/1'] = { kind: 'found', via: 'new', data: detail(1, { appellate: appeal }), row: null }
    // the baseline never read the detail (ins is unknown): the first appeal seen is only recorded
    expect((await run()).events).toBe(1)
    expect(sent.at(-1)!.text).toContain('Majlis sanasi yangilandi')
    // the detail read now knows «none»; a later row change with a NEW cassation is an instance event
    lists[`civil:${TIN}`] = [row(1, { hearingDate: '25.12.2030', hearingTime: '11:00', hearingStage: 'cassation' })]
    details['2-1004-2611/1'] = { kind: 'found', via: 'new', data: detail(1, { appellate: appeal, cassation: appeal }), row: null }
    await run()
    expect(sent.at(-1)!.text).toContain('Kassatsiyaga shikoyat topshirildi')
  })

  test('without a detail the message still goes out, the side decided by the names', async () => {
    lists[`civil:${TIN}`] = []
    await run()
    lists[`civil:${TIN}`] = [row(9)]
    details['2-1004-2611/9'] = { kind: 'error', message: 'timeout' }
    await run()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toContain('<b>Siz: javobgarsiz</b>') // the defendant's name is the company's
    expect(sent[0]!.text).not.toMatch(/[А-Яа-я]/)
  })
})

describe('nothing is lost', () => {
  test('with nobody to tell, news is NOT remembered: it goes out once there is a recipient', async () => {
    lists[`civil:${TIN}`] = [row(1)]
    await run()
    lists[`civil:${TIN}`] = [row(1), row(2)]
    const r = await run({ ...CFG, recipients: [] })
    expect(r.events).toBe(1)
    expect(r.errors.join(' ')).toContain('Xabar oluvchi')
    expect(sent).toEqual([])
    await run()
    expect(sent).toHaveLength(1)
  })

  test('a failed send is tried again at the next run; a sent one is not repeated', async () => {
    lists[`civil:${TIN}`] = [row(1)]
    await run()
    lists[`civil:${TIN}`] = [row(1), row(2)]
    sendOk = false
    const bad = await run()
    expect(bad.sent).toBe(0)
    expect(bad.errors.join(' ')).toContain('xabar yuborilmadi')
    sendOk = true
    expect((await run()).sent).toBe(1)
    expect((await run()).events).toBe(0)
  })

  test('an incomplete list is an error and never a baseline; a failing company does not stop the next', async () => {
    lists[`civil:${TIN}`] = [row(1)]
    incomplete.add(`civil:${TIN}`)
    listFail.add(`economic:${OTHER}`)
    lists[`civil:${OTHER}`] = [row(7)]
    const r = await run(CFG, [TIN, OTHER])
    expect(r.errors.some((e) => e.includes('toʻliq emas'))).toBe(true)
    expect(r.errors.some((e) => e.includes('sud saytiga'))).toBe(true)
    expect(r).toMatchObject({ companies: 2, baselines: 1 }) // only the other company's civil list was read
    expect(store.hasBaseline(TIN, 'civil')).toBe(false)
    expect(store.hasBaseline(OTHER, 'civil')).toBe(true)
    // once complete, the first read of TIN is still silent
    incomplete.clear()
    await run()
    expect(sent).toEqual([])
  })

  test('a crowded run is paced: 15 messages and a note, the rest at the next run', async () => {
    lists[`civil:${TIN}`] = [row(0)]
    await run()
    lists[`civil:${TIN}`] = Array.from({ length: 21 }, (_, i) => row(i))
    const r = await run()
    expect(r.events).toBe(20)
    expect(r.sent).toBe(15)
    expect(sent).toHaveLength(16)
    expect(sent.at(-1)!.text).toContain('yana <b>5</b> ta')
    const next = await run()
    expect(next.sent).toBe(5)
  })
})

describe('the sweep', () => {
  test('an open case whose row did not change is read again once a day: a new appeal is announced, a first read is silent', async () => {
    lists[`civil:${TIN}`] = [row(1)]
    await run() // baseline: ins unknown
    // the first sweep (checked_at 0) records the detail silently
    await run()
    expect(sent).toEqual([])
    expect(store.readSeen(TIN).get('2-1004-2611/1')!.ins).toBe('')
    // a day later the detail shows an appeal although the row is the same
    details['2-1004-2611/1'] = { kind: 'found', via: 'new', data: detail(1, { appellate: appeal }), row: null }
    t += lib.SWEEP_AGE_MS + 1000
    const r = await run()
    expect(r.events).toBe(1)
    expect(sent[0]!.text).toContain('Apellyatsiyaga shikoyat topshirildi')
    // a concluded case is never swept
    lists[`civil:${TIN}`] = [row(5, { caseStatus: 'Якунланган (Ижро варақасиз)' })]
    await run()
    t += lib.SWEEP_AGE_MS + 1000
    details['2-1004-2611/5'] = { kind: 'found', via: 'new', data: detail(5, { appellate: appeal }), row: null }
    const before = sent.length
    await run()
    expect(sent.length).toBe(before)
  })
})

describe('the setting and the schedule', () => {
  test('the setting is kept in the database; the next run is due one interval after the last', () => {
    expect(store.readWatchConfig()).toEqual(WATCH_DEFAULT)
    store.saveWatchConfig({ ...CFG, intervalHours: 6 })
    expect(store.readWatchConfig().recipients).toEqual([4242])
    expect(lib.nextWatchAt()).toBe(6 * 3_600_000) // never run: due as soon as the clock passes epoch + 6 h
    store.saveLastRun({ at: 1_000_000, ms: 1, companies: 1, rows: 0, events: 0, sent: 0, baselines: 0, errors: [] })
    expect(lib.nextWatchAt()).toBe(1_000_000 + 6 * 3_600_000)
    store.saveWatchConfig({ ...CFG, enabled: false })
    expect(lib.nextWatchAt()).toBeNull() // switched off: nothing is ever due
  })

  test('the companies watched: the setting names them, else every company the database knows', () => {
    const db = dbm.getDb()
    db.prepare('INSERT INTO companies (tin, first_at, refreshed_at, last_added) VALUES (?, 1, 1, 0)').run(TIN)
    expect(lib.watchedTins(CFG)).toEqual([TIN])
    expect(lib.watchedTins({ ...CFG, tins: [OTHER] })).toEqual([OTHER])
  })
})
