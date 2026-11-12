import { describe, expect, test } from 'bun:test'
import { parseTheme } from '../theme'
import { THEME_BOOT_SCRIPT, THEME_KEY } from '../theme-boot'

describe('parseTheme', () => {
  test('only «dark» is dark: junk, «system» (next-themes) and nothing are light', () => {
    expect(parseTheme('dark')).toBe('dark')
    for (const v of ['light', 'system', '', null, undefined, 'DARK', 1]) expect(parseTheme(v)).toBe('light')
  })
})

describe('boot script', () => {
  const run = (stored: Record<string, string>) => {
    const attrs: Record<string, string> = {}
    const html = { setAttribute: (k: string, v: string) => (attrs[k] = v), style: {} as Record<string, string> }
    new Function('document', 'localStorage', THEME_BOOT_SCRIPT)({ documentElement: html }, { getItem: (k: string) => stored[k] ?? null })
    return { attrs, style: html.style }
  }
  test('reads the same key lib/theme writes', () => {
    expect(THEME_BOOT_SCRIPT).toContain(`'${THEME_KEY}'`)
  })
  test('puts the saved theme on <html> before the first paint', () => {
    const r = run({ [THEME_KEY]: 'dark' })
    expect(r.attrs).toEqual({ 'data-theme': 'dark' })
    expect(r.style.colorScheme).toBe('dark')
  })
  test('nothing saved, or something unknown: light', () => {
    expect(run({}).attrs['data-theme']).toBe('light')
    expect(run({ [THEME_KEY]: 'system' }).attrs['data-theme']).toBe('light')
  })
  test('blocked storage (private mode) is swallowed, not thrown; the server-rendered default stays', () => {
    const attrs: Record<string, string> = {}
    expect(() => new Function('document', 'localStorage', THEME_BOOT_SCRIPT)({ documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v), style: {} } }, { getItem: () => { throw new Error('blocked') } })).not.toThrow()
    expect(attrs).toEqual({})
  })
})
