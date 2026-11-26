import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { downloadJob } from '@/lib/public-orders/download-job-real'
import { MAX_JOB } from '@/lib/public-orders/download-job'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * «Barchasini yuklash» as a server job (lib/public-orders/download-job): the Qarorlar page starts it and WATCHES it, so leaving the page does not stop it.
 *
 *   GET   → the job's state (phase, progress, the orders that could not be saved and why)
 *   POST  { action: 'start', ids: string[] } | { action: 'stop' } | { action: 'clear' }
 *
 * Starting is a click (nothing starts by itself); the ids must be order file ids. The downloads go through the shared loader and the gate in front of the
 * court-orders API, exactly like one order opened by hand.
 */
export const GET = guard(async () => jsonOk(downloadJob().state()), { rateLimit: false })

export const POST = guard(
  async (req) => {
    let body: { action?: unknown; ids?: unknown } | null = null
    try {
      body = await req.json()
    } catch {
      /* falls through */
    }
    const job = downloadJob()
    if (body?.action === 'start' && Array.isArray(body.ids)) {
      if (body.ids.length > MAX_JOB * 2) return jsonFail('Juda koʻp qaror bir vaqtda', 'too_large', 413)
      const r = job.start(body.ids as string[])
      return r.ok ? jsonOk(job.state()) : jsonFail(r.error, 'bad_request', 409)
    }
    if (body?.action === 'stop') {
      job.stop()
      return jsonOk(job.state())
    }
    if (body?.action === 'clear') {
      job.clear()
      return jsonOk(job.state())
    }
    return jsonFail("action 'start' (ids bilan), 'stop' yoki 'clear' kerak", 'bad_request', 400)
  },
  { maxBodyBytes: 2 * 1024 * 1024 },
)
