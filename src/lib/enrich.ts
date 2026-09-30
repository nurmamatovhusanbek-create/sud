/**
 * Refresh a company's cached registry meta (rating, case count, next hearing)
 * from the live sources. Shared by the watchlist and the launcher so a
 * per-card / refresh-all button anywhere re-fetches the same way.
 *
 * Best-effort: patches whatever it can and returns true if either source
 * answered, false if both failed (so the caller can toast).
 */

import { winRate } from '@/core/rates'
import { getStats, getUpcomingHearings } from './api-client'
import { hearingMetaPatch, patchMeta } from './registry'

export async function enrichCompany(stir: string, force = false): Promise<boolean> {
  let statsOk = false
  let hearingsOk = false

  const applyStats = (res: Awaited<ReturnType<typeof getStats>>) => {
    if (res.ok) {
      statsOk = true
      const s = res.data
      patchMeta(stir, {
        cases: s.summary.total,
        winRate: winRate(s.summary.win, s.summary.lose) ?? undefined,
        status: s.company?.status,
        rating: s.rating?.category ?? null,
        score: s.rating?.score ?? null,
      })
    }
  }
  const applyHearings = (res: Awaited<ReturnType<typeof getUpcomingHearings>>) => {
    if (res.ok) {
      hearingsOk = true
      const hs = (res.data.hearings as unknown as Record<string, unknown>[]) || []
      if (hs.some((h) => h?.isoDate)) patchMeta(stir, hearingMetaPatch(hs))
    }
  }

  try {
    const [stats, hearings] = await Promise.allSettled([
      getStats(stir, { force }),
      getUpcomingHearings(stir),
    ])
    if (stats.status === 'fulfilled') applyStats(stats.value)
    if (hearings.status === 'fulfilled') applyHearings(hearings.value)
  } catch {
    /* best-effort */
  }
  return statsOk || hearingsOk
}
