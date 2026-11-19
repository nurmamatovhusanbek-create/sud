import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import postcss, { type AtRule, type Rule } from 'postcss'

/**
 * Guard for app/look-navy.css («Moviy», the ORIGINAL look): it is the original stylesheet pair scoped under :root[data-look='navy'], so
 * a rule that escapes the scope would restyle Premium, and a keyframe with an original name would replace a newer one.
 */
const CSS = readFileSync(new URL('../../app/look-navy.css', import.meta.url), 'utf8')
const root = postcss.parse(CSS)

const SCOPE = ":root[data-look='navy']"
const inKeyframes = (r: Rule) => r.parent?.type === 'atrule' && /keyframes$/.test((r.parent as AtRule).name)

describe('look-navy.css', () => {
  test('every selector is scoped to the navy look', () => {
    const bad: string[] = []
    root.walkRules((r) => {
      if (inKeyframes(r)) return
      for (const s of r.selectors) {
        const t = s.trim()
        if (!(t.startsWith(SCOPE) || t.startsWith(`:where(${SCOPE})`))) bad.push(t)
      }
    })
    expect(bad).toEqual([])
  })

  test('keyframes are renamed nv-* so they never replace a newer animation', () => {
    const names: string[] = []
    root.walkAtRules('keyframes', (k) => void names.push(k.params))
    expect(names.length).toBeGreaterThan(3)
    for (const n of names) expect(n.startsWith('nv-')).toBe(true)
  })

  test('the original @layer wrappers are kept (an unlayered copy would outrank Tailwind utilities)', () => {
    const layers: string[] = []
    root.walkAtRules('layer', (l) => void layers.push(l.params))
    expect(layers.sort()).toEqual(['base', 'utilities'])
  })

  test('it carries the original tokens (indigo ramp, navy brand) for both themes', () => {
    expect(CSS).toContain("--ramp-950:  #1A2350")
    expect(CSS).toContain("--brand-600: #3b5bdb")
    expect(CSS).toContain(":root[data-look='navy'][data-theme='dark']")
  })

  test('nothing refers to another look', () => {
    expect(CSS).not.toContain("data-look='premium'")
  })
})
