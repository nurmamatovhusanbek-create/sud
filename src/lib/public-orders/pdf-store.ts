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
