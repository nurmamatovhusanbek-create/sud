import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { dataDir } from './data-dir'
import { isOrderFileId } from '@/core/public-orders'

/**
 * Downloaded order PDFs, one file per order: `<data dir>/files/<pdf id>.pdf` (default `~/.sud-tizimi/public-orders/files`).
 * Like the rest of the orders cache it lives outside the project and the app never deletes it. Only a uuid ever becomes
 * a file name; a file is written whole or not at all (temp file + rename), 0600 in a 0700 folder.
 */

const dir = () => path.join(dataDir(), 'files')
const fileOf = (id: string): string | null => (isOrderFileId(id) ? path.join(dir(), `${id.toLowerCase()}.pdf`) : null)

export async function readPdf(id: string): Promise<Uint8Array | null> {
  const f = fileOf(id)
  if (!f) return null
  try {
    const b = await fs.readFile(f)
    return b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-' ? new Uint8Array(b) : null // a damaged file is fetched again
  } catch {
    return null
  }
}

export async function writePdf(id: string, bytes: Uint8Array): Promise<void> {
  const f = fileOf(id)
  if (!f) throw new Error('bad id')
  await fs.mkdir(dir(), { recursive: true, mode: 0o700 })
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, bytes, { mode: 0o600 })
  await fs.rename(tmp, f)
}

/** Every PDF on disk: order id → size and when it was saved (the Qarorlar search shows «Yuklangan» from this). */
export async function listPdfs(): Promise<Map<string, { size: number; savedAt: number }>> {
  const out = new Map<string, { size: number; savedAt: number }>()
  let names: string[]
  try {
    names = await fs.readdir(dir())
  } catch {
    return out // nothing downloaded yet
  }
  await Promise.all(
    names.map(async (n) => {
      const id = n.slice(0, -4)
      if (!n.endsWith('.pdf') || !isOrderFileId(id)) return // temp files and strangers are not orders
      try {
        const st = await fs.stat(path.join(dir(), n))
        if (st.size > 5) out.set(id.toLowerCase(), { size: st.size, savedAt: st.mtimeMs })
      } catch { /* vanished while listing */ }
    }),
  )
  return out
}
