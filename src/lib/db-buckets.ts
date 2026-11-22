import { getDb, type Db, type SqlValue } from './db'

/**
 * The database cut into BUCKETS for the Telegram backup: stable, small, deterministic pieces, so that a bucket whose rows did not change has the
 * same bytes (and the same hash) next time and is not uploaded again. A bucket is named by what it holds:
 *   bills:<tin>:<year>            the company's bills issued that year (0 = no date)
 *   found:<tin>:<court>:<year>    cases found by number for the company, by registration year (0 = unreadable number)
 *   details:<court>:<year>        full cases, by registration year
 *   tried:<tin>                   the case numbers already asked
 *   state:<tin>                   the company's load state and its two dates
 * Text of a bucket: one JSON array per row, rows in primary-key order, binary columns as base64. The bills' `pass` counter is left out (it moves on
 * every refresh and would make every bill «changed»); an imported bill gets pass 0.
 * `importBucket` is the way back: INSERT into any database (a restored file, or the live one).
 */

const BILL = ['tin', 'number', 'status', 'issued', 'amount', 'paid', 'must_pay', 'balance', 'overdue', 'cat', 'cat_id', 'court', 'court_id', 'court_type', 'case_number', 'decision', 'descr', 'payer', 'payer_tin', 'in_favor', 'account', 'ctype', 'kind', 'yymm', 'hay'] as const
const FOUND = ['court', 'tin', 'num', 'yymm', 'status', 'hay', 'row', 't'] as const
const TRIED = ['tin', 'num', 't', 'found'] as const
const DETAIL = ['court', 'num', 't', 'd'] as const
const LOAD = ['tin', 'total_elements', 'total_pages', 'page_size', 'pass', 'pages_done', 'complete', 'stable', 'loaded_at'] as const
const CO = ['tin', 'first_at', 'refreshed_at', 'last_added'] as const

const list = (cols: readonly string[]) => cols.join(', ')
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ')

const yearOfMs = (c: string) => `CAST(strftime('%Y', ${c} / 1000, 'unixepoch') AS INTEGER)`

export type BucketKind = 'bills' | 'found' | 'details' | 'tried' | 'state'
export interface BucketName {
  kind: BucketKind
  tin: string | null
  court: string | null
  year: number | null
}

export function parseBucket(name: string): BucketName | null {
  const p = name.split(':')
  switch (p[0]) {
    case 'bills': return p.length === 3 ? { kind: 'bills', tin: p[1]!, court: null, year: Number(p[2]) } : null
    case 'found': return p.length === 4 ? { kind: 'found', tin: p[1]!, court: p[2]!, year: Number(p[3]) } : null
    case 'details': return p.length === 3 ? { kind: 'details', tin: null, court: p[1]!, year: Number(p[2]) } : null
    case 'tried': return p.length === 2 ? { kind: 'tried', tin: p[1]!, court: null, year: null } : null
    case 'state': return p.length === 2 ? { kind: 'state', tin: p[1]!, court: null, year: null } : null
    default: return null
  }
}

/** every bucket the database has, in a fixed order (companies first, then case details) */
export function listBuckets(db: Db = getDb()): string[] {
  const out: string[] = []
  const tins = new Set<string>()
  for (const t of ['bills', 'found_cases', 'tried', 'bill_loads', 'companies']) for (const r of db.prepare(`SELECT DISTINCT tin FROM ${t}`).all()) tins.add(String(r.tin))
  for (const tin of [...tins].sort()) {
    if (db.prepare('SELECT 1 FROM bill_loads WHERE tin = ?').get(tin) || db.prepare('SELECT 1 FROM companies WHERE tin = ?').get(tin)) out.push(`state:${tin}`)
    if (db.prepare('SELECT 1 FROM tried WHERE tin = ? LIMIT 1').get(tin)) out.push(`tried:${tin}`)
    for (const r of db.prepare(`SELECT DISTINCT COALESCE(${yearOfMs('issued')}, 0) y FROM bills WHERE tin = ? ORDER BY y`).all(tin)) out.push(`bills:${tin}:${Number(r.y)}`)
    for (const r of db.prepare('SELECT DISTINCT court, CASE WHEN yymm < 0 THEN 0 ELSE yymm / 100 END y FROM found_cases WHERE tin = ? ORDER BY court, y').all(tin)) out.push(`found:${tin}:${r.court}:${Number(r.y)}`)
  }
  for (const r of db.prepare('SELECT DISTINCT court, CASE WHEN yymm < 0 THEN 0 ELSE yymm / 100 END y FROM case_details ORDER BY court, y').all()) out.push(`details:${r.court}:${Number(r.y)}`)
  return out
}

const b64 = (v: unknown): string => (v == null ? '' : Buffer.from(v as Uint8Array).toString('base64'))
const line = (vals: unknown[]): string => JSON.stringify(vals)

export interface RenderedBucket {
  rows: number
  text: Buffer
}

