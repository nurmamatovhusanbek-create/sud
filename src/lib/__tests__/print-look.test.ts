import { describe, expect, test } from 'bun:test'
import { buildPrintDoc, currentLook, palette } from '../print'

const BODY = '<div class="pr-head"><div><div class="pr-eyebrow">Ish</div><div class="pr-title">4-1001-2609/04</div></div></div><div class="pr-sec">Umumiy</div><div class="pr-kv"><span class="k">Sud</span><span class="v">Toshkent</span></div>'

describe('generic print sheet follows the look', () => {
  test('no DOM (tests, server): the original navy sheet; the premium sheet is asked for', () => {
    expect(currentLook()).toBe('navy')
    const navy = buildPrintDoc('t', BODY, false)
    expect(navy).toContain('data-look="navy"')
    expect(navy).toContain('--pa:#1a2350')
  })

  test('premium: one ink, no navy / indigo, Plex type, sentence-case labels', () => {
    for (const dark of [false, true]) {
      const html = buildPrintDoc('t', BODY, dark, 'premium')
      expect(html).toContain('data-look="premium"')
      for (const hue of ['#1a2350', '#3b5bdb', '#6d84ec', '#aab3d8', '#2f8f5b', '#c04a68']) expect(html.toLowerCase()).not.toContain(hue)
      expect(html).toContain('"IBM Plex Sans"')
      expect(html).toMatch(/\.pr-sec \{ text-transform: none/)
      const p = palette(dark, 'premium')
      // every colour of the palette is a near-neutral grey
      for (const c of [p.t1, p.t2, p.t3, p.surface, p.inset, p.accent]) {
        const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c)!
        expect(Math.abs(parseInt(m[1], 16) - parseInt(m[3], 16))).toBeLessThanOrEqual(8)
      }
    }
  })

  test('the web-font rules of the app are carried into the sheet', () => {
    expect(buildPrintDoc('t', BODY, false, 'premium', '@font-face{font-family:X}')).toContain('<style>@font-face{font-family:X}')
  })

  test('the title is still escaped', () => {
    expect(buildPrintDoc('</title><script>x</script>', BODY, false, 'premium')).not.toContain('<script>x')
  })
})
