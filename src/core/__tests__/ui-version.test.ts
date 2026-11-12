import { describe, expect, test } from 'bun:test'
import { DEFAULT_UI, SIDE_MINI_KEY, usesRebuiltScreens, UI_BOOT_SCRIPT, UI_STORAGE_KEY, UI_VERSIONS, parseUiVersion } from '../ui-version'

describe('ui version', () => {
  test('known values pass through', () => {
    expect(parseUiVersion('new')).toBe('new')
    expect(parseUiVersion('classic')).toBe('classic')
    expect(parseUiVersion('green')).toBe('green')
  })

  test('anything else is the default', () => {
    for (const raw of [null, undefined, '', 'old', 'NEW', 'v2', 1, {}]) expect(parseUiVersion(raw)).toBe(DEFAULT_UI)
  })

  test('the default is one of the versions', () => {
    expect(UI_VERSIONS).toContain(DEFAULT_UI)
  })

  /** the inline script and the React side must agree on the keys and on what an unknown value means */
  test('boot script matches the keys and the parser', () => {
    expect(UI_BOOT_SCRIPT).toContain(`'${UI_STORAGE_KEY}'`)
    expect(UI_BOOT_SCRIPT).toContain(`'${SIDE_MINI_KEY}'`)
    const run = (store: Record<string, string>) => {
      const attrs: Record<string, string> = {}
      const document = { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v }, style: {} } }
      const localStorage = { getItem: (k: string) => store[k] ?? null }
      new Function('document', 'localStorage', UI_BOOT_SCRIPT)(document, localStorage)
      return attrs
    }
    // the same script also sets the theme (lib/theme owns the key): light unless it says dark
    const light = { 'data-theme': 'light' }
    expect(run({})).toEqual({ 'data-ui': DEFAULT_UI, ...light })
    expect(run({ [UI_STORAGE_KEY]: 'classic' })).toEqual({ 'data-ui': 'classic', ...light })
    expect(run({ [UI_STORAGE_KEY]: 'green' })).toEqual({ 'data-ui': 'green', ...light })
    expect(run({ [UI_STORAGE_KEY]: 'garbage' })).toEqual({ 'data-ui': parseUiVersion('garbage'), ...light })
    expect(run({ [SIDE_MINI_KEY]: '1' })).toEqual({ 'data-ui': 'new', ...light, 'data-side': 'mini' })
    expect(run({ theme: 'dark' })).toEqual({ 'data-ui': 'new', 'data-theme': 'dark' })
  })

  test('the rebuilt screens belong to every look but the classic one', () => {
    expect(usesRebuiltScreens('new')).toBe(true)
    expect(usesRebuiltScreens('green')).toBe(true)
    expect(usesRebuiltScreens('classic')).toBe(false)
  })

  test('boot script survives blocked storage', () => {
    const document = { documentElement: { setAttribute: () => {}, style: {} } }
    const localStorage = { getItem: () => { throw new Error('denied') } }
    expect(() => new Function('document', 'localStorage', UI_BOOT_SCRIPT)(document, localStorage)).not.toThrow()
  })
})
