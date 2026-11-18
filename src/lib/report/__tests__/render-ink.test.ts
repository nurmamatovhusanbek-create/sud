import { describe, expect, test } from 'bun:test'
import { buildReportDoc } from '../doc'
import { buildReportModel, type ReportInput } from '../model'
import { inkTheme } from '../render-ink'
import { FULL, NOW } from './fixtures'

/** the «premium» edition: the app's two-colour identity. The «calm» edition (navy Dossier) is covered by render.test.ts. */
const M = buildReportModel(FULL)
const ink = (input: ReportInput = FULL, dark = false) => buildReportDoc(buildReportModel(input), { dark, look: 'premium' })
const NOTHING: ReportInput = { stir: '309922239', generatedAt: NOW, info: null, stats: null, cases: null, hearings: null, bills: null }

describe('premium edition', () => {
  for (const dark of [false, true]) {
    test(`renders cleanly (${dark ? 'dark' : 'light'}) for full and empty data`, () => {
      for (const input of [FULL, NOTHING]) expect(ink(input, dark)).not.toMatch(/undefined|NaN|\[object|Infinity/)
    })
  }

  test('the look picks the edition; the default stays the original navy one', () => {
    const calm = buildReportDoc(M, {})
    const premium = buildReportDoc(M, { look: 'premium' })
    expect(calm).toContain('<svg class="rp-gauge"')
    expect(calm).toContain('<svg class="rp-pie"')
    expect(buildReportDoc(M, { look: 'calm' })).toBe(calm)
    expect(premium).not.toContain('rp-gauge')
    expect(premium).not.toContain('<svg class="rp-pie"')
    expect(premium).toContain('<svg class="rp-ruler"')
  })

  test('one ink, no hue: none of the navy edition\'s colours is painted', () => {
    for (const dark of [false, true]) {
      const html = ink(FULL, dark)
      for (const hue of ['#0f9d8f', '#d8443c', '#b7791f', '#4c5fd5', '#141b47', '#232b63', '#34d3b4', '#ff8077', '#1a2350']) expect(html.toLowerCase()).not.toContain(hue)
      // every colour the theme itself defines is a near-neutral grey (the app's graphite ramp is faintly cool: channels within 8)
      const t = inkTheme(dark)
      for (const c of [t.t1, t.t2, t.t3, t.rail.bg, t.surface, t.inset, ...t.ramp]) {
        const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c)!
        expect(Math.abs(parseInt(m[1], 16) - parseInt(m[3], 16))).toBeLessThanOrEqual(8)
      }
    }
  })

  test('the outcome board: the strip and the four stat columns reconcile with the cases', () => {
    const c = M.cases!
    const html = ink()
    expect(html).toContain(`<b>${c.winRate}%</b>`)
    expect(html).toContain(`${c.win + c.lose} ta hal qilingan ishdan`)
    const stats = [...html.matchAll(/<div class="rp-stat[^"]*"><div class="h">.*?<\/i>(Yutgan|Yutqazgan|Neytral|Jarayonda)<\/div><b class="m">(\d+)<\/b>/g)]
    expect(stats.map((s) => s[1])).toEqual(['Yutgan', 'Yutqazgan', 'Neytral', 'Jarayonda'])
    expect(stats.reduce((n, s) => n + Number(s[2]), 0)).toBe(c.total)
    expect(html).toContain('Turkum boʻyicha')
    // one tile per court type, each with its own total
    const tiles = html.match(/<div class="rp-tile">/g)!.length
    expect(tiles).toBe(c.pie.length + c.pieTurkum.length)
  })

  test('the outcomes are told apart by fill, never by colour (the four classes exist and carry no hue)', () => {
    const css = ink().match(/<style>([\s\S]*?)<\/style>/)![1]
    for (const st of ['won', 'lost', 'neutral', 'pending']) expect(css).toContain(`.rp-st.${st}`)
    expect(css).toMatch(/\.rp-st\.neutral \{[^}]*repeating-linear-gradient/)
    expect(css).toMatch(/\.rp-st\.pending \{[^}]*dashed/)
  })

  test('the rating is a number over a 51-tick ruler lit up to the score', () => {
    const html = ink()
    const score = M.rating!.score!
    const svg = html.match(/<svg class="rp-ruler"[\s\S]*?<\/svg>/)![0]
    const strokes = [...svg.matchAll(/<line [^>]*stroke="([^"]+)"/g)].map((x) => x[1])
    expect(strokes).toHaveLength(51)
    expect(strokes.filter((s) => !s.startsWith('rgba')).length).toBe(Math.floor(score / 2) + 1)
    expect(html).toContain(`<div class="rp-rate-n m">${Math.round(score)}</div>`)
    expect(html.indexOf('rp-rate-n')).toBeLessThan(html.indexOf('<table class="rp">')) // the rating sits in the masthead
  })

  test('hearings use the calendar leaf: month, day, and an inverted leaf when within 7 days', () => {
    const html = ink()
    expect(html).toMatch(/<span class="rp-leaf( near)?"><i>[A-Z][a-z]{2}<\/i><b>\d{2}<\/b><\/span>/)
    const near = buildReportModel({ ...FULL, hearings: [{ ...(FULL.hearings![0] as object), isoDate: '2026-10-01', hearingDate: '01.10.2026' } as never] })
    expect(buildReportDoc(near, { look: 'premium' })).toContain('rp-leaf near')
  })

  test('typography: nothing heavier than 600, sentence-case labels (no tracked all-caps)', () => {
    const css = ink().match(/<style>([\s\S]*?)<\/style>/)![1]
    expect(css).not.toMatch(/font(-weight)?:[^;}]*\b[789]00\b/)
    expect(css).not.toContain('text-transform: uppercase')
  })

  test('IBM Plex Sans leads the stack, Plus Jakarta Sans stays behind it for the glyphs Plex lacks', () => {
    const html = buildReportDoc(M, { look: 'premium', fontPlexSans: '"IBM Plex Sans"', fontFamily: '"Plus Jakarta Sans"' })
    expect(html).toContain('font-family: "IBM Plex Sans", "Plus Jakarta Sans", "IBM Plex Sans", "Plus Jakarta Sans"')
  })

  test('the paper is the page colour in both themes (it stays white otherwise: a bright strip in dark mode)', () => {
    for (const dark of [false, true]) {
      const t = inkTheme(dark)
      expect(ink(FULL, dark)).toContain(`@page { size: A4; margin: 0 0 12mm; background: ${t.surface};`)
    }
  })

  test('structure: masthead first, then the verdict, the board beside «Diqqat», then months, the case table, and the facts LAST', () => {
    const html = ink()
    const order = ['class="rp-mast"', '>Xulosa<', '>Taqsimot<', '>Diqqat<', '>Oylik faollik<', '>Natijalar<', 'class="rp-ct"', '>Kompaniya maʼlumotlari<'].map((k) => html.indexOf(k))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // no left rail any more: the masthead is OUTSIDE the table, the facts are inside the analysis, after the cases
    expect(html.indexOf('class="rp-mast"')).toBeLessThan(html.indexOf('<table class="rp">'))
    expect(html).not.toContain('rp-rail')
    expect(html).not.toContain('class="rp-bg"')
    expect(html.indexOf('>Asosiy maʼlumot<')).toBeGreaterThan(html.indexOf('class="rp-ct"'))
  })

  test('«Diqqat» holds the hearings and the payments; the latest cases are a table with columns', () => {
    const html = ink()
    const att = html.match(/<aside class="rp-col rp-att">[\s\S]*?<\/aside>/)![0]
    expect(att).toContain('Yaqin majlislar')
    expect(att).toContain('Toʻlovlar')
    expect(att).toContain('rp-leaf')
    const head = [...html.match(/<table class="rp-ct"><thead><tr>([\s\S]*?)<\/tr>/)![1].matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((x) => x[1])
    expect(head).toEqual(['Holat', 'Tomon', 'Rol', 'Ish raqami', 'Sana', 'Summa'])
    expect((html.match(/<td class="p">/g) ?? []).length).toBe(M.cases!.latest.length)
  })

  test('no hearings and no bills: the board takes the whole row, no empty «Diqqat» column', () => {
    const html = ink({ ...FULL, hearings: null, bills: null })
    expect(html).not.toContain('<aside')
    expect(html).toContain('rp-2 rp-block one')
  })

  test('company text is escaped here too', () => {
    const evil = buildReportModel({ ...FULL, info: { ...FULL.info!, company: { ...FULL.info!.company!, officialName: '<img src=x onerror=alert(1)> "Co"', director: '<script>alert(2)</script>' } } })
    const html = buildReportDoc(evil, { look: 'premium' })
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert')
  })

  test('running header on pages 2+: escaped text, fixed in print AFTER its base rule, covered on page 1 by the opaque masthead', () => {
    const html = ink()
    const head = html.match(/<div class="rp-runhead">[\s\S]*?<\/div>/)![0]
    expect(head).toContain('PROCAB')
    expect(head).toContain(`STIR ${M.stir}`)
    const css = html.match(/<style>([\s\S]*?)<\/style>/)![1]
    // the print rule must come after the base `position: absolute` rule, or the header never repeats (the bug this guards)
    expect(css.indexOf('.rp-runhead { position: absolute')).toBeGreaterThan(-1)
    expect(css.indexOf('@media print { .rp-runhead { position: fixed; } }')).toBeGreaterThan(css.indexOf('.rp-runhead { position: absolute'))
    expect(css).toMatch(/\.rp-mast \{[^}]*position: relative; z-index: 2/)
    expect(css).toMatch(/\.rp-runhead \{[^}]*z-index: 1/)
    // the header sits BEFORE the masthead in the document (so the masthead paints over it on page 1)
    expect(html.indexOf('class="rp-runhead"')).toBeLessThan(html.indexOf('class="rp-mast"'))
  })

  test('the running header never puts company data into a CSS string or markup', () => {
    const evil = buildReportModel({ ...FULL, info: { ...FULL.info!, company: { ...FULL.info!.company!, officialName: '</style><script>alert(1)</script> "x" \\ \n' } } })
    const html = buildReportDoc(evil, { look: 'premium' })
    expect(html).not.toContain('<script>alert')
    expect(html.match(/<\/style>/g)).toHaveLength(1)
  })
})
