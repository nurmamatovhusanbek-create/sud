/**
 * The Company domain model — the keystone (arch guide §3.1, A1).
 *
 * "One company, one context": the user thinks in companies, not tabs. The
 * active company is resolved ONCE (from search / watchlist / recents) and
 * every section reads identity from the store — no per-tab STIR inputs.
 */
export interface Company {
  /** 9-digit tax id — THE identity. */
  stir: string
  /** Display name (may arrive later via orginfo/chamber). */
  name?: string
  status?: string
  rating?: {
    category: string | null
    score: number | null
  } | null
  /** Epoch ms of the last identity refresh. */
  updatedAt?: number
}

/** Normalize to the canonical 9-digit form; returns null when not a TIN. */
export function normalizeStir(input: string): string | null {
  const digits = (input || '').replace(/\D/g, '')
  return /^\d{9}$/.test(digits) ? digits : null
}
