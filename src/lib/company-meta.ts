import { getDb } from './db'

/**
 * Two dates per company, the base of every refresh (nothing refreshes by itself; the operator presses a button):
 *  - `firstAt`      when the FIRST scrape of this company began. Set once, never moved.
 *  - `refreshedAt`  when the last COMPLETE bills load began, i.e. the data is «as of» that moment (a load that was stopped half way does not count).
 *  - `lastAdded`    how many bills that refresh found that were not stored before (what the refresh was worth).
 * A company stored before these dates existed gets them from its bills load: `firstAt = refreshedAt = the last page's time`.
 */

export interface CompanyMeta {
  tin: string
  firstAt: number
  refreshedAt: number
  lastAdded: number
}

export function readCompany(tin: string): CompanyMeta | null {
  const db = getDb()
  const r = db.prepare('SELECT * FROM companies WHERE tin = ?').get(tin)
  if (r) return { tin, firstAt: Number(r.first_at), refreshedAt: Number(r.refreshed_at), lastAdded: Number(r.last_added) }
  const l = db.prepare('SELECT complete, loaded_at FROM bill_loads WHERE tin = ?').get(tin)
  if (l && Number(l.loaded_at) > 0) return { tin, firstAt: Number(l.loaded_at), refreshedAt: Number(l.complete) === 1 ? Number(l.loaded_at) : 0, lastAdded: 0 }
  return null
}

/** the first scrape begins now (a no-op when the company already has its first date) */
export function ensureCompany(tin: string, now: number): void {
  getDb().prepare('INSERT OR IGNORE INTO companies (tin, first_at) VALUES (?, ?)').run(tin, now)
}

/** a complete load that BEGAN at `startedAt` is finished: the data is as of then */
export function markRefreshed(tin: string, startedAt: number, added: number): void {
  const db = getDb()
  ensureCompany(tin, startedAt)
  db.prepare('UPDATE companies SET refreshed_at = ?, last_added = ? WHERE tin = ?').run(startedAt, Math.max(0, added), tin)
}
