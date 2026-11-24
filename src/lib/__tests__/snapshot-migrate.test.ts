/** The once-per-version clearing of day-old stats and court-list copies (lib/snapshot-migrate): they would keep an old count for a day after an update. */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

mock.module('server-only', () => ({}))
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-migrate-'))
process.env.SNAPSHOT_DIR = path.join(DIR, 'snap')
process.env.SUD_DB = path.join(DIR, 'sud.db')
const dbm = await import('../db')
const snap = await import('../snapshot-store')
const { retireStaleSnapshotsOnce } = await import('../snapshot-migrate')

const A = '200248856'
const B = '302678824'
beforeEach(() => {
  dbm.closeDb()
  snap.__resetSnapshotsForTests()
  fs.rmSync(DIR, { recursive: true, force: true })
  fs.mkdirSync(DIR, { recursive: true })
})
afterAll(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('retireStaleSnapshotsOnce', () => {
  test('forgets every company\'s stats and court lists once, keeps their info and bills, and does nothing the second time', () => {
    for (const t of [A, B]) {
      snap.writeSnapshot(t, 'stats', { old: 1 })
      snap.writeSnapshot(t, 'court:economic', ['x'])
      snap.writeSnapshot(t, 'info', { keep: 1 })
      snap.writeSnapshot(t, 'bills', { keep: 1 })
    }
    expect(retireStaleSnapshotsOnce()).toBe(2)
    for (const t of [A, B]) {
      expect(snap.readSnapshot(t, 'stats')).toBeNull()
      expect(snap.readSnapshot(t, 'court:economic')).toBeNull()
      expect(snap.readSnapshot(t, 'info')).not.toBeNull()
      expect(snap.readSnapshot(t, 'bills')).not.toBeNull()
    }
    snap.writeSnapshot(A, 'stats', { fresh: 1 }) // built again by the new code
    expect(retireStaleSnapshotsOnce()).toBe(0)
    expect(snap.readSnapshot(A, 'stats')).not.toBeNull() // not cleared a second time
  })

  test('with no snapshot folder yet it still writes the marker, so a later start does not clear fresh copies', () => {
    expect(retireStaleSnapshotsOnce()).toBe(0)
    snap.writeSnapshot(A, 'stats', { fresh: 1 })
    expect(retireStaleSnapshotsOnce()).toBe(0)
    expect(snap.readSnapshot(A, 'stats')).not.toBeNull()
  })
})
