import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markInstalled, needsInstall, warmUp } from '../../../scripts/boot-helpers.mjs'

const dirs: string[] = []
function project(deps = '{"name":"x"}', lock = 'lock-1') {
  const d = mkdtempSync(join(tmpdir(), 'boot-'))
  dirs.push(d)
  mkdirSync(join(d, 'node_modules', 'next'), { recursive: true })
  writeFileSync(join(d, 'node_modules', 'next', 'package.json'), '{}')
  writeFileSync(join(d, 'package.json'), deps)
  writeFileSync(join(d, 'bun.lock'), lock)
  return d
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('needsInstall', () => {
  test('first start (no stamp) installs, then a second start does not', () => {
    const d = project()
    expect(needsInstall(d)).toBe(true)
    markInstalled(d)
    expect(needsInstall(d)).toBe(false)
  })
  test('a changed lockfile or package.json installs again', () => {
    const d = project()
    markInstalled(d)
    writeFileSync(join(d, 'bun.lock'), 'lock-2')
    expect(needsInstall(d)).toBe(true)
    markInstalled(d)
    writeFileSync(join(d, 'package.json'), '{"name":"y"}')
    expect(needsInstall(d)).toBe(true)
  })
  test('missing node_modules always installs, even with a stamp', () => {
    const d = project()
    markInstalled(d)
    rmSync(join(d, 'node_modules', 'next'), { recursive: true })
    expect(needsInstall(d)).toBe(true)
  })
})

describe('warmUp', () => {
  test('requests the page first, then only local API paths', async () => {
    const seen: string[] = []
    const secs = await warmUp({ port: 1, alive: () => true, get: async (_p: number, path: string) => { seen.push(path); return 200 } })
    expect(seen).toEqual(['/', '/api/settings/health', '/api/public-orders/status'])
    expect(typeof secs).toBe('number')
  })
  test('never touches a scraping route', async () => {
    const seen: string[] = []
    await warmUp({ port: 1, alive: () => true, get: async (_p: number, path: string) => { seen.push(path); return 200 } })
    for (const p of seen) expect(p).not.toMatch(/stats|company|court|billing|hearings|rating/)
  })
  test('stops when the server it belongs to was replaced', async () => {
    let alive = true
    const seen: string[] = []
    const r = await warmUp({ port: 1, alive: () => alive, get: async (_p: number, path: string) => { seen.push(path); alive = false; return 200 } })
    expect(r).toBeNull()
    expect(seen).toEqual(['/'])
  })
  test('waits for the server to start listening, then compiles the page', async () => {
    const seen: string[] = []
    let refused = 3
    const secs = await warmUp({
      port: 1,
      alive: () => true,
      wait: async () => {},
      get: async (_p: number, path: string) => { seen.push(path); return path === '/' && refused-- > 0 ? 0 : 200 },
    })
    expect(seen.slice(0, 5)).toEqual(['/', '/', '/', '/', '/api/settings/health'])
    expect(secs).not.toBeNull()
  })
  test('gives up after maxWaitMs when the page never answers', async () => {
    let t = 0
    const r = await warmUp({ port: 1, alive: () => true, now: () => t, wait: async () => { t += 60_000 }, maxWaitMs: 120_000, get: async () => 0 })
    expect(r).toBeNull()
  })
})
