import { describe, expect, test } from 'bun:test'
import { parseTheme } from '../theme'
import { UI_BOOT_SCRIPT } from '@/core/ui-version'

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
    new Function('document', 'localStorage', UI_BOOT_SCRIPT)({ documentElement: html }, { getItem: (k: string) => stored[k] ?? null })
    return { attrs, style: html.style }
  }
  test('puts the saved theme and look on <html> before the first paint', () => {
    const r = run({ theme: 'dark', 'sud-ui': 'green' })
    expect(r.attrs['data-theme']).toBe('dark')
    expect(r.style.colorScheme).toBe('dark')
    expect(r.attrs['data-ui']).toBe('green')
  })
  test('nothing saved: light and the default look', () => {
    const r = run({})
    expect(r.attrs['data-theme']).toBe('light')
    expect(r.attrs['data-ui']).toBe('new')
  })
  test('blocked storage (private mode) is swallowed, not thrown', () => {
    const attrs: Record<string, string> = {}
    new Function('document', 'localStorage', UI_BOOT_SCRIPT)({ documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v), style: {} } }, { getItem: () => { throw new Error('blocked') } })
    // storage blocked: no throw, and the server-rendered defaults on <html> stay as they are
    expect(attrs).toEqual({})
  })
})
