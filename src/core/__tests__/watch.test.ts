import { describe, expect, test } from 'bun:test'
import { buildMessage, watchKeyboard, changeLines, normSig, escapeHtml, diffRow, instanceEvent, parseWatchConfig, WATCH_DEFAULT, instancesOf, rowSig, sidesOf, statusLine, type WatchEvent } from '../watch'
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
    expect(m).toContain('<b>Siz: javobgarsiz</b>')
    expect(m).toContain('<b>Daʼvogar:</b> Universal Savdo MChJ <i>(STIR 201234567)</i>')
    expect(m).toContain('<b>Javobgar:</b> «ANOR» MChJ <i>(STIR 207275139)</i>')
    expect(m).toContain('<b>Ish:</b> <code>2-1004-2611/1</code> · Fuqarolik')
    expect(m).toContain('<b>Holati:</b> Tayinlash · <b>Muddat:</b> 05.12.2030')
    expect(m).toContain('<b>Majlis:</b> 15.12.2030 10:00')
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
    expect(m).toContain('<b>Holati:</b> nomaʼlum')
    expect(statusLine(r, null)).toBe('<b>Holati:</b> nomaʼlum')
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

describe('the message is Telegram HTML: a name cannot break it', () => {
  test('markup characters in a party, a company or a case number are escaped; the layout is headline, blank line, lines, blank line, source', () => {
    const r = row({ plaintiff: 'A & B <x> MChJ', defendant: 'C MChJ' })
    const m = buildMessage({ kind: 'new', tin: '207275139', companyName: 'Firma <z> & Ko', courtType: 'civil', row: r, detail: null, sides: sidesOf('207275139', 'Firma <z> & Ko', r, null) })
    expect(m).toContain('A &amp; B &lt;x&gt; MChJ')
    expect(m).toContain('Firma &lt;z&gt; &amp; Ko')
    expect(m).not.toMatch(/<x>|<z>/)
    const [head, blank1, ...rest] = m.split('\n')
    expect(head).toBe('⚖️ <b>Sudga yangi ariza topshirildi</b>')
    expect(blank1).toBe('')
    expect(rest.at(-2)).toBe('')
    expect(rest.at(-1)).toMatch(/^<i>Kuzatuv: .*\(STIR \d+\)<\/i>$/)
  })

  test('escapeHtml touches only & < >', () => {
    expect(escapeHtml('«A» & <B> oʻ')).toBe('«A» &amp; &lt;B&gt; oʻ')
  })
})

