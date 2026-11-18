import { describe, expect, test } from 'bun:test'
import { MOTION_BOOT_SCRIPT, MOTION_KEY } from '../theme-boot'
import { parseMotion } from '../motion'

describe('motion setting', () => {
  test('only «on» and «off» are real choices; anything else is auto', () => {
    expect(parseMotion('on')).toBe('on')
    expect(parseMotion('off')).toBe('off')
    for (const x of [null, undefined, '', 'auto', 'yes', 1, {}]) expect(parseMotion(x)).toBe('auto')
  })
  const run = (stored: Record<string, string>) => {
    const attrs: Record<string, string> = {}
    new Function('document', 'localStorage', MOTION_BOOT_SCRIPT)({ documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } }, { getItem: (k: string) => stored[k] ?? null })
    return attrs
  }
  test('the boot script puts «on» / «off» on <html> before the first paint, and nothing for auto or junk', () => {
    expect(MOTION_BOOT_SCRIPT).toContain(`'${MOTION_KEY}'`)
    expect(run({ [MOTION_KEY]: 'on' })).toEqual({ 'data-motion': 'on' })
    expect(run({ [MOTION_KEY]: 'off' })).toEqual({ 'data-motion': 'off' })
    expect(run({})).toEqual({})
    expect(run({ [MOTION_KEY]: 'weird' })).toEqual({})
  })
  test('blocked storage is swallowed', () => {
    expect(() => new Function('document', 'localStorage', MOTION_BOOT_SCRIPT)({ documentElement: { setAttribute() {} } }, { getItem: () => { throw new Error('blocked') } })).not.toThrow()
  })
})
