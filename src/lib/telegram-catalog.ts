import { getDb } from './db'
import { parseBucket } from './db-buckets'
import type { ManifestV2 } from './backup-crypto'

/**
 * What the Telegram channel holds, per company, as last seen (written after every backup and every «Kanaldagi kompaniyalar»). It is kept in the
 * local database so the app can say «this company is already in Telegram» BEFORE it scrapes the sites for it, without asking for the passphrase.
 * Only counts and the two dates; nothing of the data itself.
 */

export interface CatalogEntry {
  tin: string
  /** the company's first-scrape date and the «as of» date of its last complete bills load, as in that backup (0 = unknown) */
  firstAt: number
  refreshedAt: number
  bills: number
  found: number
}

export interface Catalog {
  /** when the manifest it was read from was made (ISO) */
  backupAt: string
  companies: CatalogEntry[]
}

export function buildCatalog(m: ManifestV2): Catalog {
  const by = new Map<string, CatalogEntry>()
  const co = (tin: string): CatalogEntry => by.get(tin) ?? by.set(tin, { tin, firstAt: m.companies[tin]?.firstAt ?? 0, refreshedAt: m.companies[tin]?.refreshedAt ?? 0, bills: 0, found: 0 }).get(tin)!
  for (const b of m.buckets) {
    const p = parseBucket(b.name)
    if (!p?.tin) continue
    if (p.kind === 'bills') co(p.tin).bills += b.rows
    else if (p.kind === 'found') co(p.tin).found += b.rows
    else co(p.tin)
  }
  return { backupAt: m.created, companies: [...by.values()].sort((a, b) => b.bills - a.bills) }
}

export function saveCatalog(c: Catalog): void {
  getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run('telegram_catalog', JSON.stringify(c))
}

export function readCatalog(): Catalog | null {
  try {
    const r = getDb().prepare("SELECT v FROM meta WHERE k = 'telegram_catalog'").get()
    const c = r ? (JSON.parse(String(r.v)) as Catalog) : null
    return c && Array.isArray(c.companies) ? c : null
  } catch {
    return null
  }
}

export const catalogFor = (tin: string): CatalogEntry | null => readCatalog()?.companies.find((c) => c.tin === tin) ?? null
