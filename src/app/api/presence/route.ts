/**
 * /api/presence — «is anybody looking at the app?»
 *
 *   POST { id, bye? }  a page's heartbeat (every 30 s) or its goodbye. Answers `{ autoExit }`: the page stops pinging when
 *                      the server was not started to shut itself down (a plain `bun run dev`), so dev.log stays quiet.
 *   GET                what the supervisor reads to decide whether to stop the server: open windows, how long it has been
 *                      empty, and whether a background order or bills job is still running (never stop under it).
 *
 * Starts nothing and touches no network. Docs: AGENTS.md › Windows launcher.
 */

import { z } from 'zod'
import { billJobRunning } from '@/lib/bill-cases'
import { backupBusy } from '@/lib/backup'
import { caseJobStatus } from '@/lib/public-orders/company-job'
import { downloadJobRunning } from '@/lib/public-orders/download-job-real'
import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { presenceSnapshot, recordBeat, recordBye } from '@/server/presence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({ id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/), bye: z.boolean().optional() })
const autoExit = () => process.env.SUD_AUTO_EXIT === '1'

export const POST = guard(
  async (req) => {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return jsonFail('Notoʻgʻri soʻrov', 'bad_request', 400)
    if (parsed.data.bye) recordBye(parsed.data.id)
    else recordBeat(parsed.data.id)
    return jsonOk({ autoExit: autoExit() })
  },
  { maxBodyBytes: 1024 },
)

export const GET = guard(async () => {
  return jsonOk({ ...presenceSnapshot(), busy: caseJobStatus().state === 'running' || billJobRunning() || backupBusy() || downloadJobRunning(), autoExit: autoExit() })
})
