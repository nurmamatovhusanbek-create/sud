/**
 * Self-healing for one specific `next dev` crash on Windows:
 *
 *   Error: EEXIST: file already exists, mkdir 'C:\...\sud\.next\dev'
 *
 * Next creates `.next/dev` on every start. When that folder is not a plain directory any more (a OneDrive placeholder
 * on a synced Desktop, a stale reparse point, a half-deleted tree) mkdir throws EEXIST, the server dies in a second,
 * and the supervisor used to respawn into the same wall forever. `.next/dev` is only Next's dev cache, so deleting it
 * is always safe in dev mode.
 *
 * Pure helpers, no process state, so they are tested (src/lib/__tests__/next-cache.test.ts).
 */

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** The crash line, on Windows (`\.next\dev`) and elsewhere (`/.next/dev`). Other EEXIST errors are not ours to handle. */
const CONFLICT = /EEXIST[^\n]*mkdir[^\n]*[\\/]\.next\b/i

export function isNextDirConflict(output) {
  return CONFLICT.test(String(output))
}

const rm = (p) => rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })

/**
 * Remove the dev cache. `.next/dev` first (the smallest thing that fixes it); only if that cannot be removed, the whole
 * `.next` (in dev mode that is all cache too). Never call this in production mode: `.next/standalone` is the app.
 * Returns what was removed, or `error` when something is still in the way (locked by an editor, antivirus, OneDrive).
 */
export function cleanDevCache(root) {
  const dev = join(root, '.next', 'dev')
  const all = join(root, '.next')
  const removed = []
  try {
    rm(dev)
    if (!existsSync(dev)) {
      removed.push(dev)
      return { removed }
    }
    rm(all)
    if (!existsSync(all)) {
      removed.push(all)
      return { removed }
    }
    return { removed, error: `${dev} hali ham bor` }
  } catch (e) {
    return { removed, error: e instanceof Error ? e.message : String(e) }
  }
}

/** What to tell the operator when cleaning did not hold. */
export function nextDirHelp(root, detail) {
  return (
    `\n[supervisor] Next oʻz kesh papkasini (.next\\dev) yarata olmayapti${detail ? ` (${detail})` : ''}.\n` +
    `  Odatda sabab: loyiha OneDrive bilan sinxronlanadigan papkada (Desktop, Documents).\n` +
    `  1) Loyihani sinxronlanmaydigan papkaga koʻchiring, masalan C:\\dev\\sud, yoki .next ni OneDrive dan chiqaring.\n` +
    `  2) VS Code va boshqa «node» jarayonlarini yoping, soʻng: rm -rf .next   (Git Bash)\n` +
    `  Papka: ${root}\n`
  )
}
