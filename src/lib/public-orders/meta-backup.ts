import fs from 'node:fs'
import path from 'node:path'

/**
 * A protected second copy of the orders METADATA (the order index `shards/*.jsonl`, the check records `checked.jsonl`, the
 * download log `downloads.jsonl`): small, slow to rebuild (each case is ~10 s upstream) and the one thing the person must not
 * lose by deleting a folder by accident. The PDFs are NOT copied: they are big, and a deleted one is re-downloaded from this
 * metadata («Mavjud emas» → «Qayta yuklash»).
 *
 * The copy lives in the operating system's app-data folder, a place people rarely open (Windows `%LOCALAPPDATA%\SudTizimi`),
 * not next to the PDFs in `~/.sud-tizimi`:
 *   <backup dir>/latest/…        a mirror of the metadata files, refreshed shortly after every change
 *   <backup dir>/daily/<date>/…  one snapshot a day, the last 7 kept (a damaged file cannot overwrite the older days)
 *
 * Rules (each one protects the copy):
 *   - the mirror NEVER deletes: a file that disappears from the main folder stays in the copy (that is the point);
 *   - the mirror never replaces a file with a SMALLER one (the files are append-only: smaller = damaged or truncated);
 *   - at start, a file that is missing (or empty) in the main folder is restored from the copy; nothing else is touched.
 * Pure functions over explicit folders (no globals), so each rule is tested on temp folders.
 */

/** Where the copy goes by default; null = no backup. `PUBLIC_ORDERS_BACKUP_DIR` overrides (`off` disables). */
export function defaultBackupDir(env: Record<string, string | undefined>, home: string, platform: string): string | null {
  const o = env.PUBLIC_ORDERS_BACKUP_DIR
  if (o !== undefined && o !== '') return o.toLowerCase() === 'off' ? null : o
  if (env.PUBLIC_ORDERS_DIR) return null // a relocated cache (tests, custom setups) does not silently write elsewhere on the machine
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'SudTizimi', 'orders-backup')
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'SudTizimi', 'orders-backup')
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'sud-tizimi', 'orders-backup')
}

/** The metadata files under `dir`, as paths relative to it. */
export function metaFiles(dir: string): string[] {
  const out: string[] = []
  for (const f of ['checked.jsonl', 'downloads.jsonl']) if (fs.existsSync(path.join(dir, f))) out.push(f)
  try {
    for (const n of fs.readdirSync(path.join(dir, 'shards'))) if (n.endsWith('.jsonl')) out.push(path.join('shards', n))
  } catch { /* no shards yet */ }
  return out
}

const stat = (f: string): fs.Stats | null => {
  try {
    return fs.statSync(f)
  } catch {
    return null
  }
}

/** Copy one file whole or not at all (temp file + rename), keeping its modification time (that is what «unchanged» compares). */
function copyFile(from: string, to: string, mtime: Date): void {
  fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 })
  const tmp = `${to}.${process.pid}.tmp`
  fs.copyFileSync(from, tmp)
  fs.chmodSync(tmp, 0o600)
  fs.utimesSync(tmp, mtime, mtime)
  fs.renameSync(tmp, to)
}

/** Mirror the metadata of `src` into `dst` (the `latest` folder). Returns how many files were copied. Never deletes, never shrinks. */
export function syncMeta(src: string, dst: string): number {
  let copied = 0
  for (const rel of metaFiles(src)) {
    const s = stat(path.join(src, rel))
    if (!s || s.size === 0) continue // nothing worth keeping
    const d = stat(path.join(dst, rel))
    if (d && s.size < d.size) continue // smaller than the copy: damaged, never overwrite the good one
    // unchanged: same size and not newer (a copied mtime loses its sub-millisecond part, so allow 2 ms of slack)
    if (d && s.size === d.size && s.mtimeMs - d.mtimeMs <= 2) continue
    copyFile(path.join(src, rel), path.join(dst, rel), s.mtime)
    copied++
  }
  return copied
}

/** Put every file that is missing (or empty) in `src` back from the mirror. Returns how many were restored. Never overwrites a non-empty file. */
export function restoreMissing(src: string, latest: string): number {
  let restored = 0
  for (const rel of metaFiles(latest)) {
    const b = stat(path.join(latest, rel))
    if (!b || b.size === 0) continue
    const s = stat(path.join(src, rel))
    if (s && s.size > 0) continue
    copyFile(path.join(latest, rel), path.join(src, rel), b.mtime)
    restored++
  }
  return restored
}

/** Once a day: copy `latest` into `daily/<day>` (if that day has no folder yet) and keep only the newest `keep` days. */
export function snapshotDaily(latest: string, dailyRoot: string, day: string, keep = 7): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !fs.existsSync(latest)) return false
  const target = path.join(dailyRoot, day)
  let made = false
  if (!fs.existsSync(target) && metaFiles(latest).length) {
    fs.mkdirSync(dailyRoot, { recursive: true, mode: 0o700 })
    const tmp = `${target}.${process.pid}.tmp`
    fs.cpSync(latest, tmp, { recursive: true })
    fs.renameSync(tmp, target)
    made = true
  }
  try {
    const days = fs.readdirSync(dailyRoot).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort()
    for (const old of days.slice(0, Math.max(0, days.length - keep))) fs.rmSync(path.join(dailyRoot, old), { recursive: true, force: true })
  } catch { /* nothing to prune */ }
  return made
}

export interface BackupInfo {
  dir: string
  /** newest modification time among the copied files (ms), 0 when nothing is there yet */
  lastAt: number
  files: number
  /** daily snapshots kept */
  days: number
}

export function backupInfo(dir: string): BackupInfo {
  const latest = path.join(dir, 'latest')
  const files = metaFiles(latest)
  let lastAt = 0
  for (const rel of files) lastAt = Math.max(lastAt, stat(path.join(latest, rel))?.mtimeMs ?? 0)
  let days = 0
  try {
    days = fs.readdirSync(path.join(dir, 'daily')).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).length
  } catch { /* none yet */ }
  return { dir, lastAt, files: files.length, days }
}
