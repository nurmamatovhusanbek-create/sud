import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import postcss, { type AtRule, type Declaration, type Rule } from 'postcss'
import { thumbVars } from '../use-thumb'

/**
 * Guard for app/motion-premium.css (the black edition's motion). The rules come from the unslop guide §9 and AGENTS.md: only
 * compositor-friendly properties, named transitions, tokens for easing and time, nothing loops except what is live, no blur, and the
 * whole layer is switched off by «Animatsiya: off» and by reduced motion (auto). A new animation that breaks one of these fails here.
 */
const CSS = readFileSync(new URL('../../app/motion-premium.css', import.meta.url), 'utf8')
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '') // comments may name what is forbidden
const root = postcss.parse(CSS)

const KEYFRAME_OK = new Set(['opacity', 'transform', 'clip-path'])
const TRANSITION_OK = new Set(['transform', 'opacity', 'background-color', 'border-color', 'color', 'visibility', 'clip-path'])

const decls: { rule: Rule; decl: Declaration }[] = []
root.walkRules((rule) => rule.walkDecls((decl) => void decls.push({ rule, decl })))
const inKeyframes = (d: Declaration) => d.parent?.parent?.type === 'atrule' && (d.parent.parent as AtRule).name === 'keyframes'

describe('motion-premium.css', () => {
  test('keyframes animate only transform, opacity and clip-path', () => {
    const frames: string[] = []
    root.walkAtRules('keyframes', (k) => k.walkDecls((d) => void frames.push(d.prop)))
    expect(frames.length).toBeGreaterThan(5)
    for (const p of frames) expect(KEYFRAME_OK.has(p)).toBe(true)
  })

  test('transitions name their properties (never all) and never touch layout', () => {
    for (const { decl } of decls) {
      if (decl.prop === 'transition' || decl.prop === 'transition-property') {
        for (const part of decl.value.split(/,(?![^(]*\))/)) {
          const name = part.trim().split(/\s+/)[0]
          if (name === 'none') continue
          expect(TRANSITION_OK.has(name)).toBe(true)
        }
      }
    }
  })

  test('no blur, no backdrop-filter, no glow animation, no literal easing curve (the tokens only), no layout property in a keyframe', () => {
    expect(CODE).not.toMatch(/backdrop-filter|blur\(|drop-shadow\(/)
    expect(CODE).not.toMatch(/cubic-bezier\(/)
    expect(CODE).not.toMatch(/animation[^;]*bounce|spring/i)
  })

  test('every animation and transition uses the duration and easing tokens or a plain ms literal with a token easing', () => {
    for (const { decl } of decls) {
      if (inKeyframes(decl)) continue
      if ((decl.prop === 'animation' || decl.prop === 'transition') && decl.value !== 'none') {
        expect(decl.value).toMatch(/var\(--ease-(emphasized|standard)\)/)
      }
    }
  })

  test('only live things loop: the loading shimmer and the loading bar\'s sweep, and nothing else', () => {
    const loops = decls.filter(({ decl }) => decl.prop === 'animation' && /infinite/.test(decl.value)).map(({ rule }) => rule.selector)
    expect(loops).toEqual(["[data-look='premium'] .sk::after", "[data-look='premium'] .stream-fill::after"])
  })

  test('every rule of the layer is scoped to the premium look', () => {
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && ((rule.parent as AtRule).name === 'keyframes')) return
      for (const sel of rule.selectors) expect(sel.includes("[data-look='premium']")).toBe(true)
    })
  })

  test('gate: «off» and «auto + reduced motion» switch everything off; «on» overrides the system', () => {
    const gates = decls.filter(({ decl }) => decl.prop === 'animation' && decl.value === 'none' && decl.important)
    expect(gates).toHaveLength(2)
    const sels = gates.map(({ rule }) => rule.selector)
    expect(sels.some((s) => s.includes("[data-motion='off']"))).toBe(true)
    const reduce = gates.find(({ rule }) => (rule.parent as AtRule).name === 'media')!
    expect((reduce.rule.parent as AtRule).params).toBe('(prefers-reduced-motion: reduce)')
    expect(reduce.rule.selector).toContain(":not([data-motion='on'])")
    // spinners keep turning (feedback), everything else stops
    for (const s of sels) expect(s).toContain(':not(.spinner)')
  })

  test('entrances end in the natural state (a `backwards` fill, never `both`/`forwards`), so nothing stays hidden when motion is off', () => {
    for (const { decl, rule } of decls) {
      if (decl.prop !== 'animation' || /none/.test(decl.value) || /infinite/.test(decl.value)) continue
      if (/pm-(rise|slide|grow|wipe|nudge|tick)/.test(decl.value)) expect(decl.value).toMatch(/backwards/)
      expect(decl.value).not.toMatch(/\b(both|forwards)\b/)
      void rule
    }
  })

  test('the sliding indicators move with transform only', () => {
    const thumbs = decls.filter(({ rule, decl }) => /\.thumb\b/.test(rule.selector) && decl.prop === 'transition')
    expect(thumbs.length).toBeGreaterThanOrEqual(2) // the nav, and the tabs + segment
    for (const { decl } of thumbs) expect(decl.value).toMatch(/^transform /)
  })
})

describe('thumbVars', () => {
  test('unitless custom properties (the stylesheet adds px / divides), nothing when there is no active item', () => {
    expect(thumbVars(null)).toEqual({})
    expect(thumbVars({ x: 10, y: 20, w: 30, h: 40 })).toEqual({ '--tx': 10, '--ty': 20, '--tw': 30, '--th': 40 } as never)
  })
})
