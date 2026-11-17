import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultBackupDir, restoreMissing } from './meta-backup'

/**
 * Where the local orders cache lives.
 *
 * The cache is slow to build (each case is ~10 s upstream) and is never deleted by the app — only added to and
 * updated — so it must not sit inside the project folder, where re-cloning, «delete my local files and pull again»
 * or `git clean` would wipe it. Default: `<home>/.sud-tizimi/public-orders`; `PUBLIC_ORDERS_DIR` overrides.
 * A cache an earlier version left at `<project>/data/public-orders` is COPIED over once (the old one is left alone).
 */

export const resolveDataDir = (env: Record<string, string | undefined>, home: string): string => env.PUBLIC_ORDERS_DIR || path.join(home, '.sud-tizimi', 'public-orders')

export const legacyDataDir = (cwd: string): string => path.join(cwd, 'data', 'public-orders')

const hasData = (dir: string): boolean => fs.existsSync(path.join(dir, 'checked.jsonl')) || fs.existsSync(path.join(dir, 'shards'))

/** Copy `from` → `to` when `from` has a cache and `to` has none yet. Never overwrites, never deletes. */
export function migrateLegacy(from: string, to: string): boolean {
  try {
    if (path.resolve(from) === path.resolve(to) || !hasData(from) || hasData(to)) return false
    fs.mkdirSync(to, { recursive: true, mode: 0o700 })
    fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false })
    return true
  } catch {
    return false // migration is a convenience: a failure just means a fresh cache
  }
}

let memo: { key: string; dir: string } | null = null

/** What the last start-up restore from the protected copy did (shown in Settings › Qarorlar). */
export const lastRestore: { files: number; at: number } = { files: 0, at: 0 }

/**
 * The first time the folder is used: if its metadata files were deleted (a folder removed by accident), put them back from the
 * protected copy (`meta-backup.ts`). Only missing / empty files are restored; nothing existing is ever overwritten.
 */
function restoreFromBackup(dir: string): void {
  try {
    const bak = defaultBackupDir(process.env, os.homedir(), process.platform)
    if (!bak) return
    const n = restoreMissing(dir, path.join(bak, 'latest'))
    if (n > 0) {
      lastRestore.files = n
      lastRestore.at = Date.now()
      console.log(`[orders] qarorlar maʼlumotlari zaxira nusxadan tiklandi: ${n} fayl (${bak})`)
    }
  } catch (e) {
    console.error('[orders] zaxiradan tiklab boʻlmadi:', e instanceof Error ? e.message : e)
  }
}

export function dataDir(): string {
  const key = `${process.env.PUBLIC_ORDERS_DIR ?? ''}|${process.env.PUBLIC_ORDERS_BACKUP_DIR ?? ''}|${process.cwd()}`
  if (memo?.key === key) return memo.dir
  const dir = resolveDataDir(process.env, os.homedir())
  if (!process.env.PUBLIC_ORDERS_DIR) migrateLegacy(legacyDataDir(process.cwd()), dir)
  restoreFromBackup(dir)
  memo = { key, dir }
  return dir
}
