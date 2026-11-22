import 'server-only'
import zlib from 'node:zlib'
import { bucketAad, bucketId, open, sha256, type ManifestV2 } from './backup-crypto'
import { getDb } from './db'
import { parseBucket } from './db-buckets'
import { getFileBytes } from './telegram-client'
import { readCatalog } from './telegram-catalog'

/**
 * The LOCATOR: «where is case 2-1004-2603/8020, who owns bill 260880770031?» answered from the Telegram copy WITHOUT loading any company. The backup
 * carries one small `index:<tin>` bucket per company (every case number with its court and registration year, every bill number with its year and
 * the case it names). Reading the catalog downloads the index buckets that changed (the others are kept: same bucket id) into the local `locator`
 * table; a search is then a prefix lookup in that table, a few milliseconds, with no request to Telegram or to any site. The table holds only keys and
 * pointers; the data itself stays in Telegram until the company is loaded.
 */

export interface SyncResult {
  shards: number
  downloaded: number
  rows: number
}

export async function syncIndex(token: string, m: ManifestV2, key: Buffer): Promise<{ ok: true; value: SyncResult } | { ok: false; error: string }> {
  const db = getDb()
  const have = new Map<string, string>()
  for (const r of db.prepare('SELECT tin, id FROM locator_shards').all()) have.set(String(r.tin), String(r.id))
  const wanted = m.buckets.filter((b) => parseBucket(b.name)?.kind === 'index')
  let downloaded = 0
  for (const b of wanted) {
    const tin = parseBucket(b.name)!.tin!
    if (have.get(tin) === b.id) continue
    const gz: Buffer[] = []
    for (let i = 0; i < b.parts.length; i++) {
      const p = b.parts[i]!
      const f = await getFileBytes(token, p.fileId)
      if (!f.ok) return { ok: false, error: `Indeksni olib boʻlmadi: ${f.error}` }
      if (f.value.length !== p.size || sha256(f.value) !== p.sha256) return { ok: false, error: 'Indeks boʻlagi shikastlangan (hash mos kelmadi)' }
      try {
        gz.push(open(key, f.value, bucketAad(b.id, i)))
      } catch {
        return { ok: false, error: 'Indeks boʻlagini ochib boʻlmadi' }
      }
    }
    const text = zlib.gunzipSync(Buffer.concat(gz))
    if (bucketId(key, text) !== b.id) return { ok: false, error: 'Indeks mazmuni id ga mos kelmadi' }
    const rows = text.toString('utf8').split('\n').filter(Boolean)
    db.transaction(() => {
      db.prepare('DELETE FROM locator WHERE tin = ?').run(tin)
      const ins = db.prepare('INSERT OR REPLACE INTO locator (kind, key, tin, court, year, ref) VALUES (?, ?, ?, ?, ?, ?)')
      for (const l of rows) {
        const r = JSON.parse(l) as [string, string, string | number, string | number]
        if (r[0] === 'c') ins.run('c', r[1], tin, String(r[2]), Number(r[3]), '')
        else if (r[0] === 'b') ins.run('b', r[1], tin, '', Number(r[2]), String(r[3] ?? ''))
      }
      db.prepare('INSERT OR REPLACE INTO locator_shards (tin, id, rows, at) VALUES (?, ?, ?, ?)').run(tin, b.id, rows.length, Date.now())
    })
    downloaded++
  }
  // a company the newest manifest no longer lists has no locator any more
  const alive = new Set(wanted.map((b) => parseBucket(b.name)!.tin!))
  for (const tin of have.keys()) {
    if (alive.has(tin)) continue
    db.transaction(() => {
      db.prepare('DELETE FROM locator WHERE tin = ?').run(tin)
      db.prepare('DELETE FROM locator_shards WHERE tin = ?').run(tin)
    })
  }
  const rows = Number(db.prepare('SELECT COALESCE(SUM(rows), 0) n FROM locator_shards').get()?.n ?? 0)
  return { ok: true, value: { shards: wanted.length, downloaded, rows } }
}

export interface LocatorHit {
  kind: 'company' | 'case' | 'bill'
  /** the case number, the bill number or the tin */
  key: string
  tin: string
  /** case: its court type; for a bill, empty */
  court: string
  /** registration year (case, 2-digit) or issue year (bill); 0 = unknown */
  year: number
  /** a bill: the case it names */
  caseNumber: string
  /** the company's data is in the local database already (no load needed) */
  loaded: boolean
  /** a company: what the channel holds */
  bills?: number
  found?: number
}

export interface LocatorResult {
  hits: LocatorHit[]
  /** rows in the local locator and companies that have one */
  indexed: number
  companies: number
}

const CASE_LIKE = /^\d+-[\d-]*\/?\d*$|^\d+-\d+-\d+\/\d*$/
const upper = (p: string) => `${p}￿`

/** prefix search over what the last catalog read brought (local database only: no Telegram, no site) */
export function searchLocator(raw: string, limit = 30): LocatorResult {
  const db = getDb()
  const q = raw.trim().slice(0, 40)
  const out: LocatorHit[] = []
  const loadedCache = new Map<string, boolean>()
  const loaded = (tin: string): boolean => {
    let v = loadedCache.get(tin)
    if (v === undefined) {
      v = !!db.prepare('SELECT 1 FROM bills WHERE tin = ? LIMIT 1').get(tin)
      loadedCache.set(tin, v)
    }
    return v
  }
  if (q.length >= 3) {
    const digits = /^\d+$/.test(q)
    if (digits && q.length <= 9) {
      for (const c of readCatalog()?.companies ?? []) {
        if (c.tin.startsWith(q) && out.length < limit) out.push({ kind: 'company', key: c.tin, tin: c.tin, court: '', year: 0, caseNumber: '', loaded: loaded(c.tin), bills: c.bills, found: c.found })
      }
    }
    if (digits && q.length >= 6) {
      for (const r of db.prepare("SELECT key, tin, year, ref FROM locator WHERE kind = 'b' AND key >= ? AND key < ? ORDER BY key LIMIT ?").all(q, upper(q), limit)) {
        out.push({ kind: 'bill', key: String(r.key), tin: String(r.tin), court: '', year: Number(r.year), caseNumber: String(r.ref), loaded: loaded(String(r.tin)) })
      }
    }
    if (CASE_LIKE.test(q)) {
      for (const r of db.prepare("SELECT key, tin, court, year FROM locator WHERE kind = 'c' AND key >= ? AND key < ? ORDER BY key LIMIT ?").all(q, upper(q), limit)) {
        out.push({ kind: 'case', key: String(r.key), tin: String(r.tin), court: String(r.court), year: Number(r.year), caseNumber: String(r.key), loaded: loaded(String(r.tin)) })
      }
    }
  }
  const s = db.prepare('SELECT COALESCE(SUM(rows), 0) n, COUNT(*) c FROM locator_shards').get()
  return { hits: out.slice(0, limit), indexed: Number(s?.n ?? 0), companies: Number(s?.c ?? 0) }
}
