/**
 * One-time import of what the app kept in FILES before `sud.db` (`~/.sud-tizimi/cases/`, `CASE_STORE_DIR`) into the database:
 *   `<STIR>.found.json.gz`      → found_cases + tried
 *   `bills/<STIR>/…`            → bills + bill_loads   (`g<pass>-p<page>.json.gz`, or the first version's `p<page>.json.gz`)
 *   `details/<court>/<n>.json.gz` → case_details
 * It COPIES: the old files are never changed, moved or deleted (so the previous version of the app still finds them), and rows already in the
 * database win over an imported one. It runs once (marker `meta.legacy_import`) when the database is opened; a failure is logged and tried
 * again next time. The TIN lists with their ETags (`<STIR>.json.gz`) stay files and are not part of this.
 * Self-contained on purpose: it takes the open `Db` and uses no store, so it can run inside `getDb()`.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { registeredKey, caseHay } from '@/core/bill-cases'
import { billCourtType, categoryKind, type BillRow } from '@/core/bill-rows'
import type { Db } from './db'

const COURTS = new Set(['economic', 'civil', 'criminal', 'administrative'])
const TIN_RE = /^\d{9}$/
const NUMBER_RE = /^\d+-[\d-]+\/\d+$/

export interface ImportReport {
  bills: number
  billLoads: number
  found: number
  tried: number
  details: number
  skipped: number
}

const dirOf = (): string => process.env.CASE_STORE_DIR || path.join(os.homedir(), '.sud-tizimi', 'cases')

function readGz(file: string): unknown {
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'))
  } catch {
    return null
  }
}

const list = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

export function importLegacy(db: Db): ImportReport | null {
  if (db.prepare("SELECT 1 FROM meta WHERE k = 'legacy_import'").get()) return null
  const dir = dirOf()
  const report: ImportReport = { bills: 0, billLoads: 0, found: 0, tried: 0, details: 0, skipped: 0 }
  const names = list(dir)
  if (names.length === 0) {
    db.prepare("INSERT OR REPLACE INTO meta VALUES ('legacy_import', ?)").run(JSON.stringify({ at: Date.now(), ...report }))
    return report
  }

  // ---- found cases + tried
  const fc = db.prepare('INSERT OR IGNORE INTO found_cases (court, tin, num, yymm, status, hay, row, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const tr = db.prepare('INSERT OR IGNORE INTO tried (tin, num, t, found) VALUES (?, ?, ?, ?)')
  for (const n of names) {
    const m = /^(\d{9})\.found\.json\.gz$/.exec(n)
    if (!m) continue
    const raw = readGz(path.join(dir, n)) as { courts?: Record<string, unknown[]>; tried?: Record<string, { t?: number; found?: boolean }> } | null
    if (!raw) { report.skipped++; continue }
    db.transaction(() => {
      for (const [court, rows] of Object.entries(raw.courts ?? {})) {
        if (!COURTS.has(court) || !Array.isArray(rows)) continue
        for (const r of rows as Array<Record<string, string>>) {
          if (!r?.caseNumber || !NUMBER_RE.test(r.caseNumber)) continue
          fc.run(court, m[1], r.caseNumber, registeredKey(r.caseNumber), String(r.caseStatus ?? ''), caseHay(r as never), JSON.stringify(r), Date.now())
          report.found++
        }
      }
      for (const [num, v] of Object.entries(raw.tried ?? {})) {
        if (NUMBER_RE.test(num)) { tr.run(m[1], num, Number(v?.t) || 0, v?.found ? 1 : 0); report.tried++ }
      }
    })
  }

  // ---- bills
  const BILL_COLS = 'tin, number, pass, status, issued, amount, paid, must_pay, balance, overdue, cat, cat_id, court, court_id, court_type, case_number, decision, descr, payer, payer_tin, in_favor, account, ctype, kind, yymm, hay'
  const bi = db.prepare(`INSERT OR IGNORE INTO bills (${BILL_COLS}) VALUES (${BILL_COLS.split(',').map(() => '?').join(', ')})`)
  for (const tin of list(path.join(dir, 'bills'))) {
    if (!TIN_RE.test(tin)) continue
    const bdir = path.join(dir, 'bills', tin)
    for (const f of list(bdir).sort()) {
      const m = /^(?:g(\d{3})-)?p(\d{4})\.json\.gz$/.exec(f)
      if (!m) continue
      const rows = readGz(path.join(bdir, f))
      if (!Array.isArray(rows)) { report.skipped++; continue }
      const pass = m[1] ? Number(m[1]) : 0
      db.transaction(() => {
        for (const r of rows as BillRow[]) {
          if (!r?.number) continue
          bi.run(
            tin, r.number, pass, r.status ?? '', r.issued ?? null, r.amount ?? null, r.paid ?? null, r.mustPay ?? null, r.balance ?? null, r.overdue ?? null,
            r.cat ?? '', r.catId ?? null, r.court ?? '', r.courtId ?? null, r.courtType ?? '', r.caseNumber ?? null, r.decision ?? null, r.desc ?? '',
            r.payer ?? '', r.payerTin ?? '', r.inFavor === null || r.inFavor === undefined ? null : r.inFavor ? 1 : 0, r.account ?? '',
            billCourtType(r), categoryKind(r), r.caseNumber ? registeredKey(r.caseNumber) : -1, `${r.court ?? ''} ${r.desc ?? ''}`.toLowerCase(),
          )
          report.bills++
        }
      })
    }
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(bdir, 'meta.json'), 'utf8')) as Record<string, unknown>
      db.prepare(
        `INSERT OR IGNORE INTO bill_loads (tin, total_elements, total_pages, page_size, pass, pages_done, complete, stable, loaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(tin, Number(meta.totalElements) || 0, Number(meta.totalPages) || 0, Number(meta.pageSize) || 0, Number(meta.pass) || 0, Number(meta.pagesDone) || 0, meta.complete === true ? 1 : 0, meta.stable === true ? 1 : 0, Number(meta.loadedAt) || 0)
      report.billLoads++
    } catch { /* no meta: the bills are kept, the load will be resumed */ }
  }

  // ---- details
  const di = db.prepare('INSERT OR IGNORE INTO case_details (court, num, t, d) VALUES (?, ?, ?, ?)')
  for (const court of list(path.join(dir, 'details'))) {
    if (!COURTS.has(court)) continue
    const files = list(path.join(dir, 'details', court)).filter((n) => n.endsWith('.json.gz'))
    for (let i = 0; i < files.length; i += 500) {
      db.transaction(() => {
        for (const f of files.slice(i, i + 500)) {
          const num = f.slice(0, -'.json.gz'.length).replace('@', '/')
          if (!NUMBER_RE.test(num)) { report.skipped++; continue }
          const rec = readGz(path.join(dir, 'details', court, f)) as { t?: number; data?: unknown } | null
          if (!rec || typeof rec.data !== 'object' || !rec.data) { report.skipped++; continue }
          di.run(court, num, Number(rec.t) || 0, zlib.gzipSync(JSON.stringify(rec.data)))
          report.details++
        }
      })
    }
  }

  db.prepare("INSERT OR REPLACE INTO meta VALUES ('legacy_import', ?)").run(JSON.stringify({ at: Date.now(), ...report }))
  console.log(`[db] import from ${dir}: ${report.bills} bills, ${report.found} found cases, ${report.tried} tried, ${report.details} details (${report.skipped} unreadable skipped); the old files are untouched`)
  return report
}
