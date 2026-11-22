import { getDb, type Db, type SqlValue } from './db'
import { courtTypeOfNumber, registeredKey } from '@/core/bill-cases'
import { feedRows, feedTins } from './case-store'

/**
 * The database cut into BUCKETS for the Telegram backup: stable, small, deterministic pieces, so that a bucket whose rows did not change has the
 * same bytes (and the same hash) next time and is not uploaded again. A bucket is named by what it holds:
 *   bills:<tin>:<year>            the company's bills issued that year (0 = no date)
 *   found:<tin>:<court>:<year>    cases found by number for the company, by registration year (0 = unreadable number)
 *   details:<court>:<year>        full cases, by registration year
 *   tried:<tin>                   the case numbers already asked
 *   state:<tin>                   the company's load state and its two dates
 *   lists:<tin>                   the rows of the company's TIN lists (what the courts' list endpoints showed: status, parties…), kept as files by the
 *                                 app, not in the database; read by the bot, never imported (the lists are fetched again from the courts)
 *   index:<tin>                   the LOCATOR of the company: every case number and bill number with the court/year of the bucket that holds it (never
 *                                 imported into a database: it is read by the search, `lib/telegram-index`)
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

/** a bill without a case is not kept, so it is not in a backup either (the database has none after migration 5; this is the same rule for rows that arrive otherwise) */
const WITH_CASE = "case_number IS NOT NULL AND case_number != ''"
const yearOfMs = (c: string) => `CAST(strftime('%Y', ${c} / 1000, 'unixepoch') AS INTEGER)`

export type BucketKind = 'bills' | 'found' | 'details' | 'tried' | 'state' | 'index' | 'lists'
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
    case 'index': return p.length === 2 ? { kind: 'index', tin: p[1]!, court: null, year: null } : null
    case 'lists': return p.length === 2 ? { kind: 'lists', tin: p[1]!, court: null, year: null } : null
    default: return null
  }
}

