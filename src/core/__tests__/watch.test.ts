import { describe, expect, test } from 'bun:test'
import { buildMessage, diffRow, instanceEvent, parseWatchConfig, WATCH_DEFAULT, instancesOf, rowSig, sidesOf, statusLine, type WatchEvent } from '../watch'
import type { CourtCase, FullCaseData } from '@/lib/court-case-types'

const row = (o: Partial<CourtCase> = {}): CourtCase => ({ caseNumber: '2-1004-2611/1', caseType: '', caseStatus: 'Тайинлаш', result: '', courtName: '', dateFiled: '', plaintiff: 'Универсал Савдо МЧЖ', defendant: '«ANOR» МЧЖ', claimAmount: '', hearingDate: '', hearingTime: '', judge: '', ...o })
const detail = (o: Partial<NonNullable<FullCaseData['general']>> = {}, ins: Partial<FullCaseData> = {}): FullCaseData => ({
  general: { caseNumber: '2-1004-2611/1', caseType: '', caseStatus: 'Тайинлаш', court: '', judge: '', secretary: '', plaintiff: 'Универсал Савдо МЧЖ', plaintiffTin: '201234567', defendant: '«ANOR» МЧЖ', defendantTin: '207275139', thirdParty: '', claimSubject: '', claimAmount: '', applicationDate: '', initiatedDate: '', deadlineDate: '', stateDuty: '', representative: '', prosecutor: '', ...o },
  firstInstance: { hearings: [], decision: null, documents: [] }, appellate: null, cassation: null, inspection: null, ...ins,
})

describe('what is news in a row', () => {
  test('a case never seen is new; the same signature is nothing; a changed status or hearing is news and asks for the detail again', () => {
    const r = row()
    expect(diffRow(undefined, r)).toEqual({ kind: 'new', recheck: true })
    expect(diffRow({ sig: rowSig(r), ins: '' }, r)).toEqual({ kind: null, recheck: false })
    expect(diffRow({ sig: rowSig(row({ caseStatus: 'Рўйхатга олиш' })), ins: '' }, r)).toEqual({ kind: 'status', recheck: true })
    expect(diffRow({ sig: rowSig(r), ins: '' }, row({ hearingDate: '15.12.2030', hearingTime: '10:00' }))).toEqual({ kind: 'hearing', recheck: true })
    expect(diffRow({ sig: rowSig(r), ins: '' }, row({ hearingStage: 'appeal' })).kind).toBe('hearing')
  })
  test('the signature ignores whitespace noise but not content', () => {
    expect(rowSig(row({ caseStatus: ' Тайинлаш ' }))).toBe(rowSig(row()))
    expect(rowSig(row({ result: 'x' }))).not.toBe(rowSig(row()))
  })
  test('an instance is new when the detail shows one the last read did not', () => {
    expect(instancesOf(null)).toBe('')
    expect(instancesOf(detail())).toBe('')
    const appealed = detail({}, { appellate: { hearings: [], decision: null, documents: [] } })
    expect(instancesOf(appealed)).toBe('A')
    expect(instanceEvent('', appealed)).toBe('A')
    expect(instanceEvent(null, appealed)).toBeNull() // never read before: not news
    expect(instanceEvent('A', appealed)).toBeNull()
    const both = detail({}, { appellate: { hearings: [], decision: null, documents: [] }, cassation: { hearings: [], decision: null, documents: [] } })
    expect(instanceEvent('A', both)).toBe('C')
  })
})

describe('which side the company is', () => {
  test('a party TIN in the detail decides, even against the names', () => {
    const s = sidesOf('207275139', 'Hech Qanday Nom', row(), detail())
    expect(s.role).toBe('defendant')
    expect(s.by).toBe('tin')
    expect(sidesOf('201234567', '', row(), detail()).role).toBe('plaintiff')
  })
  test('without a detail the names decide, in either script; both or neither match is not known', () => {
    expect(sidesOf('207275139', 'ANOR TEXTILE MChJ', row({ defendant: '«ANOR TEXTILE» МЧЖ' }), null)).toMatchObject({ role: 'defendant', by: 'name' })
    expect(sidesOf('207275139', 'ANOR TEXTILE MChJ', row({ plaintiff: 'ANOR TEXTILE МЧЖ', defendant: 'Boshqa Firma MChJ' }), null).role).toBe('plaintiff')
    expect(sidesOf('207275139', 'ANOR TEXTILE MChJ', row({ plaintiff: 'A MChJ', defendant: 'B MChJ' }), null)).toMatchObject({ role: '', by: 'none' })
    expect(sidesOf('207275139', '', row(), null).role).toBe('')
  })
})

