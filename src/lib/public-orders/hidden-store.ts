/**
 * The orders the person CLEARED from the Qarorlar lists («Tozalash»). Only a set of file ids in one small JSON file next to the
 * order store: the order RECORDS are never touched (they stay in the shards and in the protected copy), so a search by case
 * number still finds a cleared order, with its «Yuklab olish» button. It is interface state, not metadata: losing it only
 * brings the cleared orders back into the lists. Atomic write; the set lives in memory (one process).
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { isOrderFileId } from '@/core/public-orders'
import { dataDir } from './data-dir'
import { renameWithRetry } from './pdf-store'

export const MAX_HIDDEN_IDS = 50_000

const file = () => path.join(dataDir(), 'hidden.json')

const G = globalThis as typeof globalThis & { __sudHidden?: { dir: string; set: Set<string> } }
let chain: Promise<unknown> = Promise.resolve()

/** The cleared ids (lower case). Re-read when the data folder changed (tests, a moved folder). */
export async function readHidden(): Promise<Set<string>> {
  const dir = dataDir()
  if (G.__sudHidden?.dir === dir) return G.__sudHidden.set
  let set = new Set<string>()
  try {
    const j = JSON.parse(await fs.readFile(file(), 'utf8')) as { ids?: unknown }
    if (Array.isArray(j.ids)) set = new Set(j.ids.filter((x): x is string => typeof x === 'string' && isOrderFileId(x)).map((x) => x.toLowerCase()))
  } catch {
    /* none yet, or unreadable: nothing is cleared */
  }
  G.__sudHidden = { dir, set }
  return set
}

async function persist(set: Set<string>): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true, mode: 0o700 })
  const f = file()
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify({ ids: [...set] }), { mode: 0o600 })
  await renameWithRetry(tmp, f)
}

/** Clear (`hide`) or bring back (`restore`) orders. Unknown / malformed ids are ignored. Returns how many ids changed. */
export function setHidden(action: 'hide' | 'restore', ids: string[]): Promise<{ changed: number; total: number }> {
  const run = async () => {
    const set = await readHidden()
    let changed = 0
    for (const raw of ids) {
      if (typeof raw !== 'string' || !isOrderFileId(raw)) continue
      const id = raw.toLowerCase()
      if (action === 'hide') {
        if (set.size >= MAX_HIDDEN_IDS && !set.has(id)) continue
        if (!set.has(id)) {
          set.add(id)
          changed++
        }
      } else if (set.delete(id)) changed++
    }
    if (changed) await persist(set)
    return { changed, total: set.size }
  }
  const next = chain.then(run, run)
  chain = next.catch(() => undefined)
  return next
}
