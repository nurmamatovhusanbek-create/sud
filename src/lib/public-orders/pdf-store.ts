import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { dataDir } from './data-dir'
import { isOrderFileId } from '@/core/public-orders'
import { scheduleMetaBackup } from './meta-backup-runner'

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

/**
 * `rename` that survives a moment of interference. On Windows a freshly written file is often held for a split second by an
 * antivirus scan or the indexer, and `rename` then fails with EPERM / EBUSY / EACCES although a retry works. Anything else (a
 * missing folder, a full disk) fails at once. Pure over injected `rename` / `sleep`, so it is tested without a disk.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  io: { rename: (a: string, b: string) => Promise<void>; sleep: (ms: number) => Promise<void> } = { rename: fs.rename, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  tries = 6,
): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await io.rename(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code
      if (i >= tries - 1 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e
      await io.sleep(80 * (i + 1)) // 80, 160, 240 … ms
    }
  }
}

export async function writePdf(id: string, bytes: Uint8Array, meta: { name?: string | null; via?: 'download' | 'import' } = {}): Promise<void> {
  const f = fileOf(id)
  if (!f) throw new Error('bad id')
  await fs.mkdir(dir(), { recursive: true, mode: 0o700 })
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, bytes, { mode: 0o600 })
  try {
    await renameWithRetry(tmp, f)
  } catch (e) {
    // last resort: copy over (works where a rename is refused), then drop the temp file; if even that fails, say why
    try {
      await fs.copyFile(tmp, f)
    } catch {
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw e
    }
    await fs.rm(tmp, { force: true }).catch(() => {})
  }
  // trust, but verify: the file the page will count as «Yuklangan» must really be there, whole
  const st = await fs.stat(f).catch(() => null)
  if (!st || st.size !== bytes.length) throw new Error('fayl diskka toʻliq yozilmadi')
  // remember that it was saved: if the file is deleted later, the Qarorlar page still knows it was here (and when, how big)
  await appendDownload({ pdfId: id.toLowerCase(), size: bytes.length, savedAt: Date.now(), name: meta.name ?? '', via: meta.via ?? 'download' }).catch(() => {})
}

// ---- the download log ---------------------------------------------------------------------------------------------
// `<data dir>/downloads.jsonl`: one line each time a PDF is stored (append-only, newest line per pdf id wins, never deleted by
// the app, like the rest of the orders cache). It is what tells «yuklangan» (file there) from «mavjud emas» (was saved, file
// gone): the file's presence alone cannot say whether it ever existed. A re-download appends a fresh line.

export interface DownloadRecord {
  pdfId: string
  size: number
  savedAt: number
  /** the court's own file name, when known */
  name: string
  /** `seen`: the file was already on disk when the log started (or was added by hand); the time is its modification time */
  via: 'download' | 'import' | 'seen'
}

const logFile = () => path.join(dataDir(), 'downloads.jsonl')
let chain: Promise<unknown> = Promise.resolve()
const serial = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = chain.then(job, job)
  chain = run.catch(() => undefined)
  return run
}

function appendDownload(r: DownloadRecord): Promise<void> {
  return serial(async () => {
    await fs.mkdir(dir(), { recursive: true, mode: 0o700 })
    await fs.appendFile(logFile(), JSON.stringify(r) + '\n', { encoding: 'utf8', mode: 0o600 })
    scheduleMetaBackup()
  })
}

export async function readDownloads(): Promise<Map<string, DownloadRecord>> {
  const m = new Map<string, DownloadRecord>()
  let text = ''
  try {
    text = await fs.readFile(logFile(), 'utf8')
  } catch {
    return m // nothing downloaded yet
  }
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const r = JSON.parse(line) as Partial<DownloadRecord>
      if (r && typeof r.pdfId === 'string' && isOrderFileId(r.pdfId) && typeof r.size === 'number' && typeof r.savedAt === 'number') {
        m.set(r.pdfId.toLowerCase(), { pdfId: r.pdfId.toLowerCase(), size: r.size, savedAt: r.savedAt, name: typeof r.name === 'string' ? r.name : '', via: r.via === 'import' || r.via === 'seen' ? r.via : 'download' })
      }
    } catch { /* a torn last line */ }
  }
  return m
}

/**
 * The history for the page: the log, plus a `seen` line for every PDF on disk the log does not know yet (files saved before
 * the log existed, or dropped into the folder by hand), so deleting THOSE later is recognised too.
 */
export async function syncDownloads(onDisk: Map<string, { size: number; savedAt: number }>): Promise<Map<string, DownloadRecord>> {
  const history = await readDownloads()
  for (const [id, f] of onDisk) {
    if (history.has(id)) continue
    const rec: DownloadRecord = { pdfId: id, size: f.size, savedAt: f.savedAt, name: '', via: 'seen' }
    history.set(id, rec)
    await appendDownload(rec).catch(() => {})
  }
  return history
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
