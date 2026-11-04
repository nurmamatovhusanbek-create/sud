/**
 * One company registry keyed by STIR (arch guide §3.6, A6) — replaces the
 * three parallel localStorage lists (recents / saved-for-hearings / watchlist)
 * whose shapes never agreed on what "a company" is.
 *
 * Legacy migration: the three old keys are read ONCE, merged, and written
 * into the new store; the old keys are left untouched for rollback.
 */

import { evictCaches } from './cache'

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

/** One upcoming hearing as cached in the registry (compact). */
export interface UpcomingHearing {
  iso: string
  court?: string
  caseNumber?: string
  time?: string
  judge?: string
}

/** Display meta cached from previous visits — feeds home cards / KPIs / badges. */
export interface CompanyMeta {
  status?: string
  rating?: string | null
  score?: number | null
  /** when the rating above was read from chamber (ms). An answer carrying an OLDER reading (a day-old snapshot) never
   *  replaces it, so a fresh rating cannot be rolled back by a slower, staler answer. */
  ratingAt?: number
  cases?: number
  winRate?: number
  /** ISO date of the next scheduled hearing, when known. */
  nextHearingIso?: string
  nextHearingCourt?: string
  nextHearingCase?: string
  nextHearingTime?: string
  nextHearingJudge?: string
  /** EVERY upcoming hearing (nearest first, capped) — `nextHearing*` alone is one per company and undercounts when a
   *  company has several hearings in the window (alerts, bell, home KPI). */
  upcoming?: UpcomingHearing[]
  /** The company's cases in the compact shape the orders check needs (n = case number, t = court type, r = result,
   *  s = status). Written whenever the stats are read, so «what needs its orders looked up» can be worked out from
   *  here at any time WITHOUT scraping the company again. */
  orderCases?: { n: string; t: string; r?: string; s?: string }[]
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

/**
 * Persist the registry. It is the ONLY copy of the watchlist (no server database), so a full localStorage must never
 * silently drop it: on a quota error make room in this order — (1) the 5-minute response caches (re-fetchable),
 * (2) the compact case lists of companies that are NOT watched (re-derivable) — and only then give up, loudly
 * (`sud:storage-full`, shown as a toast by the shell) instead of losing changes without a word.
 */
export function writeStore(store: Record<string, CompanyRecord>): void {
  if (typeof window === 'undefined') return
  const attempt = (): boolean => {
    try {
      localStorage.setItem(REGISTRY_KEY, JSON.stringify(store))
      return true
    } catch {
      return false
    }
  }
  let ok = attempt()
  if (!ok) {
    evictCaches(1)
    ok = attempt()
  }
  if (!ok) {
    for (const rec of Object.values(store)) if (!rec.watched && rec.meta?.orderCases) delete rec.meta.orderCases
    ok = attempt()
  }
  if (!ok) {
    console.warn('[registry] localStorage is full — the latest change could not be saved')
    window.dispatchEvent(new CustomEvent('sud:storage-full'))
    return
  }
  // v204 (P-E): broadcast on EVERY write — setWatched/unwatch previously
  // mutated silently, so the watchlist grid and home KPIs didn't react
  // until an unrelated patchMeta (or a remount) bumped the version.
  window.dispatchEvent(new CustomEvent('sud:registry-changed'))
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

/** A real company name, not the «STIR 123456789» placeholder the server falls back to when no source named the company. */
export function isRealName(n: string | undefined | null): n is string {
  return !!n && n.trim().length > 1 && !/^STIR\s*\d*$/i.test(n.trim())
}

/** What a stats (or company-info) answer tells about the COMPANY itself, as far as the answer has it. */
export interface CompanyFacts {
  company?: { name?: string; shortName?: string; officialName?: string; status?: string } | null
  rating?: { category?: string | null; score?: unknown } | null
}

/**
 * Write what an answer says about the company into the registry: its NAME (cards show «STIR …» until this runs),
 * its status and its chamber RATING. These come from independent sources (orginfo, chamber) and are valid even when a
 * COURT site failed, so they are written from partial answers too; a source that did not answer never erases what an
 * earlier one learned (an absent field is simply not in the patch). `at` = when the answer's data was read from the
 * source (ms; a snapshot's `fetchedAt`): the rating carries it so an older reading cannot overwrite a newer one.
 */
export function companyFactsPatch(d: CompanyFacts, at?: number): { name?: string; meta: CompanyMeta } {
  const c = d.company ?? undefined
  const name = [c?.shortName, c?.officialName, c?.name].find(isRealName)
  const meta: CompanyMeta = {}
  if (c?.status) meta.status = c.status
  const cat = d.rating?.category
  // chamber answers «-» with a 0 score for a company it has no category for: that is no rating
  if (cat && cat !== '-') {
    meta.rating = cat
    if (typeof d.rating?.score === 'number') meta.score = d.rating.score
    // when this reading was taken (0 = unknown: it loses against any reading with a known time)
    meta.ratingAt = at ?? 0
  }
  return { ...(name ? { name: name.trim() } : {}), meta }
}

/** Patch a company's registry record (name and/or meta) in ONE write; only a record that exists is touched. */
export function patchRecord(stir: string, patch: { name?: string; meta?: CompanyMeta }): void {
  if (typeof window === 'undefined') return
  const store = ensureMigrated()
  const rec = store[stir]
  if (!rec) return
  let meta = patch.meta
  // a rating read EARLIER than the one we hold (the stats of a day-old snapshot arriving after the fast chamber read)
  // must not roll it back
  if (meta && meta.ratingAt !== undefined && rec.meta?.ratingAt !== undefined && rec.meta.ratingAt > meta.ratingAt) {
    const { rating: _r, score: _s, ratingAt: _t, ...rest } = meta
    meta = rest
  }
  const nameChanged = !!patch.name && rec.name !== patch.name
  const metaChanged = !!meta && Object.entries(meta).some(([k, v]) => v !== undefined && (rec.meta as Record<string, unknown> | undefined)?.[k] !== v)
  if (!nameChanged && !metaChanged) return
  if (nameChanged) rec.name = patch.name
  if (meta) rec.meta = { ...(rec.meta || {}), ...meta }
  writeStore(store)
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

const MAX_UPCOMING = 30

/** The registry patch for a company's upcoming-hearing list (nearest first). One place, used wherever hearings are read. */
export function hearingMetaPatch(hearings: Record<string, unknown>[]): Partial<CompanyMeta> {
  const upcoming: UpcomingHearing[] = hearings
    .filter((h) => typeof h?.isoDate === 'string' && h.isoDate)
    .map((h) => ({
      iso: h.isoDate as string,
      court: (h.courtName as string) || (h.courtTypeLabel as string) || undefined,
      caseNumber: (h.caseNumber as string) || undefined,
      time: (h.hearingTime as string) || undefined,
      judge: (h.judge as string) || undefined,
    }))
    .sort((a, b) => a.iso.localeCompare(b.iso) || (a.time || '').localeCompare(b.time || ''))
    .slice(0, MAX_UPCOMING)
  const first = upcoming[0]
  return {
    upcoming,
    nextHearingIso: first?.iso,
    nextHearingCourt: first?.court,
    nextHearingCase: first?.caseNumber,
    nextHearingTime: first?.time,
    nextHearingJudge: first?.judge,
  }
}

/** All the cached upcoming hearings of a company; older cache entries only have the single `nextHearing*`. */
export function upcomingOf(meta: CompanyMeta | undefined): UpcomingHearing[] {
  if (!meta) return []
  if (meta.upcoming) return meta.upcoming
  return meta.nextHearingIso
    ? [{ iso: meta.nextHearingIso, court: meta.nextHearingCourt, caseNumber: meta.nextHearingCase, time: meta.nextHearingTime, judge: meta.nextHearingJudge }]
    : []
}

/** Whole days from today (local) to an ISO date; negative = past. */
export function daysUntilIso(iso: string, now = Date.now()): number | null {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return Math.ceil((new Date(y, m - 1, d).getTime() - now) / 86_400_000) || 0 // (no -0)
}

/** The cached hearings that are still ahead (today included) — a stale «next hearing» that has passed is not upcoming. */
export function futureUpcoming(meta: CompanyMeta | undefined, now = Date.now()): UpcomingHearing[] {
  return upcomingOf(meta).filter((h) => {
    const d = daysUntilIso(h.iso, now)
    return d !== null && d >= 0
  })
}

const MAX_ORDER_CASES = 400

/** The registry patch for a company's cases (see CompanyMeta.orderCases). */
export function orderCasesPatch(cases: { caseNumber: string; courtType: string; result?: string; caseStatus?: string }[] | undefined): Partial<CompanyMeta> {
  if (!cases) return {}
  return {
    orderCases: cases
      .filter((c) => c.caseNumber)
      .slice(0, MAX_ORDER_CASES)
      .map((c) => ({ n: c.caseNumber, t: c.courtType, ...(c.result ? { r: c.result } : {}), ...(c.caseStatus ? { s: c.caseStatus } : {}) })),
  }
}

/** Cached cases back in the shape the orders API takes. */
export function orderCasesOf(meta: CompanyMeta | undefined): { caseNumber: string; courtType: string; result: string; caseStatus: string }[] {
  return (meta?.orderCases ?? []).map((c) => ({ caseNumber: c.n, courtType: c.t, result: c.r ?? '', caseStatus: c.s ?? '' }))
}
