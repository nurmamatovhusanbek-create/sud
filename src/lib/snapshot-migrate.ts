import 'server-only'
import fs from 'node:fs'
import { getDb } from './db'
import { retireCaseSnapshots, snapshotDir } from './snapshot-store'

/**
 * Runs once per «version» of how a company's cases are counted (`meta.snapshots_retired`): the day-old stats and court-list copies written by an
 * earlier version still hold the old count, and would for up to a day after an update. The first start after the update forgets them; the next open
 * of each company builds them again. Company info and bills snapshots are left alone. Never throws.
 */
const VERSION = '2' // 1 = the count rules of Nov 2026 (found cases in Statistika, the backup's list rows, no «-» rows)

export function retireStaleSnapshotsOnce(): number {
  try {
    const db = getDb()
    const done = db.prepare("SELECT v FROM meta WHERE k = 'snapshots_retired'").get()
    if (done && String(done.v) === VERSION) return 0
    let n = 0
    let names: string[] = []
    try {
      names = fs.readdirSync(snapshotDir())
    } catch {
      /* no snapshot folder yet: nothing to retire, but the marker is still written so a later start does not clear fresh copies */
    }
    for (const name of names) {
      const m = /^(\d{9})\.json$/.exec(name)
      if (!m) continue
      retireCaseSnapshots(m[1]!)
      n++
    }
    db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('snapshots_retired', ?)").run(VERSION)
    return n
  } catch {
    return 0
  }
}
