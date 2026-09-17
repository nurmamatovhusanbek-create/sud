/**
 * One company registry keyed by STIR (arch guide §3.6, A6) — replaces the
 * three parallel localStorage lists (recents / saved-for-hearings / watchlist)
 * whose shapes never agreed on what "a company" is.
 *
 * Legacy migration: the three old keys are read ONCE, merged, and written
 * into the new store; the old keys are left untouched for rollback.
 */

export interface CompanyRecord {
  stir: string
  name?: string
  /** Visited (recents) — timestamp of last search. */
  lastVisitedAt?: number
  /** Saved for hearings tracking (legacy "saved companies"). */
  savedForHearings?: boolean
  /** Watched — the multi-company monitoring list. */
  watched?: boolean
  watchedAt?: number
  /** Cached display meta from prior fetches (identity/stats/hearings). */
  meta?: CompanyMeta
}

/** Display meta cached from previous visits — feeds home cards / KPIs / badges. */
export interface CompanyMeta {
  status?: string
  rating?: string | null
  score?: number | null
  cases?: number
  winRate?: number
  /** ISO date of the next scheduled hearing, when known. */
  nextHearingIso?: string
  nextHearingCourt?: string
  nextHearingCase?: string
  nextHearingTime?: string
  nextHearingJudge?: string
  /** Billing aggregates (tiyins) written by the Bills stream — feeds the
   *  overview KPIs and the home "Umumiy qarzdorlik" card. */
  billCount?: number
  paidCount?: number
  paidTotal?: number
  overdueTotal?: number
  billsLoadedAt?: number
}

const REGISTRY_KEY = 'sud-registry-v1'
const LEGACY_RECENT = 'sbl:recent-inns'
const LEGACY_SAVED = 'sud-saved-companies'
const LEGACY_WATCHLIST = 'sud-watchlist'
const RECENT_MAX = 20

function readStore(): Record<string, CompanyRecord> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(REGISTRY_KEY)
    return raw ? (JSON.parse(raw) as Record<string, CompanyRecord>) : {}
  } catch {
    return {}
  }
}

function writeStore(store: Record<string, CompanyRecord>): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(store))
  } catch {
    // quota / private mode — best-effort
  }
}

/** Read the three legacy keys once; merge into a registry map (in memory only). */
function loadLegacyMerged(): Record<string, CompanyRecord> {
  const store: Record<string, CompanyRecord> = {}
  try {
    const recents = JSON.parse(localStorage.getItem(LEGACY_RECENT) || '[]') as { inn: string; lastSearchedAt?: string }[]
    for (const r of recents) {
      if (!r?.inn) continue
      store[r.inn] = {
        ...(store[r.inn] || {}),
        stir: r.inn,
        lastVisitedAt: r.lastSearchedAt ? Date.parse(r.lastSearchedAt) || undefined : undefined,
      }
    }
  } catch { /* ignore */ }
  try {
    const saved = JSON.parse(localStorage.getItem(LEGACY_SAVED) || '[]') as { tin: string; name?: string; savedAt?: number }[]
    for (const c of saved) {
      if (!c?.tin) continue
      store[c.tin] = {
        ...(store[c.tin] || {}),
        stir: c.tin,
        ...(c.name && !store[c.tin]?.name ? { name: c.name } : {}),
        savedForHearings: true,
      }
    }
  } catch { /* ignore */ }
  try {
    const watched = JSON.parse(localStorage.getItem(LEGACY_WATCHLIST) || '[]') as { tin: string; name?: string; addedAt?: number }[]
    for (const w of watched) {
      if (!w?.tin) continue
      store[w.tin] = {
        ...(store[w.tin] || {}),
        stir: w.tin,
        ...(w.name && !store[w.tin]?.name ? { name: w.name } : {}),
        watched: true,
        watchedAt: w.addedAt,
      }
    }
  } catch { /* ignore */ }
  return store
}

let migrated = false

function ensureMigrated(): Record<string, CompanyRecord> {
  if (!migrated && typeof window !== 'undefined') {
    migrated = true
    if (!localStorage.getItem(REGISTRY_KEY)) {
      const merged = loadLegacyMerged()
      if (Object.keys(merged).length > 0) writeStore(merged)
    }
  }
  return readStore()
}

// ---- selectors ---------------------------------------------------------------

export function allRecords(): CompanyRecord[] {
  return Object.values(ensureMigrated())
}

export function getRecord(stir: string): CompanyRecord | null {
  return ensureMigrated()[stir] ?? null
}

export function recents(): CompanyRecord[] {
  return allRecords()
    .filter((r) => r.lastVisitedAt)
    .sort((a, b) => (b.lastVisitedAt || 0) - (a.lastVisitedAt || 0))
    .slice(0, RECENT_MAX)
}

export function watched(): CompanyRecord[] {
  return allRecords()
    .filter((r) => r.watched)
    .sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0))
}

export function savedForHearings(): CompanyRecord[] {
  return allRecords().filter((r) => r.savedForHearings)
}

// ---- mutations ------------------------------------------------------------------

function mutate(stir: string, patch: (r: CompanyRecord) => CompanyRecord): void {
  const store = ensureMigrated()
  const current = store[stir] || { stir }
  store[stir] = patch(current)
  writeStore(store)
}

export function upsertRegistry(stir: string, name?: string): void {
  mutate(stir, (r) => ({
    ...r,
    stir,
    ...(name && !r.name ? { name } : {}),
    lastVisitedAt: Date.now(),
  }))
}

export function updateName(stir: string, name: string): void {
  mutate(stir, (r) => ({ ...r, name }))
}

export function setWatched(stir: string, name: string | undefined, on: boolean): void {
  mutate(stir, (r) => ({
    ...r,
    watched: on,
    ...(name ? { name: r.name ?? name } : {}),
    watchedAt: on ? Date.now() : r.watchedAt,
  }))
}

export function setSavedForHearings(stir: string, name: string | undefined, on: boolean): void {
  mutate(stir, (r) => ({
    ...r,
    savedForHearings: on,
    ...(name ? { name: r.name ?? name } : {}),
  }))
}

/** Drop the recent-visit stamp (keeps watchlist / saved flags intact). */
export function removeRecent(stir: string): void {
  const store = ensureMigrated()
  const rec = store[stir]
  if (!rec) return
  delete rec.lastVisitedAt
  writeStore(store)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sud:registry-changed'))
}

/** Merge-patch the cached display meta for a company (best-effort). */
export function patchMeta(stir: string, patch: CompanyMeta): void {
  if (typeof window === 'undefined') return
  const store = ensureMigrated()
  const rec = store[stir]
  if (!rec) return
  rec.meta = { ...(rec.meta || {}), ...patch }
  writeStore(store)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sud:registry-changed'))
}

export function removeRecord(stir: string): void {
  const store = ensureMigrated()
  delete store[stir]
  writeStore(store)
}

/** Is this company watched? */
export function isWatched(stir: string): boolean {
  return !!getRecord(stir)?.watched
}
