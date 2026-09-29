/**
 * PURE logic for the public court-order library (public.sud.uz) — no I/O.
 *
 * The library's API (see docs/public-sud-api.md) lists «publications»: one row per published
 * order, with the case number, instance, a fixed `result` enum, court, judge, categories and a
 * `pdf` file id. It has NO parties and NO STIR, and the PDFs are anonymised by the court.
 * We keep a small local index of these rows (built by a date-window crawl) so a case's orders
 * can be looked up instantly instead of asking the slow search endpoint.
 */

import { classifyOutcome, type Classification, type PartyRole } from './classify'

export type PublicCourtType = 'ECONOMIC' | 'CIVIL' | 'ADMINISTRATIVE'
export const PUBLIC_COURT_TYPES: PublicCourtType[] = ['ECONOMIC', 'CIVIL', 'ADMINISTRATIVE']

/** App court type → the library's `court_type`. */
export const PUBLIC_COURT_OF: Record<'economic' | 'civil' | 'administrative', PublicCourtType> = {
  economic: 'ECONOMIC',
  civil: 'CIVIL',
  administrative: 'ADMINISTRATIVE',
}

/** The row as the API returns it (only what we read; everything is optional on purpose). */
export interface RawPublication {
  id?: string
  case_number?: string | null
  instance?: string | null
  result?: string | null
  court_names?: Record<string, string> | null
  responsible_judge_name?: string | null
  speaker_judge_name?: string | null
  categories?: Record<string, string>[] | null
  pdf?: { id?: string; name?: string; size?: number; mime_type?: string } | null
}

/** What we store: small on purpose (~200 bytes a row, ~680k rows for the whole library). */
export interface StoredOrder {
  id: string
  caseNumber: string
  instance: string
  result: string
  court: string
  judge: string
  category: string
  pdfId: string
  pdfName: string
  pdfSize: number
  courtType: PublicCourtType
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')
const pick = (m: Record<string, string> | null | undefined, order: string[]): string => {
  for (const k of order) if (m && clean(m[k])) return clean(m[k])
  return ''
}

/** Case numbers compare case- and space-insensitively («4-1001-2619/21743»). */
export const normalizeCaseNumber = (s: string): string => clean(s).replace(/\s+/g, '').toUpperCase()

/** Compact one API row. Rows with no id or no case number are unusable for a case lookup → null. */
export function compactPublication(raw: RawPublication, courtType: PublicCourtType): StoredOrder | null {
  const id = clean(raw.id)
  const caseNumber = normalizeCaseNumber(raw.case_number ?? '')
  if (!id || !caseNumber) return null
  return {
    id,
    caseNumber,
    instance: clean(raw.instance),
    result: clean(raw.result),
    court: pick(raw.court_names, ['uz_cyr', 'uz', 'ru', 'qq']),
    judge: clean(raw.responsible_judge_name) || clean(raw.speaker_judge_name),
    category: pick(raw.categories?.[0], ['uz', 'uz_cyr', 'ru', 'qq']),
    pdfId: clean(raw.pdf?.id),
    pdfName: clean(raw.pdf?.name),
    pdfSize: typeof raw.pdf?.size === 'number' ? raw.pdf.size : 0,
    courtType,
  }
}

// ---- result / instance ------------------------------------------------------------

export const PUBLIC_RESULT_LABEL: Record<string, string> = {
  FULFILLED: 'Daʼvo toʻliq qanoatlantirilgan',
  PARTIALLY_FULFILLED: 'Daʼvo qisman qanoatlantirilgan',
  REFUSED: 'Daʼvo rad etilgan',
  RETURNED: 'Daʼvo qaytarilgan',
  UNCONSIDERED: 'Koʻrmasdan qoldirilgan',
  CASE_ENDED: 'Ish yuritish tugatilgan',
}

export const PUBLIC_INSTANCE_LABEL: Record<string, string> = {
  FIRST: 'Birinchi instansiya',
  APPEAL: 'Apellyatsiya',
  CASSATION: 'Kassatsiya',
  CASSATION_REPEATED: 'Takroriy kassatsiya',
  INSPECTION: 'Nazorat tartibida',
}

/** Oldest instance first, the way a case proceeds. */
export const PUBLIC_INSTANCE_ORDER = ['FIRST', 'APPEAL', 'CASSATION', 'CASSATION_REPEATED', 'INSPECTION']

export const sortOrders = (list: StoredOrder[]): StoredOrder[] =>
  [...list].sort((a, b) => {
    const ia = PUBLIC_INSTANCE_ORDER.indexOf(a.instance)
    const ib = PUBLIC_INSTANCE_ORDER.indexOf(b.instance)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id.localeCompare(b.id)
  })

/**
 * The library's fixed `result` enum, judged from the company's side — through the SAME
 * rules as the free-text outcomes (core/classify.ts), never a second copy of them.
 */
const RESULT_PHRASE: Record<string, string> = {
  FULFILLED: "to'liq qanoatlantirilgan",
  PARTIALLY_FULFILLED: 'qisman qanoatlantirilgan',
  REFUSED: 'rad etilgan',
  RETURNED: 'qaytarilgan',
  UNCONSIDERED: "ko'rmasdan qoldirilgan",
  CASE_ENDED: 'tugatilgan',
}

export function classifyPublicResult(role: PartyRole, result: string): Classification {
  const phrase = RESULT_PHRASE[result]
  return phrase ? classifyOutcome(role, phrase) : 'pending'
}

// ---- dates (ISO yyyy-mm-dd, UTC arithmetic so DST can never skip or repeat a day) -----

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10)

