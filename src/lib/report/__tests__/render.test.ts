import { describe, expect, test } from 'bun:test'
import { buildReportDoc } from '../doc'
import { fontKitFromRules } from '../fonts'
import { buildReportModel, type ReportInput } from '../model'
import { reportTheme } from '../render'
import { FULL, NOW } from './fixtures'

const SPARSE: ReportInput = {
  stir: '200248856', generatedAt: NOW,
  info: { company: { tin: '200248856', officialName: '"ANDIJONKABEL" AJ', shortName: '', registeredDate: '05.03.2003', status: 'Faoliyat yuritmoqda', address: '', director: 'Turgunov Sh.A.', phone: '', email: '', charterCapital: '', registeringAuthority: '', thsht: 'AJ', dbibt: '', ifut: '', sustainabilityRating: '', largeTaxpayer: '', orgInfoUrl: '', founders: [] }, rating: null } as never,
  stats: null, cases: null, hearings: [], bills: null, failed: { stats: 'sud.uz 500' },
}
const NOTHING: ReportInput = { stir: '309922239', generatedAt: NOW, info: null, stats: null, cases: null, hearings: null, bills: null }

const FULL_MODEL = buildReportModel(FULL)
const doc = (input: ReportInput, dark = false) => buildReportDoc(buildReportModel(input), { dark })

