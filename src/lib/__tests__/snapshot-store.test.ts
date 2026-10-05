/**
 * Daily snapshots: what is served without scraping, what is kept, what is thrown away.
 * A temp directory stands in for ~/.sud-tizimi/snapshots; nothing touches the network.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-snap-'))
process.env.SNAPSHOT_DIR = DIR

const { viaSnapshot, readSnapshot, writeSnapshot, dropSnapshot, snapshotDir, __resetSnapshotsForTests } = await import('../snapshot-store')

const DAY = 24 * 60 * 60_000
const TIN = '309922239'
const file = (tin = TIN) => path.join(DIR, `${tin}.json`)

beforeEach(() => {
  __resetSnapshotsForTests()
  fs.rmSync(DIR, { recursive: true, force: true })
})
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }))

const counter = <T>(v: T | Error) => {
  const c = { calls: 0, run: async (): Promise<T> => { c.calls++; if (v instanceof Error) throw v; return v } }
  return c
}

describe('viaSnapshot', () => {
  test('the first call scrapes and stores; the next ones are served from disk with no scrape', async () => {
    const a = counter({ n: 1 })
    const first = await viaSnapshot(TIN, 'stats', {}, a.run)
    expect(first).toMatchObject({ data: { n: 1 }, fromSnapshot: false })
    const second = await viaSnapshot(TIN, 'stats', {}, a.run)
    expect(second).toMatchObject({ data: { n: 1 }, fromSnapshot: true })
    expect(second.fetchedAt).toBe(first.fetchedAt)
    expect(a.calls).toBe(1)
  })

  test('survives a restart (memory dropped, file kept)', async () => {
    await viaSnapshot(TIN, 'info', {}, counter({ name: 'X' }).run)
    __resetSnapshotsForTests()
    const b = counter({ name: 'Y' })
    expect((await viaSnapshot(TIN, 'info', {}, b.run)).data).toEqual({ name: 'X' })
    expect(b.calls).toBe(0)
  })

  test('past its day it is scraped again and replaced', async () => {
    writeSnapshot(TIN, 'stats', { n: 1 }, Date.now() - DAY - 1000)
    const a = counter({ n: 2 })
    const r = await viaSnapshot(TIN, 'stats', {}, a.run)
    expect(r).toMatchObject({ data: { n: 2 }, fromSnapshot: false })
    expect(readSnapshot(TIN, 'stats')?.data).toEqual({ n: 2 })
  })

  test('hard refresh scrapes although the snapshot is fresh, and replaces it', async () => {
    await viaSnapshot(TIN, 'stats', {}, counter({ n: 1 }).run)
    const a = counter({ n: 2 })
    const r = await viaSnapshot(TIN, 'stats', { force: true }, a.run)
    expect(r).toMatchObject({ data: { n: 2 }, fromSnapshot: false })
    expect(a.calls).toBe(1)
    expect(readSnapshot(TIN, 'stats')?.data).toEqual({ n: 2 })
  })

  test('a failed hard refresh throws and keeps the old snapshot', async () => {
    await viaSnapshot(TIN, 'stats', {}, counter({ n: 1 }).run)
    await expect(viaSnapshot(TIN, 'stats', { force: true }, counter<{ n: number }>(new Error('sites down')).run)).rejects.toThrow('sites down')
    expect(readSnapshot(TIN, 'stats')?.data).toEqual({ n: 1 })
  })

  test('past its day and the sites fail: the old data is served, flagged stale', async () => {
    writeSnapshot(TIN, 'stats', { n: 1 }, Date.now() - 2 * DAY)
    const r = await viaSnapshot(TIN, 'stats', {}, counter<{ n: number }>(new Error('sites down')).run)
    expect(r).toMatchObject({ data: { n: 1 }, fromSnapshot: true, stale: true })
  })

  test('nothing stored and the sites fail: the error goes through', async () => {
    await expect(viaSnapshot(TIN, 'stats', {}, counter<{ n: number }>(new Error('sites down')).run)).rejects.toThrow('sites down')
  })

  test('an incomplete answer is returned but not stored, and the old snapshot stays', async () => {
    writeSnapshot(TIN, 'stats', { n: 1, ok: true }, Date.now() - 2 * DAY)
    const r = await viaSnapshot(TIN, 'stats', { storable: (d: { ok: boolean }) => d.ok }, counter({ n: 2, ok: false }).run)
    expect(r.data).toEqual({ n: 2, ok: false })
    expect(readSnapshot(TIN, 'stats')?.data).toEqual({ n: 1, ok: true })
  })

  test('parts are independent and each keeps its own time', async () => {
    writeSnapshot(TIN, 'stats', 's', 1000)
    writeSnapshot(TIN, 'info', 'i', 2000)
    expect(readSnapshot(TIN, 'stats', 3000)?.fetchedAt).toBe(1000)
    expect(readSnapshot(TIN, 'info', 3000)?.fetchedAt).toBe(2000)
    expect(readSnapshot(TIN, 'bills', 3000)).toBeNull()
  })
})

describe('keeping and removing', () => {
  test('a part older than keepMs is not served', () => {
    writeSnapshot(TIN, 'stats', 'old', Date.now() - 8 * DAY, 30 * DAY)
    expect(readSnapshot(TIN, 'stats')).toBeNull()
  })

  test('dropSnapshot with a prefix removes only those parts; without one, the file', () => {
    writeSnapshot(TIN, 'stats', 's')
    writeSnapshot(TIN, 'court:economic', 'e')
    writeSnapshot(TIN, 'court:civil', 'c')
    dropSnapshot(TIN, 'court:')
    expect(readSnapshot(TIN, 'court:economic')).toBeNull()
    expect(readSnapshot(TIN, 'court:civil')).toBeNull()
    expect(readSnapshot(TIN, 'stats')?.data).toBe('s')
    dropSnapshot(TIN)
    expect(fs.existsSync(file())).toBe(false)
    expect(readSnapshot(TIN, 'stats')).toBeNull()
  })

  test('the janitor deletes a file nobody refreshed for keepMs, and leaves fresh ones and strangers', () => {
    writeSnapshot('111111111', 'stats', 'old')
    writeSnapshot('222222222', 'stats', 'new')
    fs.writeFileSync(path.join(DIR, 'notes.txt'), 'keep me')
    const old = Date.now() / 1000 - 9 * 86400
    fs.utimesSync(file('111111111'), old, old)
    __resetSnapshotsForTests() // a new process: sweep runs on its first read
    expect(readSnapshot('222222222', 'stats')?.data).toBe('new')
    expect(fs.existsSync(file('111111111'))).toBe(false)
    expect(fs.existsSync(file('222222222'))).toBe(true)
    expect(fs.existsSync(path.join(DIR, 'notes.txt'))).toBe(true)
  })
})

describe('safety', () => {
  test('only a 9-digit STIR is a file name', () => {
    for (const bad of ['../../etc/passwd', '12345678', '1234567890', 'abc', '']) {
      expect(writeSnapshot(bad, 'stats', 'x')).toBe(false)
      expect(readSnapshot(bad, 'stats')).toBeNull()
    }
    expect(fs.existsSync(DIR) ? fs.readdirSync(DIR) : []).toEqual([])
  })

  test('the file is private and written atomically (no temp file left)', () => {
    writeSnapshot(TIN, 'stats', 'x')
    if (process.platform !== 'win32') expect(fs.statSync(file()).mode & 0o777).toBe(0o600)
    expect(fs.readdirSync(DIR).filter((n) => n.endsWith('.tmp'))).toEqual([])
    expect(snapshotDir()).toBe(DIR)
  })

  test('a damaged or foreign file is ignored and then replaced', async () => {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(file(), '{not json')
    const a = counter({ n: 1 })
    expect((await viaSnapshot(TIN, 'stats', {}, a.run)).fromSnapshot).toBe(false)
    __resetSnapshotsForTests()
    expect(readSnapshot(TIN, 'stats')?.data).toEqual({ n: 1 })
    // a file that claims another company is not trusted
    __resetSnapshotsForTests()
    fs.writeFileSync(file(), JSON.stringify({ v: 1, tin: '999999999', parts: { stats: { t: Date.now(), d: 'evil' } } }))
    expect(readSnapshot(TIN, 'stats')).toBeNull()
  })

  test('an unwritable directory does not break serving the answer', async () => {
    const blocker = path.join(DIR, 'blocked')
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(blocker, 'a file where the directory should be')
    const prev = process.env.SNAPSHOT_DIR
    process.env.SNAPSHOT_DIR = path.join(blocker, 'sub')
    __resetSnapshotsForTests()
    try {
      const r = await viaSnapshot(TIN, 'stats', {}, counter({ n: 1 }).run)
      expect(r.data).toEqual({ n: 1 })
    } finally {
      process.env.SNAPSHOT_DIR = prev
      __resetSnapshotsForTests()
    }
  })
})