export function addDays(iso: string, n: number): string {
  const t = Date.parse(iso + 'T00:00:00Z')
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (b later → positive). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)

// ---- the order file --------------------------------------------------------------------

/**
 * `/public/onStream/<pdf.id>` wraps the PDF in a multipart/form-data envelope:
 *   --<boundary>\r\nContent-Disposition: form-data; name="file"; filename="…"\r\n
 *   Content-Type: application/octet-stream\r\nContent-Length: N\r\n\r\n<N bytes>\r\n--<boundary>--
 * Cut the payload out by Content-Length (falling back to the closing boundary).
 */
export function parseMultipartFile(buf: Uint8Array): { filename: string; bytes: Uint8Array } | null {
  const text = (from: number, to: number) => Buffer.from(buf.subarray(from, to)).toString('latin1')
  if (buf.length < 8 || buf[0] !== 0x2d || buf[1] !== 0x2d) return null // not "--"
  const headEnd = Buffer.from(buf).indexOf('\r\n\r\n')
  if (headEnd < 0) return null
  const head = text(0, headEnd)
  const boundary = head.slice(2, head.indexOf('\r\n'))
  if (!boundary) return null
  const start = headEnd + 4
  const lenMatch = /Content-Length:\s*(\d+)/i.exec(head)
  let end = -1
  if (lenMatch) {
    const n = Number(lenMatch[1])
    if (start + n <= buf.length) end = start + n
  }
  if (end < 0) {
    end = Buffer.from(buf).indexOf(`\r\n--${boundary}`, start)
    if (end < 0) return null
  }
  const nameMatch = /filename="([^"]*)"/i.exec(Buffer.from(buf.subarray(0, headEnd)).toString('utf8'))
  return { filename: nameMatch ? nameMatch[1] : 'order.pdf', bytes: buf.subarray(start, end) }
}

/** A safe download name: the court's filename, made a plain `.pdf`. */
export function pdfFileName(name: string, fallback: string): string {
  const base = (clean(name) || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120)
  return /\.pdf$/i.test(base) ? base : base + '.pdf'
}

/** The order ids we accept from a client (uuid v4-ish) — nothing else reaches the upstream URL. */
export const isOrderFileId = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

// ---- published vs unpublished decisions of one case ---------------------------------------

/** A decision the court-case data (jadval) already gives us, per instance — with or without a published PDF. */
export interface KnownDecision {
  instance: 'FIRST' | 'APPEAL' | 'CASSATION'
  date: string
  text: string
}

