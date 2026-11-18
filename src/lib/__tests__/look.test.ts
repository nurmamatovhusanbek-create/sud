import { describe, expect, test } from 'bun:test'
import { LOOK_BOOT_SCRIPT, LOOK_KEY } from '../theme-boot'
import { parseLook } from '../look'

describe('look setting', () => {
  test('only «calm» is the calm look; anything else is vivid', () => {
    expect(parseLook('calm')).toBe('calm')
    for (const x of ['vivid', '', null, undefined, 'dark', 1, {}]) expect(parseLook(x)).toBe('vivid')
  })
  const run = (stored: Record<string, string>, throws = false) => {
    const attrs: Record<string, string> = {}
    new Function('document', 'localStorage', LOOK_BOOT_SCRIPT)(
      { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
      { getItem: (k: string) => { if (throws) throw new Error('blocked'); return stored[k] ?? null } },
    )
    return attrs
  }
  test('the boot script always sets data-look before the first paint', () => {
    expect(LOOK_BOOT_SCRIPT).toContain(`'${LOOK_KEY}'`)
    expect(run({})).toEqual({ 'data-look': 'vivid' })
    expect(run({ [LOOK_KEY]: 'calm' })).toEqual({ 'data-look': 'calm' })
    expect(run({ [LOOK_KEY]: 'junk' })).toEqual({ 'data-look': 'vivid' })
  })
  test('blocked storage still gives the default look', () => {
    expect(run({}, true)).toEqual({ 'data-look': 'vivid' })
  })
})
