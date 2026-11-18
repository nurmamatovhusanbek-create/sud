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

  test('the page band keeps the rail colour and the paper is the page colour, in both themes', () => {
    for (const dark of [false, true]) {
      const t = inkTheme(dark)
      const html = ink(FULL, dark)
      expect(html).toContain(`@page { size: A4; margin: 0 0 9mm; background: ${t.surface};`)
      expect(html).toContain(`@bottom-left { content: ""; width: 66mm; background: ${t.rail.bg}; }`)
    }
  })

  test('company text is escaped here too', () => {
    const evil = buildReportModel({ ...FULL, info: { ...FULL.info!, company: { ...FULL.info!.company!, officialName: '<img src=x onerror=alert(1)> "Co"', director: '<script>alert(2)</script>' } } })
    const html = buildReportDoc(evil, { look: 'premium' })
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert')
  })
})
