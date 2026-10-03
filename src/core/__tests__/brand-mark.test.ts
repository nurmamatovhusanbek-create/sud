import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { BRAND_PAINT, BRAND_PATHS, FAVICON_SVG, brandMarkSvg } from '../brand-mark'

describe('brand mark «Hukm»', () => {
  test('four wedges, one paint per wedge in every variant', () => {
    expect(BRAND_PATHS).toHaveLength(4)
    for (const v of ['light', 'dark', 'tile'] as const) expect(BRAND_PAINT[v]).toHaveLength(4)
  })
  test('each wedge is a closed path inside the 48 grid with its own (shrinking) outer radius', () => {
    const xs = BRAND_PATHS.map((d) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0])))
    for (const d of BRAND_PATHS) expect(d.endsWith('Z')).toBe(true)
    for (const n of xs.flat()) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(48) }
    const outer = BRAND_PATHS.map((d) => Number(/A(\d+(?:\.\d+)?) /.exec(d)![1]))
    expect(outer).toEqual([22, 18.2, 14.4, 10.6])
  })
  test('the four paints are distinct, and the tile variant steps down in opacity', () => {
    for (const v of ['light', 'dark'] as const) expect(new Set(BRAND_PAINT[v].map((p) => p.fill)).size).toBe(4)
    expect(BRAND_PAINT.tile.map((p) => p.opacity ?? 1)).toEqual([1, 0.82, 0.64, 0.46])
  })
  test('the svg string carries every wedge and sizes only when asked', () => {
    const s = brandMarkSvg('dark', 20)
    expect(s.match(/<path /g)).toHaveLength(4)
    expect(s).toContain('width="20" height="20"')
    expect(brandMarkSvg('light')).not.toContain('width=')
    expect(s).not.toMatch(/NaN|undefined/)
  })
  test('public/logo.svg is exactly the generated favicon (edit core/brand-mark.ts, then rewrite the file)', () => {
    expect(readFileSync(new URL('../../../public/logo.svg', import.meta.url), 'utf8')).toBe(FAVICON_SVG)
  })
})
