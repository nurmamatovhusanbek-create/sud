import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The Windows launchers cannot run here, so guard the things that silently break them on Windows. */
const root = join(import.meta.dir, '..', '..', '..')
const files = ['Sud.bat']

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
    // the browser opens «localhost»: the registry (watchlist) is saved per origin, so 127.0.0.1 would show an empty app
    expect(t).toContain('set "OPENURL=http://localhost:3000"')
    expect(t).toContain('start "" "%OPENURL%"')
    expect(t).not.toMatch(/start "" "%URL%"/)
    expect(t).toContain('127.0.0.1') // the checks stay on loopback, never a LAN address
  })
  test('stop kills the supervisor before the window and the port listener, and never itself', () => {
    const t = readFileSync(join(root, 'Sud.bat'), 'utf8')
    const stop = t.slice(t.indexOf(':stop\r\n'))
    const sup = stop.indexOf('supervisor.mjs')
    expect(sup).toBeGreaterThan(-1)
    expect(sup).toBeLessThan(stop.indexOf('LISTENING'))
    expect(stop).toContain('$PID') // the PowerShell line's own command line names supervisor.mjs
  })
  test('one file: arguments and the menu reach stop and shortcut, and the shortcut re-runs Sud.bat with an icon that exists', () => {
    const t = readFileSync(join(root, 'Sud.bat'), 'utf8')
    expect(t).toContain('if /i "%~1"=="stop" goto stop')
    expect(t).toContain('if /i "%~1"=="shortcut" goto shortcut')
    expect(t).toContain('choice /c OSYL')
    // choice sets errorlevel to the 1-based key position and `if errorlevel N` means >= N: test the highest first
    expect(t.indexOf('if errorlevel 4 goto log')).toBeLessThan(t.indexOf('if errorlevel 3 goto shortcut'))
    expect(t.indexOf('if errorlevel 3 goto shortcut')).toBeLessThan(t.indexOf('if errorlevel 2 goto stop'))
    expect(t).toContain('/c Sud.bat')
    expect(t).toContain('scripts\\sud.ico')
    expect(readFileSync(join(root, 'scripts', 'sud.ico')).subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]))
  })
  test('the server runs hidden by default (the visible window is opt-in) and its log is reachable', () => {
    const t = readFileSync(join(root, 'Sud.bat'), 'utf8')
    expect(t).toContain('-WindowStyle Hidden')
    expect(t).toContain('if /i "%~1"=="window" set "SHOWWIN=1"')
    expect(t).toContain('if /i "%~1"=="log" goto log')
    expect(t).toContain('dev.log')
  })
  test('scripts/sud-start.sh has LF endings (bash chokes on CR) and runs the app from the project folder', () => {
    const sh = readFileSync(join(root, 'scripts', 'sud-start.sh'), 'utf8')
    expect(sh).not.toContain('\r')
    expect(sh).toContain('exec bun run dev')
    expect(readFileSync(join(root, 'Sud.bat'), 'utf8')).toContain('scripts/sud-start.sh')
  })
})
