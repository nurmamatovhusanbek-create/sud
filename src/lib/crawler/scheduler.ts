import 'server-only'
import { runCrawlSweep, pruneOldDockets } from './index'

/**
 * v205 (§5.7): In-process crawler scheduler.
 *
 * Runs ONLY when CRAWLER_ENABLED=true (set it on the one persistent host that
 * owns the crawl — never on multiple instances, never on serverless). The
 * default sweep cadence is 6h; the first sweep starts 10s after boot so the
 * server is up first.
 */

let started = false

export function startCrawler(): void {
  if (started || process.env.CRAWLER_ENABLED !== 'true') return
  started = true
  const SWEEP_MS = Number(process.env.CRAWLER_SWEEP_MS ?? 6 * 60 * 60_000) // 6h
  const loop = async (): Promise<void> => {
    try {
      const r = await runCrawlSweep()
      await pruneOldDockets()
      console.log(
        `[crawler] sweep done: fetched=${r.fetched} notModified=${r.notModified} upserted=${r.upserted}`,
      )
    } catch (e) {
      console.error('[crawler] sweep failed', e)
    }
    setTimeout(loop, SWEEP_MS)
  }
  setTimeout(loop, 10_000) // small delay after boot
  console.log('[crawler] scheduler started (CRAWLER_ENABLED=true)')
}
