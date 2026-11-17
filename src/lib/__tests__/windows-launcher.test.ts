import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The Windows launchers cannot run here, so guard the things that silently break them on Windows. */
const root = join(import.meta.dir, '..', '..', '..')
const files = ['Sud.bat', 'Sud-toxtat.bat', 'Sud-yorliq.bat']

describe('Windows launchers', () => {
  for (const f of files) {
    const text = readFileSync(join(root, f), 'utf8')
    test(`${f}: CRLF line endings only`, () => {
      expect(text).toContain('\r\n')
      expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    })
    test(`${f}: plain ASCII (cmd.exe garbles anything else)`, () => {
      expect(text).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/)
    })
  }
  test('Sud.bat starts from its own folder, checks bun/node, waits for the page and opens it', () => {
    const t = readFileSync(join(root, 'Sud.bat'), 'utf8')
    expect(t).toContain('cd /d "%~dp0"')
    expect(t).toContain('where bun') // the plain-cmd fallback
    expect(t).toContain('where node')
    expect(t).toContain('bash.exe') // Git Bash first: it is where bun and node are on PATH
    expect(t).toContain('CHERE_INVOKING=1') // or the login shell leaves this folder
    expect(t).toContain('bun run dev')
    expect(t).toContain('start "" "%URL%"')
    expect(t).toContain('127.0.0.1') // never a LAN address
  })
  test('Sud-toxtat.bat kills the supervisor before the window and the port listener', () => {
    const t = readFileSync(join(root, 'Sud-toxtat.bat'), 'utf8')
    const sup = t.indexOf('supervisor.mjs')
    expect(sup).toBeGreaterThan(-1)
    expect(sup).toBeLessThan(t.indexOf('LISTENING'))
    expect(t).toContain('$PID') // the PowerShell line must not kill itself (its own command line names supervisor.mjs)
  })
  test('Sud-yorliq.bat makes a shortcut that runs Sud.bat with an icon that exists', () => {
    const t = readFileSync(join(root, 'Sud-yorliq.bat'), 'utf8')
    expect(t).toContain('/c Sud.bat')
    expect(t).toContain('scripts\\sud.ico')
    expect(readFileSync(join(root, 'scripts', 'sud.ico')).subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]))
  })
})
