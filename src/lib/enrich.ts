/**
 * Refresh a company's cached registry meta (rating, case count, next hearing)
 * from the live sources. Shared by the watchlist and the launcher so a
 * per-card / refresh-all button anywhere re-fetches the same way.
 *
 * Best-effort: patches whatever it can and returns true if either source
 * answered, false if both failed (so the caller can toast).
 */

import { winRate } from '@/core/rates'
import { getRating, getStats, getUpcomingHearings } from './api-client'
import { companyFactsPatch, getRecord, hearingMetaPatch, isRealName, orderCasesPatch, patchMeta, patchRecord } from './registry'

export interface EnrichResult {
  /** the stats came back COMPLETE (every court answered) */
  stats: boolean
  hearings: boolean
}

/**
 * The chamber rating on its own fast path (/api/rating), written to the registry the moment it arrives: it must not
 * wait for the court searches of the stats scrape. A failure changes nothing (the known rating stays). Resolves to the
 * rating it got, so a caller can show it right away.
 */
export async function refreshRating(stir: string, force = false): Promise<{ category: string; score: number | null } | null> {
  try {
    const res = await getRating(stir, { force })
    if (!res.ok) return null
    const named = isRealName(getRecord(stir)?.name)
    // chamber's own name only fills a company that has none yet (orginfo / stats names win)
    const facts = companyFactsPatch({ company: named ? undefined : { name: res.data.name }, rating: res.data.rating }, Date.now())
    patchRecord(stir, { name: facts.name, meta: facts.meta })
    return res.data.rating
  } catch {
    return null
  }
}

export async function enrichCompany(stir: string, force = false): Promise<boolean> {
  const r = await enrichCompanyDetailed(stir, force)
  return r.stats || r.hearings
}

export async function enrichCompanyDetailed(stir: string, force = false): Promise<EnrichResult> {
  let statsOk = false
  let hearingsOk = false
  // started first and not awaited by the court searches: the rating is on the card within a second or two
  const ratingDone = refreshRating(stir, force)

  const applyStats = (res: Awaited<ReturnType<typeof getStats>>) => {
    if (!res.ok) return
    const s = res.data
    // the COMPANY facts (name, status, rating) come from orginfo / chamber, not from the courts: they are written
    // from every answer, partial or not
    const facts = companyFactsPatch(s, res.meta?.fetchedAt)
    patchRecord(stir, { name: facts.name, meta: facts.meta })
    // a PARTIAL answer (a court site failed) counts too few cases: writing them would replace what an earlier,
    // complete refresh learned with a lower number
    if (!(res.partial && res.partial.length > 0) && s.errors.length === 0) {
      statsOk = true
      patchMeta(stir, {
        cases: s.summary.total,
        ...orderCasesPatch(s.cases),
        winRate: winRate(s.summary.win, s.summary.lose) ?? undefined,
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
    if (force) {
      // one after the other: the forced stats scrape refills the server's court lists, and the hearings read then
      // uses them instead of scraping the same sites a second time
      applyStats(await getStats(stir, { force: true }).catch(() => ({ ok: false }) as Awaited<ReturnType<typeof getStats>>))
      applyHearings(await getUpcomingHearings(stir).catch(() => ({ ok: false }) as Awaited<ReturnType<typeof getUpcomingHearings>>))
    } else {
      const [stats, hearings] = await Promise.allSettled([getStats(stir), getUpcomingHearings(stir)])
      if (stats.status === 'fulfilled') applyStats(stats.value)
      if (hearings.status === 'fulfilled') applyHearings(hearings.value)
    }
  } catch {
    /* best-effort */
  }
  await ratingDone
  return { stats: statsOk, hearings: hearingsOk }
}
