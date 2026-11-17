import { afterAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { backupInfo, defaultBackupDir, metaFiles, restoreMissing, snapshotDaily, syncMeta } from '../meta-backup'

mock.module('server-only', () => ({}))
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-bak-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

let n = 0
const fresh = () => {
  const d = path.join(root, `t${++n}`)
  const main = path.join(d, 'main')
  const bak = path.join(d, 'bak')
  fs.mkdirSync(path.join(main, 'shards'), { recursive: true })
  fs.mkdirSync(path.join(main, 'files'), { recursive: true })
  return { main, bak, latest: path.join(bak, 'latest') }
}
const w = (f: string, s: string) => (fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, s))
const r = (f: string) => fs.readFileSync(f, 'utf8')
const SHARD = '{"id":"1","caseNumber":"4-1-1/1"}\n{"id":"2","caseNumber":"4-1-1/2"}\n'
const seed = (main: string) => {
  w(path.join(main, 'shards', '001.jsonl'), SHARD)
  w(path.join(main, 'checked.jsonl'), '{"caseNumber":"4-1-1/1"}\n')
  w(path.join(main, 'downloads.jsonl'), '{"pdfId":"x"}\n')
  w(path.join(main, 'files', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'), '%PDF-1.4 big')
}

describe('where the copy goes', () => {
  test('per platform, in the app-data folder, never next to the PDFs', () => {
    expect(defaultBackupDir({ LOCALAPPDATA: 'C:\\Users\\U\\AppData\\Local' }, 'C:\\Users\\U', 'win32')).toBe(path.join('C:\\Users\\U\\AppData\\Local', 'SudTizimi', 'orders-backup'))
    expect(defaultBackupDir({}, '/Users/u', 'darwin')).toBe(path.join('/Users/u', 'Library', 'Application Support', 'SudTizimi', 'orders-backup'))
    expect(defaultBackupDir({}, '/home/u', 'linux')).toBe(path.join('/home/u', '.local', 'share', 'sud-tizimi', 'orders-backup'))
    expect(defaultBackupDir({ XDG_DATA_HOME: '/x' }, '/home/u', 'linux')).toBe(path.join('/x', 'sud-tizimi', 'orders-backup'))
  })
  test('an explicit folder wins, «off» disables it, and a relocated cache does not silently write elsewhere', () => {
    expect(defaultBackupDir({ PUBLIC_ORDERS_BACKUP_DIR: '/safe' }, '/h', 'linux')).toBe('/safe')
    expect(defaultBackupDir({ PUBLIC_ORDERS_BACKUP_DIR: 'OFF' }, '/h', 'linux')).toBeNull()
    expect(defaultBackupDir({ PUBLIC_ORDERS_DIR: '/tmp/x' }, '/h', 'linux')).toBeNull()
    expect(defaultBackupDir({ PUBLIC_ORDERS_DIR: '/tmp/x', PUBLIC_ORDERS_BACKUP_DIR: '/safe' }, '/h', 'linux')).toBe('/safe')
  })
})

describe('syncMeta (the mirror)', () => {
  test('copies the metadata (index, checks, log) and NOT the PDFs', () => {
    const t = fresh()
    seed(t.main)
    expect(metaFiles(t.main).sort()).toEqual(['checked.jsonl', 'downloads.jsonl', path.join('shards', '001.jsonl')])
    expect(syncMeta(t.main, t.latest)).toBe(3)
    expect(r(path.join(t.latest, 'shards', '001.jsonl'))).toBe(SHARD)
    expect(fs.existsSync(path.join(t.latest, 'files'))).toBe(false)
  })
  test('unchanged files are not copied again; a grown file is', () => {
    const t = fresh()
    seed(t.main)
    syncMeta(t.main, t.latest)
    expect(syncMeta(t.main, t.latest)).toBe(0)
    fs.appendFileSync(path.join(t.main, 'checked.jsonl'), '{"caseNumber":"4-2-2/2"}\n')
    expect(syncMeta(t.main, t.latest)).toBe(1)
    expect(r(path.join(t.latest, 'checked.jsonl'))).toContain('4-2-2/2')
  })
  test('a file the person deleted STAYS in the copy (the mirror never deletes)', () => {
    const t = fresh()
    seed(t.main)
    syncMeta(t.main, t.latest)
    fs.rmSync(path.join(t.main, 'shards', '001.jsonl'))
    expect(syncMeta(t.main, t.latest)).toBe(0)
    expect(fs.existsSync(path.join(t.latest, 'shards', '001.jsonl'))).toBe(true)
  })
  test('a SMALLER or empty file (damaged / truncated) never overwrites the good copy', () => {
    const t = fresh()
    seed(t.main)
    syncMeta(t.main, t.latest)
    w(path.join(t.main, 'shards', '001.jsonl'), '{"id":"1","caseNumber":"4-1-1/1"}\n') // truncated
    w(path.join(t.main, 'checked.jsonl'), '') // emptied
    expect(syncMeta(t.main, t.latest)).toBe(0)
    expect(r(path.join(t.latest, 'shards', '001.jsonl'))).toBe(SHARD)
    expect(r(path.join(t.latest, 'checked.jsonl'))).toContain('4-1-1/1')
  })
})

describe('restoreMissing (after a deletion)', () => {
  test('the whole folder deleted → every metadata file comes back; the PDFs do not (they are re-downloaded)', () => {
    const t = fresh()
    seed(t.main)
    syncMeta(t.main, t.latest)
    fs.rmSync(t.main, { recursive: true, force: true })
    expect(restoreMissing(t.main, t.latest)).toBe(3)
    expect(r(path.join(t.main, 'downloads.jsonl'))).toBe('{"pdfId":"x"}\n')
    expect(r(path.join(t.main, 'shards', '001.jsonl'))).toContain('"id":"2"')
    expect(fs.existsSync(path.join(t.main, 'files'))).toBe(false)
  })
  test('only missing or empty files are restored; a file that exists is never overwritten', () => {
    const t = fresh()
    seed(t.main)
    syncMeta(t.main, t.latest)
    fs.rmSync(path.join(t.main, 'downloads.jsonl'))
    w(path.join(t.main, 'checked.jsonl'), '') // empty counts as lost
    w(path.join(t.main, 'shards', '001.jsonl'), SHARD + '{"id":"3","caseNumber":"4-1-1/3"}\n') // newer than the copy
    expect(restoreMissing(t.main, t.latest)).toBe(2)
    expect(r(path.join(t.main, 'shards', '001.jsonl'))).toContain('"id":"3"')
    expect(r(path.join(t.main, 'checked.jsonl'))).toContain('4-1-1/1')
  })
  test('nothing to restore from → nothing happens', () => {
    const t = fresh()
    expect(restoreMissing(t.main, t.latest)).toBe(0)
  })
})

describe('snapshotDaily', () => {
  test('one snapshot a day, the last 7 days kept', () => {
    const t = fresh()
    seed(t.main)
    syncMeta(t.main, t.latest)
    const daily = path.join(t.bak, 'daily')
    for (let d = 1; d <= 9; d++) expect(snapshotDaily(t.latest, daily, `2026-11-${String(d).padStart(2, '0')}`)).toBe(true)
    expect(snapshotDaily(t.latest, daily, '2026-11-09')).toBe(false) // already taken today
    expect(fs.readdirSync(daily).sort()).toEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'])
    expect(r(path.join(daily, '2026-11-09', 'checked.jsonl'))).toContain('4-1-1/1')
  })
  test('a bad date or an empty mirror makes nothing', () => {
    const t = fresh()
    expect(snapshotDaily(t.latest, path.join(t.bak, 'daily'), '2026-11-09')).toBe(false)
    seed(t.main)
    syncMeta(t.main, t.latest)
    expect(snapshotDaily(t.latest, path.join(t.bak, 'daily'), '../evil')).toBe(false)
  })
  test('backupInfo reports the files, the newest time and the days', () => {
    const t = fresh()
    seed(t.main)
    syncMeta(t.main, t.latest)
    snapshotDaily(t.latest, path.join(t.bak, 'daily'), '2026-11-09')
    const i = backupInfo(t.bak)
    expect(i).toMatchObject({ dir: t.bak, files: 3, days: 1 })
    expect(i.lastAt).toBeGreaterThan(0)
    expect(backupInfo(path.join(root, 'nowhere'))).toMatchObject({ files: 0, days: 0, lastAt: 0 })
  })
})

describe('wired into the data folder (the real start-up path)', () => {
  test('delete the cache folder → the next start puts the metadata back, and a later save is backed up', async () => {
    const t = fresh()
    seed(t.main)
    syncMeta(t.main, t.latest)
    fs.rmSync(t.main, { recursive: true, force: true })
    process.env.PUBLIC_ORDERS_DIR = t.main
    process.env.PUBLIC_ORDERS_BACKUP_DIR = t.bak
    const { dataDir, lastRestore } = await import('../data-dir')
    expect(dataDir()).toBe(t.main)
    expect(lastRestore.files).toBe(3)
    expect(r(path.join(t.main, 'checked.jsonl'))).toContain('4-1-1/1')
    const { allOrders } = await import('../store')
    expect((await allOrders()).map((o) => o.id)).toEqual(['1', '2'])
    delete process.env.PUBLIC_ORDERS_BACKUP_DIR
  })
})
