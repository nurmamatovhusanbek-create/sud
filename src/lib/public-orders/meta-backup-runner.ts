import os from 'node:os'
import path from 'node:path'
import { dataDir } from './data-dir'
import { backupInfo, defaultBackupDir, snapshotDaily, syncMeta, type BackupInfo } from './meta-backup'

/**
 * The scheduling around `meta-backup`: a write to the orders metadata asks for a backup, which runs a few seconds later (so a
 * burst of writes is ONE copy), plus a daily snapshot. A failure is logged and never reaches the caller: the backup is a safety
 * net, it must not break the feature it protects.
 */

const DELAY_MS = 15_000
const STALE_MS = 30 * 60_000

let timer: ReturnType<typeof setTimeout> | null = null
let lastRun = 0

export const backupDir = (): string | null => defaultBackupDir(process.env, os.homedir(), process.platform)

export function runMetaBackup(): number {
  const dst = backupDir()
  if (!dst) return 0
  try {
    const latest = path.join(dst, 'latest')
    const n = syncMeta(dataDir(), latest)
    snapshotDaily(latest, path.join(dst, 'daily'), new Date().toISOString().slice(0, 10))
    lastRun = Date.now()
    return n
  } catch (e) {
    console.error('[orders-backup] zaxira nusxa olinmadi:', e instanceof Error ? e.message : e)
    return 0
  }
}

/** The metadata changed: back it up shortly (one pending run at most). `ifStale`: only when the last run is old (a read path calling in). */
export function scheduleMetaBackup(opts: { ifStale?: boolean } = {}): void {
  if (timer || !backupDir()) return
  if (opts.ifStale && Date.now() - lastRun < STALE_MS) return
  timer = setTimeout(() => {
    timer = null
    runMetaBackup()
  }, DELAY_MS)
  timer.unref?.() // never keeps the server alive on its own
}

export function currentBackup(): BackupInfo | null {
  const d = backupDir()
  return d ? backupInfo(d) : null
}