/** every bucket the database has, in a fixed order (companies first, then case details) */
export function listBuckets(db: Db = getDb()): string[] {
  const out: string[] = []
  const tins = new Set<string>()
  for (const t of ['bills', 'found_cases', 'tried', 'bill_loads', 'companies']) for (const r of db.prepare(`SELECT DISTINCT tin FROM ${t}`).all()) tins.add(String(r.tin))
  const listed = new Set(feedTins())
  for (const t of listed) tins.add(t)
  for (const tin of [...tins].sort()) {
    if (db.prepare('SELECT 1 FROM bill_loads WHERE tin = ?').get(tin) || db.prepare('SELECT 1 FROM companies WHERE tin = ?').get(tin)) out.push(`state:${tin}`)
    if (db.prepare('SELECT 1 FROM tried WHERE tin = ? LIMIT 1').get(tin)) out.push(`tried:${tin}`)
    if (listed.has(tin) && feedRows(tin).length) out.push(`lists:${tin}`)
    if (db.prepare(`SELECT 1 FROM bills WHERE tin = ? AND ${WITH_CASE} LIMIT 1`).get(tin) || db.prepare('SELECT 1 FROM found_cases WHERE tin = ? LIMIT 1').get(tin) || (listed.has(tin) && feedRows(tin).length)) out.push(`index:${tin}`)
    for (const r of db.prepare(`SELECT DISTINCT COALESCE(${yearOfMs('issued')}, 0) y FROM bills WHERE tin = ? AND ${WITH_CASE} ORDER BY y`).all(tin)) out.push(`bills:${tin}:${Number(r.y)}`)
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
      take(db.prepare(`SELECT ${list(BILL)} FROM bills WHERE tin = ? AND ${WITH_CASE} AND ${where} ORDER BY number`).all(...(b.year === 0 ? [b.tin] : [b.tin, b.year])), BILL)
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
    case 'lists': {
      for (const r of feedRows(b.tin!)) lines.push(line([r.court, r.num, JSON.stringify(r.row)]))
      break
    }
    case 'index': {
      // cases: found ones (their court and year are exact) and the ones only the bills name; then every bill with the case it names
      const cases = new Map<string, string>()
      const put = (num: string, court: string) => {
        if (!num) return
        const y = registeredKey(num)
        cases.set(num, JSON.stringify(['c', num, court || courtTypeOfNumber(num) || '', y < 0 ? 0 : Math.floor(y / 100)]))
      }
      for (const r of db.prepare('SELECT court, num FROM found_cases WHERE tin = ?').all(b.tin)) put(String(r.num), String(r.court))
      for (const r of feedRows(b.tin!)) if (!cases.has(r.num)) put(r.num, r.court)
      for (const r of db.prepare("SELECT DISTINCT case_number, ctype FROM bills WHERE tin = ? AND case_number IS NOT NULL AND case_number != ''").all(b.tin)) if (!cases.has(String(r.case_number))) put(String(r.case_number), String(r.ctype ?? ''))
      for (const k of [...cases.keys()].sort()) lines.push(cases.get(k)!)
      for (const r of db.prepare("SELECT number, issued, case_number FROM bills WHERE tin = ? AND case_number IS NOT NULL AND case_number != '' ORDER BY number").all(b.tin)) {
        lines.push(line(['b', r.number, r.issued == null ? 0 : new Date(Number(r.issued)).getUTCFullYear(), r.case_number ?? '']))
      }
      break
    }
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
export function importBucket(name: string, text: Uint8Array, db: Db = getDb(), opts: { bills?: 'replace' | 'keep' } = {}): number {
  const b = parseBucket(name)
  if (!b) throw new Error(`noma'lum bo'lak: ${name.slice(0, 40)}`)
  if (b.kind === 'index' || b.kind === 'lists') return 0 // a locator and the court lists are read by the search / the bot, never imported
  const rows = Buffer.from(text).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as SqlValue[])
  let n = 0
  db.transaction(() => {
    switch (b.kind) {
      case 'bills': {
        // into a database that holds a NEWER copy of the company, only the bills it does not have are added; otherwise the bucket wins
        const st = db.prepare(`INSERT OR ${opts.bills === 'keep' ? 'IGNORE' : 'REPLACE'} INTO bills (${list(BILL)}, pass) VALUES (${marks(BILL.length)}, 0)`)
        const caseAt = BILL.indexOf('case_number')
        for (const r of rows) { if (r[caseAt]) n += st.run(...r).changes } // a bill without a case is not kept (owner's decision)
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


// ---- merging two copies of one bucket -----------------------------------------------------------------------------------

/** the row's identity inside a bucket, and its time (rows with a time: the newer copy wins; the others: the LOCAL copy wins) */
function rowKey(kind: BucketKind, r: unknown[]): { key: string; t: number | null } {
  switch (kind) {
    case 'bills': return { key: String(r[1]), t: null }
    case 'found': return { key: String(r[2]), t: Number(r[7]) || 0 }
    case 'details': return { key: String(r[1]), t: Number(r[2]) || 0 }
    case 'tried': return { key: String(r[1]), t: Number(r[2]) || 0 }
    case 'index': return { key: `${r[0]}:${r[1]}`, t: null }
    case 'lists': return { key: `${r[0]}:${r[1]}`, t: null }
    default: return { key: String(r[0]), t: null } // state: «load» / «company» lines
  }
}

/**
 * The union of what the channel already holds for a bucket (`base`) and what this computer holds (`local`): every row of either, a row in both is
 * the newer one (by its own time; no time: the local one), in the bucket's key order. A backup of a computer that has only part of a company's data
 * therefore never takes the rest away from the channel. Returns the text of the merged bucket.
 */
export function mergeBucketText(name: string, base: Uint8Array, local: Uint8Array): Buffer {
  const b = parseBucket(name)
  if (!b) throw new Error('noma\'lum bo\'lak')
  const rows = new Map<string, { line: string; t: number | null }>()
  const take = (text: Uint8Array, isLocal: boolean) => {
    for (const line of Buffer.from(text).toString('utf8').split('\n')) {
      if (!line) continue
      let r: unknown[]
      try { r = JSON.parse(line) as unknown[] } catch { continue }
      // a bill without a case (an older backup holds many) is dropped: it is not kept any more
      if (b.kind === 'bills' && !r[BILL.indexOf('case_number')]) continue
      if (b.kind === 'index' && r[0] === 'b' && !r[3]) continue
      const { key, t } = rowKey(b.kind, r)
      const have = rows.get(key)
      if (!have || (t !== null && have.t !== null ? t >= have.t : isLocal)) rows.set(key, { line, t })
    }
  }
  take(base, false)
  take(local, true)
  // the order `renderBucket` writes: by key (case numbers, bill numbers: plain ASCII, so code-unit order is the database's order)
  const order = (e: [string, { line: string }]) => (b.kind === 'index' ? (e[0].startsWith('c:') ? `0${e[0]}` : `1${e[0]}`) : e[0])
  const lines = [...rows.entries()].sort((x, y) => (order(x) < order(y) ? -1 : order(x) > order(y) ? 1 : 0)).map((e) => e[1].line)
  return Buffer.from(lines.join('\n') + '\n')
}
