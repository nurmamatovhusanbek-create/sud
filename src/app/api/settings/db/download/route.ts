import fs from 'node:fs'
import { Readable } from 'node:stream'
import { guard } from '@/server/middleware'
import { jsonFail } from '@/server/envelope'
import { snapshotFile } from '@/lib/db-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * GET /api/settings/db/download → the whole database as ONE file, `sud-YYYYMMDD.db` [privileged: it is all the data]. A consistent copy is made
 * first (`VACUUM INTO` a temp file: safe while the app writes) and streamed; the temp file is deleted when the download ends or is cancelled.
 * Restore: close the app, put the file at `~/.sud-tizimi/sud.db`.
 */
export const GET = guard(
  async () => {
    let snap: ReturnType<typeof snapshotFile>
    try {
      snap = snapshotFile()
    } catch (e) {
      return jsonFail(e instanceof Error ? e.message : 'Nusxa olib boʻlmadi', 'internal', 500)
    }
    const input = fs.createReadStream(snap.file)
    input.on('close', snap.done)
    input.on('error', snap.done)
    return new Response(Readable.toWeb(input) as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Disposition': `attachment; filename="${snap.name}"`,
        'Content-Length': String(fs.statSync(snap.file).size),
        'Cache-Control': 'no-store',
      },
    })
  },
  { privileged: true, rateLimit: false },
)