describe.each([['full', FULL], ['sparse', SPARSE], ['nothing', NOTHING]] as const)('%s data', (_n, input) => {
  for (const dark of [false, true]) {
    test(`renders cleanly (${dark ? 'dark' : 'light'}): no undefined / NaN / [object`, () => {
      const html = doc(input, dark)
      expect(html).not.toMatch(/undefined|NaN|\[object|Infinity/)
    })
  }
})

describe('sections appear only when there is data behind them', () => {
  test('full: every section is present, charts are drawn', () => {
    const html = doc(FULL)
    for (const t of ['Umumiy maʼlumot', 'Faoliyat kodlari', 'Taʼsischilar', 'Toʻlovlar', 'Sud ishlari', 'Natijalar', 'Oylik faollik', 'Soʻnggi ishlar', 'Yaqin majlislar']) {
      expect(html).toContain(t)
    }
    // match the drawn <svg>, not the class name (the stylesheet always mentions it)
    expect(html).toContain('<svg class="rp-gauge"')
    expect(html).toContain('<svg class="rp-wheel"')
    expect(html).toContain('<svg class="rp-months"')
  })
  test('sparse: no court/bills/founders/rating sections; the gap is stated', () => {
    const html = doc(SPARSE)
    expect(html).not.toContain('<svg class="rp-wheel"')
    expect(html).not.toContain('<svg class="rp-gauge"')
    expect(html).not.toContain('Taʼsischilar')
    expect(html).not.toContain('Toʻlovlar')
    expect(html).toContain('Reyting mavjud emas')
    expect(html).toContain('Sud ishlari:</b> maʼlumot olinmadi')
    expect(html).not.toContain('sud.uz') // the reader needs to know a section is missing, not which site failed
    expect(html).toContain('Belgilangan majlis yoʻq') // an empty list is an answer, not a failure
  })
  test('nothing: still a valid report that says what failed', () => {
    const html = doc(NOTHING)
    expect(html).toContain('STIR 309922239')
    expect(html.match(/<div class="rp-note">/g)!.length).toBe(3)
  })
})

describe('signature chart and sources', () => {
  test('the document never names where the data came from', () => {
    const html = doc(FULL)
    for (const src of ['orginfo', 'chamber.uz', 'sud.uz', 'billing.sud', 'Manba']) expect(html).not.toContain(src)
  })
  test('verdict wheel: one arc per non-empty outcome, lit ticks = win rate / 2%', () => {
    const html = doc(FULL)
    const svg = html.match(/<svg class="rp-wheel"[\s\S]*?<\/svg>/)![0]
    const live = ['win', 'lose', 'inProgress', 'neutral'].filter((k) => FULL_MODEL.cases![k as 'win' | 'lose' | 'inProgress' | 'neutral'] > 0).length
    expect((svg.match(/stroke-linecap="round" stroke-dasharray/g) ?? []).length).toBe(live)
    const lit = (svg.match(new RegExp(`stroke="${reportTheme(false).tone.pos.fg}" stroke-width="2.2"`, 'g')) ?? []).length
    expect(lit).toBe(Math.round((FULL_MODEL.cases!.winRate / 100) * 50))
  })
  test('outcome colors are distinct and each outcome keeps one color across both themes', () => {
    for (const dark of [false, true]) {
      const { tone } = reportTheme(dark)
      expect(new Set([tone.pos.fg, tone.neg.fg, tone.info.fg, tone.neu.fg]).size).toBe(4)
    }
  })
})

describe('safety', () => {
  test('company data is HTML-escaped (a name cannot inject markup)', () => {
    const evil = buildReportModel({ ...FULL, info: { ...FULL.info!, company: { ...FULL.info!.company!, officialName: '<img src=x onerror=alert(1)> & "Co"', director: '<script>alert(2)</script>' } } })
    const html = buildReportDoc(evil)
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Co&quot;')
  })
})

describe('document shell', () => {
  test('the title (the proposed PDF file name) carries the STIR and the date', () => {
    expect(doc(FULL)).toContain('<title>Kompaniya hisoboti 302121267 29.09.2026</title>')
  })
  test('header and footer sit in thead / tfoot so they repeat on every printed page', () => {
    const html = doc(FULL)
    expect(html).toMatch(/<thead>[\s\S]*Kompaniya hisoboti[\s\S]*<\/thead>/)
    expect(html).toMatch(/<tfoot>[\s\S]*Hisobot tuzilgan[\s\S]*<\/tfoot>/)
  })
  test('the page margin band is painted in the page colour (it stays white otherwise — a bright strip in dark mode)', () => {
    for (const dark of [false, true]) {
      expect(doc(FULL, dark)).toContain(`background: ${reportTheme(dark).bg}; @bottom-right`)
    }
  })
  test('dark and light use different palettes', () => {
    expect(doc(FULL, true)).toContain('data-theme="dark"')
    expect(doc(FULL, false)).toContain('data-theme="light"')
    expect(doc(FULL, true)).not.toBe(doc(FULL, false))
  })
  test('the win rate is not coloured (a good/bad threshold would be an editorial judgement)', () => {
    const html = doc(FULL)
    const tile = html.match(/Yutuq darajasi<\/div><div class="v"([^>]*)>/)!
    expect(tile[1]).toBe('')
  })
  test('the app\'s fonts are used first, with a system fallback', () => {
    const html = buildReportDoc(buildReportModel(FULL), { fontFamily: '"__Plus_Jakarta_Sans_abc"', fontMono: '"__IBM_Plex_Mono_xyz"' })
    expect(html).toContain('font-family: "__Plus_Jakarta_Sans_abc", "Plus Jakarta Sans"')
    expect(html).toContain('font-family: "__IBM_Plex_Mono_xyz", "IBM Plex Mono"')
  })
})

describe('fontKitFromRules', () => {
  const rules = [
    { family: '"__Plus_Jakarta_Sans_abc"', cssText: '@font-face { font-family: "__Plus_Jakarta_Sans_abc"; src: url(/_next/static/media/jk.woff2) format("woff2"); unicode-range: U+0000-00FF; }' },
    { family: '__Plus_Jakarta_Sans_abc', cssText: '@font-face { font-family: __Plus_Jakarta_Sans_abc; src: url("/_next/static/media/jk2.woff2"); }' },
    { family: '"__IBM_Plex_Mono_xyz"', cssText: '@font-face { font-family: "__IBM_Plex_Mono_xyz"; src: url(data:font/woff2;base64,AAAA); }' },
    { family: 'Geist', cssText: '@font-face { font-family: Geist; src: url(/g.woff2); }' },
  ]
  const kit = fontKitFromRules(rules, 'http://localhost:3000/some/page')
  test('keeps only the app\'s two typefaces', () => {
    expect(kit.css).not.toContain('Geist')
    expect(kit.css.match(/@font-face/g)).toHaveLength(3)
  })
  test('makes relative URLs absolute (the print window is a different document) and leaves data: URLs alone', () => {
    expect(kit.css).toContain('url("http://localhost:3000/_next/static/media/jk.woff2")')
    expect(kit.css).toContain('url("http://localhost:3000/_next/static/media/jk2.woff2")')
    expect(kit.css).toContain('url(data:font/woff2;base64,AAAA)')
  })
  test('returns each family once, quoted, split into sans and mono', () => {
    expect(kit.sans).toBe('"__Plus_Jakarta_Sans_abc"')
    expect(kit.mono).toBe('"__IBM_Plex_Mono_xyz"')
  })
  test('relative URLs resolve against the STYLESHEET (dev: ../media/x), not the page — the 404 that hung printing', () => {
    const dev = fontKitFromRules(
      [{ family: '"Plus Jakarta Sans"', cssText: '@font-face { font-family: "Plus Jakarta Sans"; src: url(../media/fba5-s.p.woff2) format("woff2"); }', base: 'http://localhost:3000/_next/static/chunks/src_app_globals.css' }],
      'http://localhost:3000/',
    )
    expect(dev.css).toContain('url("http://localhost:3000/_next/static/media/fba5-s.p.woff2")')
    expect(dev.css).not.toContain('localhost:3000/media/') // what resolving against the page produced
  })
  test('no rules → empty kit (the report falls back to system fonts)', () => {
    expect(fontKitFromRules([], 'http://x/')).toEqual({ css: '', sans: '', mono: '' })
  })
})
