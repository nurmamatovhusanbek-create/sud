/**
 * Unified localStorage list helpers — v150 P2 extraction from page.tsx.
 * Replaces three parallel implementations (loadRecent/saveRecent,
 * loadSavedCompanies/saveCompany, loadWatchlist/saveWatchlistEntry)
 * with one generic "named localStorage list" helper.
 */

const RECENT_KEY = 'sbl:recent-inns'
const RECENT_MAX = 5
const SAVED_COMPANIES_KEY = 'sud-saved-companies'
const WATCHLIST_KEY = 'sud-watchlist'

// ---- Generic helper ----

function loadList<T>(key: string): T[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T[]) : []
  } catch {
    return []
  }
}

function saveList<T>(key: string, items: T[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(items))
  } catch {
    // Quota exceeded / private mode — silently ignore
  }
}

// ---- Recent STIRs (Bills tab) ----

interface RecentEntry { inn: string; lastSearchedAt: string }

export function loadRecent(): RecentEntry[] {
  return loadList<RecentEntry>(RECENT_KEY)
}

export function saveRecent(items: RecentEntry[]): void {
  saveList(RECENT_KEY, items)
}

export function upsertRecent(inn: string): void {
  const items = loadRecent().filter((r) => r.inn !== inn)
  items.unshift({ inn, lastSearchedAt: new Date().toISOString() })
  saveRecent(items.slice(0, RECENT_MAX))
}

export function removeRecent(inn: string): void {
  saveRecent(loadRecent().filter((r) => r.inn !== inn))
}

// ---- Saved companies (Hearings tab) ----

interface SavedCompany { tin: string; name: string; savedAt: number }

export function loadSavedCompanies(): SavedCompany[] {
  return loadList<SavedCompany>(SAVED_COMPANIES_KEY)
}

export function saveCompany(company: SavedCompany): void {
  const list = loadSavedCompanies()
  if (!list.find((c) => c.tin === company.tin)) {
    list.unshift(company)
    saveList(SAVED_COMPANIES_KEY, list)
  }
}

export function removeSavedCompanyFn(tin: string): void {
  saveList(SAVED_COMPANIES_KEY, loadSavedCompanies().filter((c) => c.tin !== tin))
}

// ---- Watchlist (Watchlist tab) ----

interface WatchlistEntry { tin: string; name: string; addedAt: number }

export function loadWatchlist(): WatchlistEntry[] {
  return loadList<WatchlistEntry>(WATCHLIST_KEY)
}

export function saveWatchlistEntry(e: WatchlistEntry): void {
  const list = loadWatchlist()
  if (!list.find((c) => c.tin === e.tin)) {
    list.unshift(e)
    saveList(WATCHLIST_KEY, list)
  }
}

export function removeWatchlistEntry(tin: string): void {
  saveList(WATCHLIST_KEY, loadWatchlist().filter((c) => c.tin !== tin))
}

export { RECENT_KEY, SAVED_COMPANIES_KEY, WATCHLIST_KEY }
export type { RecentEntry, SavedCompany, WatchlistEntry }