export interface CaseOrdersView {
  /** every published order, oldest instance first, with the case-data decision of the same instance (if any) */
  published: { order: StoredOrder; decision: KnownDecision | null }[]
  /** decisions we know from the case data but the library has NO order for */
  unpublished: KnownDecision[]
}

/**
 * Line up what the case data says (decisions per instance) with what the library published.
 * A decision is «unpublished» when no published order exists for its instance. Note this is only meaningful
 * once the case was actually looked up — the caller decides whether to call it «unpublished» or «unchecked».
 */
export function splitDecisions(known: KnownDecision[], published: StoredOrder[]): CaseOrdersView {
  const byInstance = new Map(known.map((d) => [d.instance, d]))
  const have = new Set(published.map((o) => o.instance))
  return {
    published: sortOrders(published).map((order) => ({ order, decision: byInstance.get(order.instance as KnownDecision['instance']) ?? null })),
    unpublished: known.filter((d) => !have.has(d.instance)),
  }
}

// ---- when does a case need (re)checking? ------------------------------------------------------
//
// A published order never goes away, so a case's found orders are permanent: they are never asked for again.
// What CAN change is the case itself — an appeal or cassation adds a new instance, and a decision may be
// published days or weeks after it is made. So a case is re-checked only when (a) it was never checked,
// (b) its case data changed (its «signature»), or (c) nothing was found yet and a back-off has elapsed
// (the publication lag: 3 days, then 14, then 45; after that it waits for the case to change).

/** The instances a case can have orders in; searched separately because the filtered search is far faster. */
export const LOOKUP_INSTANCES = ['FIRST', 'APPEAL', 'CASSATION'] as const

export const CHECK_BACKOFF_MS = [3, 14, 45].map((d) => d * 86_400_000)
export const RETRY_ERROR_AFTER_MS = 10 * 60_000

/** What we remember about one case's library lookups. */
export interface CaseCheck {
  caseNumber: string
  /** ISO time of the last attempt */
  at: string
  /** the case-data signature at that time */
  sig: string
  /** instances with a published order — permanent */
  seen: string[]
  /** consecutive full checks that found nothing new (drives the back-off) */
  misses: number
  /** set when the last attempt failed (network/timeout) */
  error?: string
}

/** Changes whenever the case moves on (status, outcome, next hearing) — the trigger for a re-check. */
export function caseSignature(c: { caseStatus?: string; result?: string; hearingDate?: string }): string {
  const n = (v: string | undefined) => clean(v ?? '').toLowerCase()
  return [n(c.caseStatus), n(c.result), n(c.hearingDate)].join('|')
}

export type CheckReason = 'new' | 'forced' | 'retry-error' | 'sig-changed' | 'backoff' | 'done' | 'waiting'

export interface CheckPlan {
  run: boolean
  /** the instances still worth asking about (published ones are never re-asked) */
  instances: string[]
  reason: CheckReason
}

export function planCheck(prev: CaseCheck | null, sig: string, now: number, force = false): CheckPlan {
  const seen = new Set(prev?.seen ?? [])
  const instances = LOOKUP_INSTANCES.filter((i) => !seen.has(i)) as string[]
  if (!prev) return { run: true, instances, reason: 'new' }
  if (!instances.length) return { run: false, instances, reason: 'done' } // every instance already published: permanent
  if (force) return { run: true, instances, reason: 'forced' }
  const age = now - Date.parse(prev.at)
  if (prev.error) return age >= RETRY_ERROR_AFTER_MS ? { run: true, instances, reason: 'retry-error' } : { run: false, instances, reason: 'waiting' }
  if (sig !== prev.sig) return { run: true, instances, reason: 'sig-changed' }
  const wait = CHECK_BACKOFF_MS[prev.misses]
  if (wait !== undefined && age >= wait) return { run: true, instances, reason: 'backoff' }
  return { run: false, instances, reason: 'waiting' }
}