/** the bytes of one bucket (deterministic), or null when it is empty or the name is not one of ours */
export function renderBucket(name: string, db: Db = getDb()): RenderedBucket | null {
  const b = parseBucket(name)
  if (!b) return null
  const lines: string[] = []
  const take = (rows: Record<string, unknown>[], cols: readonly string[], fix?: (c: string, v: unknown) => unknown) => {
    for (const r of rows) lines.push(line(cols.map((c) => (fix ? fix(c, r[c]) : r[c] ?? null))))
  }
  switch (b.kind) {
    case 'bills': {
      const where = b.year === 0 ? 'issued IS NULL' : `${yearOfMs('issued')} = ?`
      take(db.prepare(`SELECT ${list(BILL)} FROM bills WHERE tin = ? AND ${where} ORDER BY number`).all(...(b.year === 0 ? [b.tin] : [b.tin, b.year])), BILL)
      break
    }
    case 'found': {
      const y = b.year!
      const where = y === 0 ? 'yymm < 0' : 'yymm >= ? AND yymm < ?'
      take(db.prepare(`SELECT ${list(FOUND)} FROM found_cases WHERE tin = ? AND court = ? AND ${where} ORDER BY num`).all(...(y === 0 ? [b.tin, b.court] : [b.tin, b.court, y * 100, y * 100 + 100])), FOUND)
      break
    }
    case 'details': {
      const y = b.year!
      const where = y === 0 ? 'yymm < 0' : 'yymm >= ? AND yymm < ?'
      take(db.prepare(`SELECT ${list(DETAIL)} FROM case_details WHERE court = ? AND ${where} ORDER BY num`).all(...(y === 0 ? [b.court] : [b.court, y * 100, y * 100 + 100])), DETAIL, (c, v) => (c === 'd' ? b64(v) : v ?? null))
      break
    }
    case 'tried':
      take(db.prepare(`SELECT ${list(TRIED)} FROM tried WHERE tin = ? ORDER BY num`).all(b.tin), TRIED)
      break
    case 'state': {
      const l = db.prepare(`SELECT ${list(LOAD)} FROM bill_loads WHERE tin = ?`).get(b.tin)
      const c = db.prepare(`SELECT ${list(CO)} FROM companies WHERE tin = ?`).get(b.tin)
      if (l) lines.push(line(['load', ...LOAD.map((k) => l[k] ?? null)]))
      if (c) lines.push(line(['company', ...CO.map((k) => c[k] ?? null)]))
      break
    }
  }
  return lines.length ? { rows: lines.length, text: Buffer.from(lines.join('\n') + '\n') } : null
}

export interface ImportCount {
  rows: number
}

/**
 * Put a bucket's rows into `db`. Existing rows are replaced only when the bucket's row is NEWER (`t` of cases, `loaded_at`/`refreshed_at` of a
 * company); bills carry no time of their own, so for them the bucket wins (a bill's status only moves forward in time). Returns the rows applied.
 */
export function importBucket(name: string, text: Uint8Array, db: Db = getDb()): number {
  const b = parseBucket(name)
  if (!b) throw new Error(`noma'lum bo'lak: ${name.slice(0, 40)}`)
  const rows = Buffer.from(text).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as SqlValue[])
  let n = 0
  db.transaction(() => {
    switch (b.kind) {
      case 'bills': {
        const st = db.prepare(`INSERT OR REPLACE INTO bills (${list(BILL)}, pass) VALUES (${marks(BILL.length)}, 0)`)
        for (const r of rows) { st.run(...r); n++ }
        break
      }
      case 'found': {
        const st = db.prepare(`INSERT INTO found_cases (${list(FOUND)}) VALUES (${marks(FOUND.length)}) ON CONFLICT(court, tin, num) DO UPDATE SET yymm = excluded.yymm, status = excluded.status, hay = excluded.hay, row = excluded.row, t = excluded.t WHERE excluded.t >= found_cases.t`)
        for (const r of rows) { st.run(...r); n++ }
        break
      }
      case 'details': {
        const st = db.prepare('INSERT INTO case_details (court, num, t, d) VALUES (?, ?, ?, ?) ON CONFLICT(court, num) DO UPDATE SET t = excluded.t, d = excluded.d WHERE excluded.t >= case_details.t')
        for (const r of rows) { st.run(r[0], r[1], r[2], new Uint8Array(Buffer.from(String(r[3]), 'base64'))); n++ }
        break
      }
      case 'tried': {
        const st = db.prepare(`INSERT INTO tried (${list(TRIED)}) VALUES (${marks(TRIED.length)}) ON CONFLICT(tin, num) DO UPDATE SET t = excluded.t, found = excluded.found WHERE excluded.t >= tried.t`)
        for (const r of rows) { st.run(...r); n++ }
        break
      }
      case 'state': {
        for (const r of rows) {
          if (r[0] === 'load') {
            db.prepare(`INSERT INTO bill_loads (${list(LOAD)}) VALUES (${marks(LOAD.length)}) ON CONFLICT(tin) DO UPDATE SET total_elements = excluded.total_elements, total_pages = excluded.total_pages, page_size = excluded.page_size, pass = excluded.pass, pages_done = excluded.pages_done, complete = excluded.complete, stable = excluded.stable, loaded_at = excluded.loaded_at WHERE excluded.loaded_at >= bill_loads.loaded_at`).run(...r.slice(1))
            n++
          } else if (r[0] === 'company') {
            // the first date is the EARLIEST of the two, «as of» the latest
            db.prepare(`INSERT INTO companies (${list(CO)}) VALUES (${marks(CO.length)}) ON CONFLICT(tin) DO UPDATE SET first_at = MIN(first_at, excluded.first_at), refreshed_at = MAX(refreshed_at, excluded.refreshed_at), last_added = CASE WHEN excluded.refreshed_at >= companies.refreshed_at THEN excluded.last_added ELSE companies.last_added END`).run(...r.slice(1))
            n++
          }
        }
        break
      }
    }
  })
  return n
}
