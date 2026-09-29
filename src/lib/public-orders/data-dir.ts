import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
    fs.mkdirSync(to, { recursive: true })
    fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false })
    return true
  } catch {
    return false // migration is a convenience: a failure just means a fresh cache
  }
}

let memo: { key: string; dir: string } | null = null

export function dataDir(): string {
  const key = `${process.env.PUBLIC_ORDERS_DIR ?? ''}|${process.cwd()}`
  if (memo?.key === key) return memo.dir
  const dir = resolveDataDir(process.env, os.homedir())
  if (!process.env.PUBLIC_ORDERS_DIR) migrateLegacy(legacyDataDir(process.cwd()), dir)
  memo = { key, dir }
  return dir
}
