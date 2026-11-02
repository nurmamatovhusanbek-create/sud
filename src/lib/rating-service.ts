/**
 * The chamber.uz rating on its OWN, fast path (one small request), apart from the heavy stats scrape.
 *
 * Why: the rating used to arrive only inside the stats answer, i.e. after the slowest of three court searches (tens of
 * seconds, retries included) and only if the stats were kept in the 24-hour snapshot or scraped fresh. A card on
 * Kuzatuv therefore showed an old or missing rating long after chamber would have answered, and a snapshot written
 * while chamber was down kept «no rating» for a day. This asks chamber directly and remembers a GOOD answer for a short
 * while; a failure is never remembered.
 */
import { getCompanyRatingDetailed } from './chamber'

export interface QuickRating {
  /** chamber category, AAA … D; null = chamber has no rating for this company */
  category: string | null
  score: number | null
  /** the name chamber knows the company by (a fallback while orginfo has not answered) */
  name: string
  /** the source could not be reached: the rating is UNKNOWN, keep what is known */
  failed: boolean
}

const TTL_MS = 30 * 60_000
const cache = new Map<string, { at: number; value: QuickRating }>()
const inflight = new Map<string, Promise<QuickRating>>()

export async function getQuickRating(tin: string, opts: { force?: boolean; now?: number } = {}): Promise<QuickRating> {
  const now = opts.now ?? Date.now()
  if (!opts.force) {
    const hit = cache.get(tin)
    if (hit && now - hit.at < TTL_MS) return hit.value
  }
  const running = inflight.get(tin)
  if (running && !opts.force) return running
  const p = (async () => {
    const { rating, failed } = await getCompanyRatingDetailed(tin)
    const value: QuickRating = {
      category: rating && rating.type && rating.type !== '-' ? rating.type : null,
      score: rating && typeof rating.criteriaAll === 'number' && rating.type && rating.type !== '-' ? rating.criteriaAll : null,
      name: rating ? rating.name || rating.nameLat || rating.nameRu || '' : '',
      failed,
    }
    if (!failed) cache.set(tin, { at: now, value }) // only a real answer is remembered
    if (cache.size > 500) for (const [k, v] of cache) if (now - v.at > TTL_MS) cache.delete(k)
    return value
  })().finally(() => inflight.delete(tin))
  inflight.set(tin, p)
  return p
}

export function __resetRatingCacheForTests(): void {
  cache.clear()
  inflight.clear()
}
