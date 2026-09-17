/**
 * SourceAdapter pattern (blueprint §4.2) — the seam between the server layer
 * and the scraper libs.
 *
 * The scraper libs (src/lib/*) are the PRESERVED crown jewels: their exact
 * request shapes, PoW/captcha flow, TLS-bypass tiers, and BEST-OF racing stay
 * untouched. Each adapter here:
 *   - gives the source a NAME (metrics + health key),
 *   - declares its CACHE POLICY (key + ttl from config),
 *   - runs it under metrics timing,
 *   - validates output shape at the boundary (zod) where a schema exists,
 * so a shape change upstream fails loudly instead of shipping silent bad data.
 */

import { z } from 'zod'
import { config } from '@/server/config'
import { timed } from '@/infra/metrics'

export interface FetchCtx {
  signal?: AbortSignal
  /** Force a fresh scrape, bypassing read caches where supported. */
  force?: boolean
}

export interface CachePolicy<Q> {
  key: (q: Q) => string
  ttlMs: () => number
}

export interface SourceAdapter<Q, R> {
  name: string
  cachePolicy?: CachePolicy<Q>
  run(q: Q, ctx?: FetchCtx): Promise<R>
}

export function defineSource<Q, R>(
  def: SourceAdapter<Q, R> & { schema?: z.ZodType<R> },
): SourceAdapter<Q, R> {
  const run = async (q: Q, ctx: FetchCtx): Promise<R> => {
    const result = await timed(def.name, () => def.run(q, ctx))
    if (def.schema) {
      const parsed = def.schema.safeParse(result)
      if (!parsed.success) {
        throw new Error(
          `[${def.name}] upstream shape drift: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        )
      }
      return parsed.data
    }
    return result
  }
  return { name: def.name, cachePolicy: def.cachePolicy, run }
}

export const retryTiersFromConfig = () => config.resilience.retryTiersMs
