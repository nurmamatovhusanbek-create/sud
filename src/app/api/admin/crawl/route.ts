import { NextRequest } from 'next/server'
import { runCrawlSweep, pruneOldDockets } from '@/lib/crawler'
import { docketEnabled } from '@/lib/db/pool'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * v205 (§5.7): POST /api/admin/crawl — manual trigger for the docket-index
 * crawl (on-demand refresh / cold backfill / testing), guarded like every
 * other route. Also prunes expired rows after the sweep.
 *
 * Returns 501 when DATABASE_URL is not configured (index optional by design).
 * Response: { ok, skipped, fetched, notModified, upserted, pruned }
 */
async function POST_impl(_req: NextRequest) {
  if (!docketEnabled()) {
    return Response.json(
      {
        ok: false,
        skipped: true,
        error:
          'Docket index oʻchirilgan — DATABASE_URL sozlanmagan (index is optional).',
      },
      { status: 501 },
    )
  }
  const sweep = await runCrawlSweep()
  await pruneOldDockets()
  return Response.json({ ok: true, ...sweep, pruned: true })
}

export const POST = guard(POST_impl)