describe('what changed, said in the message', () => {
  const sigOf = (o: Partial<CourtCase>) => rowSig(row(o))
  test('the script, case, spaces and apostrophes of a word are not a change', () => {
    expect(normSig(sigOf({ caseStatus: 'Кўриб чиқиш жараёнида' }))).toBe(normSig(sigOf({ caseStatus: "KO'RIB  CHIQISH jarayonida" })))
    expect(diffRow({ sig: sigOf({ caseStatus: 'Кўриб чиқиш жараёнида' }), ins: '' }, row({ caseStatus: 'Koʻrib chiqish jarayonida' })).kind).toBeNull()
    expect(diffRow({ sig: sigOf({ caseStatus: 'Кўриб чиқиш жараёнида' }), ins: '' }, row({ caseStatus: 'Қаноатлантирилди' })).kind).toBe('status')
  })
  test('the status, the result and the hearing each say «before → now»', () => {
    const prev = sigOf({ caseStatus: 'Кўриб чиқиш жараёнида', hearingDate: '12.03.2030', hearingTime: '10:00' })
    const lines = changeLines(prev, row({ caseStatus: 'Қаноатлантирилди', result: 'Талаб қаноатлантирилди', hearingDate: '20.03.2030', hearingTime: '11:00' }))
    expect(lines).toEqual([
      '<b>Holati:</b> Koʻrib chiqish jarayonida → <b>Qanoatlantirildi</b>',
      '<b>Natija:</b> yoʻq → <b>Talab qanoatlantirildi</b>',
      '<b>Majlis:</b> 12.03.2030 10:00 → <b>20.03.2030 11:00</b>',
    ])
    expect(changeLines(prev, row({ caseStatus: 'Кўриб чиқиш жараёнида', hearingDate: '12.03.2030', hearingTime: '10:00' }))).toEqual([])
    expect(changeLines(undefined, row())).toEqual([])
    // a hearing taken off the calendar
    expect(changeLines(prev, row({ caseStatus: 'Кўриб чиқиш жараёнида' }))).toEqual(['<b>Majlis:</b> 12.03.2030 10:00 → <b>belgilanmagan</b>'])
  })
  test('a status message shows the change instead of a bare status, and escapes it', () => {
    const r = row({ caseStatus: 'Архивга топширилган <x>' })
    const d = detail({ caseStatus: 'Архивга топширилган <x>' })
    const m = buildMessage({ kind: 'status', tin: '207275139', companyName: '', courtType: 'economic', row: r, detail: d, sides: sidesOf('207275139', '', r, d), prevSig: sigOf({ caseStatus: 'Қаноатлантирилди' }) })
    expect(m).toContain('<b>Holati:</b> Qanoatlantirildi → <b>Arxivga topshirilgan &lt;x&gt;</b>')
    expect(m.match(/Holati:/g)).toHaveLength(1)
    // without a memory of the old value the plain status stays
    expect(buildMessage({ kind: 'status', tin: '207275139', companyName: '', courtType: 'economic', row: r, detail: d, sides: sidesOf('207275139', '', r, d) })).toContain('<b>Holati:</b> Arxivga topshirilgan')
  })
  test('a new case says when it was filed, and one filed long ago is not called a fresh filing', () => {
    const now = Date.UTC(2026, 10, 25)
    const mk = (dateFiled: string) => {
      const r = row({ dateFiled })
      const d = detail()
      return buildMessage({ kind: 'new', tin: '207275139', companyName: '', courtType: 'economic', row: r, detail: d, sides: sidesOf('207275139', '', r, d) }, now)
    }
    const fresh = mk('20.11.2026')
    expect(fresh).toContain('Sudga yangi ariza topshirildi')
    expect(fresh).toContain('<b>Ariza sanasi:</b> 20.11.2026')
    expect(mk('2026-11-01')).toContain('Sudga yangi ariza topshirildi')
    const old = mk('03.05.2019')
    expect(old).toContain('Roʻyxatda ish paydo boʻldi')
    expect(old).not.toContain('Sudga yangi ariza')
    expect(old).toContain('<b>Ariza sanasi:</b> 03.05.2019')
    expect(mk('')).toContain('Sudga yangi ariza topshirildi') // no date known: said as before
    expect(mk('')).not.toContain('Ariza sanasi')
  })
})

describe('the buttons under a Kuzatuv message', () => {
  test('«Qarorlar» always (the bot answers the callback), «Mini Appʼda ochish» only when the bot\'s address is known', () => {
    expect(watchKeyboard('2-1004-2603/8020', null)).toEqual({ inline_keyboard: [[{ text: '📄 Qarorlar', callback_data: 'r:2-1004-2603/8020' }]] })
    const k = watchKeyboard('2-1004-2603/8020', 'https://sud-bot.onrender.com/')
    expect(k.inline_keyboard).toHaveLength(2)
    expect(k.inline_keyboard[1]![0]).toEqual({ text: 'Mini Appʼda ochish', web_app: { url: 'https://sud-bot.onrender.com/app?case=2-1004-2603%2F8020' } })
  })
  test('callback data stays within Telegram\'s 64 bytes, and no case number means no buttons', () => {
    expect(watchKeyboard('x'.repeat(80), null).inline_keyboard).toEqual([])
    expect(watchKeyboard('', 'https://b.example').inline_keyboard).toEqual([])
    for (const row of watchKeyboard('4-1001-2629/43571', null).inline_keyboard) for (const b of row) expect(Buffer.byteLength(String(b.callback_data))).toBeLessThanOrEqual(64)
  })
})

