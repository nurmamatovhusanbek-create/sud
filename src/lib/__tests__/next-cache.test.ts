import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanDevCache, isNextDirConflict, nextDirHelp } from '../../../scripts/next-cache.mjs'

const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'sud-next-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('isNextDirConflict', () => {
  test('the exact Windows crash line', () => {
    expect(isNextDirConflict("Error: EEXIST: file already exists, mkdir 'C:\\Users\\User\\Desktop\\sud\\.next\\dev'")).toBe(true)
  })
  test('the same on Unix, and inside a larger chunk of output', () => {
    expect(isNextDirConflict("ready\nError: EEXIST: file already exists, mkdir '/home/u/sud/.next/dev'\n  at mkdirSync")).toBe(true)
  })
  test('other EEXIST errors and other errors are not ours', () => {
    expect(isNextDirConflict("Error: EEXIST: file already exists, mkdir '/home/u/sud/uploads'")).toBe(false)
    expect(isNextDirConflict('EADDRINUSE: address already in use :::3000')).toBe(false)
    expect(isNextDirConflict('')).toBe(false)
  })
})

describe('cleanDevCache', () => {
  test('removes .next/dev and leaves the rest of .next (the standalone build is the app) alone', () => {
    const root = tmp()
    mkdirSync(join(root, '.next', 'dev', 'cache'), { recursive: true })
    mkdirSync(join(root, '.next', 'standalone'), { recursive: true })
    writeFileSync(join(root, '.next', 'dev', 'cache', 'x'), '1')
    writeFileSync(join(root, '.next', 'standalone', 'server.js'), '1')
    const r = cleanDevCache(root)
    expect(r.error).toBeUndefined()
    expect(existsSync(join(root, '.next', 'dev'))).toBe(false)
    expect(existsSync(join(root, '.next', 'standalone', 'server.js'))).toBe(true)
  })
  test('a missing .next is fine (nothing to clean is not a failure)', () => {
    expect(cleanDevCache(tmp()).error).toBeUndefined()
  })
  test('the help text names the folder and the real cause', () => {
    const t = nextDirHelp('C:\\Users\\User\\Desktop\\sud', 'busy')
    expect(t).toContain('OneDrive')
    expect(t).toContain('C:\\Users\\User\\Desktop\\sud')
    expect(t).toContain('busy')
  })
})
