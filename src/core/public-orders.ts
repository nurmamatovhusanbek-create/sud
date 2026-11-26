/**
 * PURE logic for the public court-order library (public.sud.uz) — no I/O.
 *
 * The library's API (see docs/public-sud-api.md) lists «publications»: one row per published
 * order, with the case number, instance, a fixed `result` enum, court, judge, categories and a
 * `pdf` file id. It has NO parties and NO STIR, and the PDFs are anonymised by the court.
 * We keep a small local index of these rows (built by a date-window crawl) so a case's orders
 * can be looked up instantly instead of asking the slow search endpoint.
 */

import { caseStatusInfo } from './case-status'
import { classifyOutcome, type Classification, type PartyRole } from './classify'
import { uzCyrToLat } from './translit'

/** one request to the orders API every this many seconds (lib/public-orders/pace; PUBLIC_ORDERS_MIN_GAP_MS overrides) */
export const ORDERS_GAP_SECONDS_DEFAULT = 10
/** the rest between two PDF DOWNLOADS, counted from the end of the previous one (searches keep the start-to-start gap above) */
export const ORDERS_FILE_GAP_SECONDS_DEFAULT = 4

export type PublicCourtType = 'ECONOMIC' | 'CIVIL' | 'ADMINISTRATIVE' | 'CRIMINAL'
export const PUBLIC_COURT_TYPES: PublicCourtType[] = ['ECONOMIC', 'CIVIL', 'ADMINISTRATIVE', 'CRIMINAL']

