/**
 * Text fields of a court row, whatever the court's API put there. jadvalapi answers `claiment: []` (an EMPTY ARRAY, which is truthy) for some cases,
 * and `raw.claiment || raw.claimant || '-'` then keeps the array: the row's plaintiff is not a string, and everything that trims or matches a name
 * (Statistika's sides, the lists, the backup) crashes on it («(v ?? "").trim is not a function»). So party and other text fields are turned into
 * strings where the row is made, where a stored row is read, and where the sides are decided.
 */

import type { CourtCase } from '@/lib/court-case-types'

/** a string out of anything: text as it is, a list of names joined by «; », a named object by its name, a number as digits, the rest empty */
export function partyText(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (Array.isArray(v)) return v.map(partyText).map((s) => s.trim()).filter((s) => s && s !== '-').join('; ')
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return partyText(o.name ?? o.title ?? o.fullName ?? o.full_name ?? '')
  }
  return ''
}

/** the first of several fields that holds real text, else «-» (the court lists' own empty mark) */
export function firstText(...vals: unknown[]): string {
  for (const v of vals) {
    const s = partyText(v)
    if (s.trim() && s.trim() !== '-') return s
  }
  return '-'
}

const TEXT_FIELDS = ['caseNumber', 'caseType', 'caseStatus', 'result', 'courtName', 'dateFiled', 'plaintiff', 'defendant', 'claimAmount', 'hearingDate', 'hearingTime', 'judge'] as const

/** the row with every text field a string (a row that already is one is returned as it is) */
export function normalizeRow(row: CourtCase): CourtCase {
  let out: CourtCase | null = null
  for (const k of TEXT_FIELDS) {
    if (typeof row[k] !== 'string') {
      out ??= { ...row }
      out[k] = partyText(row[k])
    }
  }
  return out ?? row
}