describe('the message', () => {
  const ev = (o: Partial<WatchEvent> = {}): WatchEvent => {
    const r = row({ hearingDate: '15.12.2030', hearingTime: '10:00' })
    const d = detail({ deadlineDate: '05.12.2030' })
    return { kind: 'new', tin: '207275139', companyName: '«ANOR» МЧЖ', courtType: 'civil', row: r, detail: d, sides: sidesOf('207275139', '', r, d), ...o }
  }
  test('a new filing says which side you are, who is who with TINs, the status and the deadline', () => {
    const m = buildMessage(ev())
    expect(m).toContain('Sudga yangi ariza topshirildi')
    expect(m).toContain('Siz: javobgarsiz')
    expect(m).toContain('Daʼvogar: Universal Savdo MChJ (STIR 201234567)')
    expect(m).toContain('Javobgar: «ANOR» MChJ (STIR 207275139)')
    expect(m).toContain('Ish: 2-1004-2611/1 · Fuqarolik')
    expect(m).toContain('Holati: Tayinlash · Muddat: 05.12.2030')
    expect(m).toContain('Majlis: 15.12.2030 10:00')
    expect(m).not.toMatch(/[А-Яа-я]/) // Latin only
  })
  test('the other kinds have their own headline; an appeal names the instance', () => {
    expect(buildMessage(ev({ kind: 'instance', instance: 'A' }))).toContain('Apellyatsiyaga shikoyat topshirildi')
    expect(buildMessage(ev({ kind: 'instance', instance: 'C' }))).toContain('Kassatsiyaga shikoyat topshirildi')
    expect(buildMessage(ev({ kind: 'hearing' }))).toContain('Majlis sanasi yangilandi')
    expect(buildMessage(ev({ kind: 'status' }))).toContain('Ish holati oʻzgardi')
  })
  test('an unknown side says nothing about «siz»; no status is «nomaʼlum»; a missing detail still gives a message', () => {
    const r = row({ caseStatus: '-', plaintiff: 'A MChJ', defendant: 'B MChJ' })
    const m = buildMessage(ev({ row: r, detail: null, sides: sidesOf('207275139', 'ANOR', r, null) }))
    expect(m).not.toContain('Siz:')
    expect(m).toContain('Holati: nomaʼlum')
    expect(statusLine(r, null)).toBe('Holati: nomaʼlum')
  })
})

describe('the setting', () => {
  test('a body keeps what it does not name; intervals, ids and TINs are checked', () => {
    expect(parseWatchConfig({ enabled: true })).toEqual({ ...WATCH_DEFAULT, enabled: true })
    const c = parseWatchConfig({ enabled: true, intervalHours: 6, tins: '207275139, 302678824', recipients: ['1668239329', 42424] })!
    expect(c).toEqual({ enabled: true, intervalHours: 6, tins: ['207275139', '302678824'], recipients: [1668239329, 42424] })
    expect(parseWatchConfig({ tins: [] }, c)?.tins).toBeNull() // empty = every company
    expect(parseWatchConfig({ intervalHours: 0.5 })).toBeNull()
    expect(parseWatchConfig({ intervalHours: 99 })).toBeNull()
    expect(parseWatchConfig({ tins: ['12'] })).toBeNull()
    expect(parseWatchConfig({ recipients: ['abc'] })).toBeNull()
    expect(parseWatchConfig({ enabled: 'yes' })).toBeNull()
    expect(parseWatchConfig('x')).toBeNull()
  })
})