/** App court type → the library's `court_type`. */
export const PUBLIC_COURT_OF: Record<'economic' | 'civil' | 'administrative' | 'criminal', PublicCourtType> = {
  economic: 'ECONOMIC',
  civil: 'CIVIL',
  administrative: 'ADMINISTRATIVE',
  criminal: 'CRIMINAL',
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
  INSPECTION: 'Taftish',
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LEGACY_ID_RE = /^old-(economic|civil|administrative|criminal)-(\d{1,12})(?:-(\d{1,4}))?$/

/** The order ids we accept from a client (a uuid, or `old-<type>-<numeric id>` of the pre-2024 system) — nothing else reaches an upstream URL or a file name. */
export const isOrderFileId = (s: string): boolean => UUID_RE.test(s) || LEGACY_ID_RE.test(s)

/** The file's path on adolatapi1.sud.uz for an accepted id (null for anything else). Pure: the id fully decides the path. */
export function orderFilePath(pdfId: string): string | null {
  if (UUID_RE.test(pdfId)) return `/public/onStream/${pdfId}`
  const m = LEGACY_ID_RE.exec(pdfId)
  if (!m) return null
  const [, kind, n, t] = m
  if (kind === 'economic') return `/publication-proxy/api/file/download/${n}/`
  if (kind === 'civil') return `/publication-proxy/api/file/civil/${n}/`
  if (kind === 'criminal') return `/publication-proxy/api/file/criminal/${n}/`
  return `/publication-proxy/api/file/administrative/${n}/${t ?? ADMIN_DOC_TYPE}`
}

// ---- published vs unpublished decisions of one case ---------------------------------------

/** A decision the court-case data (jadval) already gives us, per instance — with or without a published PDF. */
export interface KnownDecision {
  instance: 'FIRST' | 'APPEAL' | 'CASSATION' | 'INSPECTION'
  date: string
  text: string
  /** the court and judge OF THIS INSTANCE (from the case data), when known */
  court?: string
  judge?: string
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
export const LOOKUP_INSTANCES = ['FIRST', 'APPEAL', 'CASSATION', 'INSPECTION'] as const

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

// ---- which cases can have an order at all? ---------------------------------------------------

const EMPTY_RESULT = /^[\s\-–—.]*$/
const APPEAL_STATUS = /апелл|apell|кассац|kassats|назорат|nazorat|тафтиш|taftish/i
const ONGOING_STATUS = /юритув|yurituv|кўриб\s*чиқ|ko[ʻʼ'’`]?rib\s*chiq|қабул\s*қилинди|қабул\s*қилинган|qabul\s*qilindi|qabul\s*qilingan/i

/**
 * A case still being heard in the FIRST instance (no outcome yet, not in appeal/cassation/supervision) has no
 * decision, so nothing can be published: asking the library about it is a wasted, slow request. Once it is
 * decided, or moves to a higher court (whose first-instance order already exists), it is worth a look.
 * Conservative on purpose: only a recognised «ongoing» status (or none) with an EMPTY result counts as ongoing;
 * anything else (terminated, suspended, unknown wording) is still checked.
 */
export function isOngoingFirstInstance(c: { result?: string; caseStatus?: string }): boolean {
  if (!EMPTY_RESULT.test(c.result ?? '')) return false
  const status = clean(c.caseStatus ?? '')
  if (APPEAL_STATUS.test(status)) return false
  const info = caseStatusInfo(status)
  // the court's real statuses: being heard / scheduled / registered / a draft not sent to court have no order yet; finished, archived or
  // refused at the chancellery may (a finished case with no result text is exactly the one to look up), unknown stays «check»
  if (info) return info.stage === 'ongoing' || info.stage === 'draft' || info.stage === 'refused'
  return EMPTY_RESULT.test(status) || ONGOING_STATUS.test(status)
}

/** Changes whenever the case moves on (status, outcome, next hearing) — the trigger for a re-check. */
export function caseSignature(c: { caseStatus?: string; result?: string; hearingDate?: string }): string {
  const n = (v: string | undefined) => clean(v ?? '').toLowerCase()
  return [n(c.caseStatus), n(c.result), n(c.hearingDate)].join('|')
}

/**
 * What every caller (Kuzatuv, the Sud ishlari list) sends for a case. ONE shape on purpose: the signature is built
 * from the same two fields everywhere, so two screens never make each other's «changed» look like a change.
 */
export function orderJobCase(c: { caseNumber: string; courtType: string; result?: string; caseStatus?: string }) {
  const result = c.result ?? ''
  const caseStatus = c.caseStatus ?? ''
  return { caseNumber: c.caseNumber, courtType: c.courtType, sig: caseSignature({ caseStatus, result }), result, caseStatus }
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

// ---- searching the stored orders (the Qarorlar page) --------------------------------------------

/** `saved`: the PDF is on this computer · `gone`: it was saved once and the file is no longer there («Mavjud emas») · `never`: never downloaded. */
export type LibraryState = 'saved' | 'gone' | 'never'

export interface LibraryItem extends StoredOrder {
  state: LibraryState
  /** the PDF is on this computer now (opens at once, no captcha) — `state === 'saved'` */
  downloaded: boolean
  /** the file's size: now for `saved`, when it was last saved for `gone`, 0 for `never` */
  size: number
  /** when the PDF was (last) saved (ms), 0 for `never` */
  savedAt: number
  /** the person cleared it from the lists («Tozalash» / «Oʻchirish»): out of the lists and counts, but its record is kept and a search still finds it.
   *  A downloaded order can be cleared too: only its row goes; the PDF stays on disk and opens in one click from the «Tozalangan» view. */
  hidden: boolean
}

export type LibraryStatus = 'all' | LibraryState | 'hidden'

export interface LibraryQuery {
  /** a case number or a part of it («2615»), or words from the court / judge / category (Latin or Cyrillic) */
  q: string
  status: LibraryStatus
  courtType?: PublicCourtType | ''
  instance?: string
  /** pdf ids (lower case) the person cleared */
  hidden?: ReadonlySet<string>
  offset: number
  limit: number
}

/** Cyrillic court names and Latin queries meet in one folded form: Latin, lower case, one kind of apostrophe. */
const fold = (s: string): string => uzCyrToLat(s).toLowerCase().replace(/[ʻʼ’‘`´]/g, "'").replace(/\s+/g, ' ').trim()
const hayOf = new WeakMap<StoredOrder, string>()
const haystack = (o: StoredOrder): string => {
  let h = hayOf.get(o)
  if (h === undefined) hayOf.set(o, (h = fold([o.court, o.judge, o.category, o.pdfName].join(' '))))
  return h
}

/**
 * Orders matching the page's filters (`history` = what the download log remembers, for telling «gone» from «never»). A query that looks like a case number («4-1001-2615/40333», «2615», «40333», «4-1001»)
 * matches any case number containing it; words match the court, judge, category or file name. Downloaded orders come first,
 * newest first, then by case number. `total` counts the matches, `items` is the requested window, `counts` how the
 * matches split by download state (so the switch can show them) before the status filter is applied. Downloaded first (newest
 * first), then the ones whose file is gone, then the never-downloaded, by case number.
 */
export function searchLibrary(
  orders: StoredOrder[],
  saved: Map<string, { size: number; savedAt: number }>,
  history: Map<string, { size: number; savedAt: number }>,
  opts: LibraryQuery,
): { total: number; items: LibraryItem[]; counts: { all: number; saved: number; gone: number; never: number; hidden: number } } {
  const qn = normalizeCaseNumber(opts.q)
  const ql = fold(opts.q)
  const searching = !!opts.q.trim()
  const matched: LibraryItem[] = []
  for (const o of orders) {
    if (opts.courtType && o.courtType !== opts.courtType) continue
    if (opts.instance && o.instance !== opts.instance) continue
    if (qn && !o.caseNumber.includes(qn) && !(ql && haystack(o).includes(ql))) continue
    const key = o.pdfId.toLowerCase()
    const f = o.pdfId ? saved.get(key) : undefined
    const h = o.pdfId && !f ? history.get(key) : undefined
    const state: LibraryState = f ? 'saved' : h ? 'gone' : 'never'
    matched.push({ ...o, state, downloaded: !!f, size: (f ?? h)?.size ?? 0, savedAt: (f ?? h)?.savedAt ?? 0, hidden: !!o.pdfId && !!opts.hidden?.has(key) })
  }
  // cleared orders stay out of the lists and counts — except when the person SEARCHES (then every match shows, with its
  // download button) or opens the «Tozalangan» view itself
  const visible = searching ? matched : matched.filter((o) => !o.hidden)
  const n = (st: LibraryState) => visible.filter((o) => o.state === st).length
  const counts = { all: visible.length, saved: n('saved'), gone: n('gone'), never: n('never'), hidden: matched.filter((o) => o.hidden).length }
  const out = opts.status === 'hidden' ? matched.filter((o) => o.hidden) : opts.status === 'all' ? visible : visible.filter((o) => o.state === opts.status)
  const rank: Record<LibraryState, number> = { saved: 0, gone: 1, never: 2 }
  out.sort((a, b) => rank[a.state] - rank[b.state] || b.savedAt - a.savedAt || a.caseNumber.localeCompare(b.caseNumber) || a.instance.localeCompare(b.instance))
  const start = Math.max(0, opts.offset)
  return { total: out.length, items: out.slice(start, start + Math.max(1, opts.limit)), counts }
}

// ---- the pre-2024 system («2024 dan avval»): a different back end, numeric ids, plain PDFs ----------------

/** The administrative list is asked for this document type (the site's own filter); the file path repeats it. */
export const ADMIN_DOC_TYPE = 17

/** Pre-2024 lists, filtered by `caseNumber` (verified live: each returns only that case). Path + query, no host. */
export function legacySearchPath(courtType: PublicCourtType, caseNumber: string): string {
  const cn = `caseNumber=${encodeURIComponent(normalizeCaseNumber(caseNumber))}&size=30&page=0`
  switch (courtType) {
    case 'ECONOMIC':
      return `/publication-proxy/unauthorized/publications?${cn}&court_type=ECONOMIC`
    case 'CIVIL':
      return `/publication-proxy/api/civil/publication/page?${cn}&court_type=CIVIL`
    case 'ADMINISTRATIVE':
      return `/publication-proxy/unauthorized/administrative/conflict?type=${ADMIN_DOC_TYPE}&${cn}&court_type=ADMINISTRATIVE`
    case 'CRIMINAL':
      return `/publication-proxy/criminal/findAll?${cn}&court_type=CRIMINAL`
  }
}

/** Rows of a pre-2024 list answer: `{data: [...]}`, or `data` as a JSON string (criminal), or `{data: {content: [...]}}`. */
export function legacyRows(json: unknown): Record<string, unknown>[] {
  let d: unknown = (json as { data?: unknown } | null)?.data ?? json
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d)
    } catch {
      return []
    }
  }
  const arr = Array.isArray(d) ? d : Array.isArray((d as { content?: unknown } | null)?.content) ? (d as { content: unknown[] }).content : []
  return arr.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
}

/** The pre-2024 system numbers instances 1..4 (first, appeal, cassation, taftish). Anything else stays blank. */
const LEGACY_INSTANCE: Record<number, string> = { 1: 'FIRST', 2: 'APPEAL', 3: 'CASSATION', 4: 'INSPECTION' }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null)
const txt = (v: unknown): string => clean(v)

/**
 * Compact one pre-2024 row into the same shape as a new-system order. The PDF id is `old-<type>-<file key>`:
 * economic → the attachment's file id; civil / criminal → the claimId; administrative → claimId + document type.
 * A row with no case number or no way to a file is unusable → null.
 */
export function compactLegacy(raw: Record<string, unknown>, courtType: PublicCourtType): StoredOrder | null {
  const caseNumber = normalizeCaseNumber(txt(raw.caseNumber))
  const rowId = num(raw.id) ?? (txt(raw.id) || null)
  const claimId = num(raw.claimId)
  if (!caseNumber || rowId === null) return null
  const kind = courtType.toLowerCase()
  let fileKey: string | null = null
  let fileName = ''
  let fileSize = 0
  let category = txt(raw.category) || txt(raw.claimCategory)
  if (courtType === 'ECONOMIC') {
    const att = (Array.isArray(raw.attachmentsList) ? raw.attachmentsList : []) as { fileData?: { id?: unknown; name?: unknown; size?: unknown } }[]
    const f = att.map((a) => a?.fileData).find((d) => num(d?.id) !== null)
    if (f) {
      fileKey = String(num(f.id))
      fileName = txt(f.name)
      fileSize = num(f.size) ?? 0
    }
    category = txt((raw.publicationType as { name?: unknown } | null)?.name) || category
  } else if (claimId !== null) {
    fileKey = courtType === 'ADMINISTRATIVE' ? `${claimId}-${ADMIN_DOC_TYPE}` : String(claimId)
    const fd = raw.fileData as { name?: unknown; size?: unknown } | null | undefined
    fileName = txt(fd?.name)
    fileSize = num(fd?.size) ?? 0
    if (courtType === 'CRIMINAL') category = Array.isArray(raw.claimDocumentType) ? raw.claimDocumentType.map(txt).filter(Boolean).join(', ') : category
  }
  return {
    id: `old-${kind}-${rowId}`,
    caseNumber,
    instance: typeof raw.instance === 'number' ? (LEGACY_INSTANCE[raw.instance] ?? '') : '',
    result: txt(raw.result),
    court: txt(raw.dbName),
    judge: txt(raw.judge),
    category,
    pdfId: fileKey ? `old-${kind}-${fileKey}` : '',
    pdfName: fileName,
    pdfSize: fileSize,
    courtType,
  }
}

/**
 * Which court a case number belongs to, from its first digit (seen in the library: 1 criminal, 2 civil, 3 and 5
 * administrative, 4 economic). Only a default for the manual lookup box; the person can change it.
 */
export function courtTypeOfCase(caseNumber: string): PublicCourtType | null {
  const d = normalizeCaseNumber(caseNumber).charAt(0)
  return d === '1' ? 'CRIMINAL' : d === '2' ? 'CIVIL' : d === '3' || d === '5' ? 'ADMINISTRATIVE' : d === '4' ? 'ECONOMIC' : null
}
