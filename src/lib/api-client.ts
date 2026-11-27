/**
 * The typed API client (arch guide §3.2) — the ONLY module allowed to fetch.
 * Components call these functions through useResource and the feature hooks; no fetch()
 * lives anywhere else. Every call is abortable and maps server envelopes (and
 * legacy shapes) into ApiResult<T>.
 */

import { beginActivity } from './net-activity'
import { normalizeCourtType } from '@/core/billing-format'
import type { DownloadJobState, LibraryItem, LibraryStatus, StoredOrder } from '@/core/public-orders'
import type { SecuritySnapshot } from '@/core/security-events'
import type { UzScript } from '@/core/uz-alphabet'
import type { OrdersCacheStats, PublicOrdersStatus } from '@/lib/public-orders/types'
import type {
  ApiResult,
  BillDetailData,
  BillJobState,
  BillJobStatus,
  BillRow,
  BillSeg,
  BillSort,
  BillsQueryResult,
  FoundCasesResult,
  BillSummary,
  CompanyInfoData,
  CompanyStats,
  CourtCase,
  EnrichedBill,
  FullCaseData,
  UpcomingHearingsData,
} from './api-types'

/** Operator may set NEXT_PUBLIC_APP_API_TOKEN for an authed deployment. */
const TOKEN = typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_APP_API_TOKEN || '') : ''

export function authHeaders(): HeadersInit {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}
}

/** Headers for the dangerous doors (update, worker list, Tor): the token plus the confirmation header a cross-site page cannot send. */
export function privilegedHeaders(extra: Record<string, string> = {}): HeadersInit {
  return { ...authHeaders(), 'x-sud-action': '1', ...extra }
}

async function request<T>(url: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  const end = beginActivity() // drives the thin loading line under the topbar
  try {
    // cache: 'no-store': every answer is live data (the Qarorlar counts change when a file is saved); the browser must not reuse one
    const res = await fetch(url, { signal, headers: authHeaders(), cache: 'no-store' })
    const json = await res.json().catch(() => null)
    if (!json) {
      return { ok: false, error: `Server javob bermadi (${res.status})`, status: res.status }
    }
    // New envelope: { ok, data, partial?, meta? }
    if (json.ok === true && 'data' in json) {
      return { ok: true, data: json.data as T, partial: json.partial, meta: json.meta }
    }
    // New envelope failure: { ok:false, error, code, status }
    if (json.ok === false) {
      return { ok: false, error: json.error || 'Xatolik', code: json.code, status: res.status }
    }
    // Legacy compat: { ok: true, ...spread }
    if (json.ok === true) {
      const { ok: _ok, ...rest } = json
      return { ok: true, data: rest as T }
    }
    return { ok: false, error: 'Noma’lum javob shakli', status: res.status }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    // Whatever lands here is a raw transport failure (fetch() itself threw —
    // DNS, offline, CORS) — e.message is always the browser's own English
    // text ("Failed to fetch" etc.), never something already localized, so
    // it must never reach a toast verbatim.
    return { ok: false, error: 'Tarmoq xatosi — serverga ulanib boʻlmadi', status: 0 }
  } finally {
    end()
  }
}

// ---- Endpoint functions ------------------------------------------------------

export function getStats(tin: string, opts?: { force?: boolean; signal?: AbortSignal }) {
  return request<CompanyStats>(`/api/stats?tin=${tin}${opts?.force ? '&force=1' : ''}`, opts?.signal)
}

/** The operator removed the company: forget its daily snapshot too. Best-effort (a failure just leaves a file the janitor sweeps). */
export async function dropCompanySnapshot(tin: string): Promise<void> {
  try {
    await fetch(`/api/snapshot?tin=${tin}`, { method: 'DELETE', headers: authHeaders() })
  } catch {
    /* offline / server down: nothing to forget yet */
  }
}

export interface SecurityStatus extends SecuritySnapshot {
  posture: { tokenRequired: boolean; extraHosts: number; trustProxy: boolean; supervised: boolean; production: boolean }
}

export function getSecurityStatus(signal?: AbortSignal) {
  return request<SecurityStatus>('/api/settings/security', signal)
}

/** The chamber.uz rating alone (fast; see /api/rating). */
export function getRating(tin: string, opts?: { force?: boolean; signal?: AbortSignal }) {
  return request<{ rating: { category: string; score: number | null } | null; name: string }>(`/api/rating?tin=${tin}${opts?.force ? '&force=1' : ''}`, opts?.signal)
}

export function getCompanyInfo(tin: string, opts?: { force?: boolean; signal?: AbortSignal }) {
  return request<CompanyInfoData>(`/api/company-info?tin=${tin}${opts?.force ? '&force=1' : ''}`, opts?.signal)
}

export function searchCases(params: { courtType: string; mode: string; value: string }, signal?: AbortSignal, force?: boolean) {
  const q = new URLSearchParams({ courtType: normalizeCourtType(params.courtType) ?? params.courtType, mode: params.mode, value: params.value })
  if (force) q.set('force', '1')
  return request<{ cases: CourtCase[] }>(`/api/court-cases?${q}`, signal)
}

/**
 * `refresh`: ask the court about THIS case only (the drawer's «Yangilash»); on failure the caller keeps what it shows.
 * `tin`: the company the case was opened from, so its stored list gets the fresh row too.
 */
export function getCaseDetail(courtType: string, caseNumber: string, signal?: AbortSignal, opts?: { refresh?: boolean; tin?: string }) {
  const q = new URLSearchParams({ courtType: normalizeCourtType(courtType) ?? courtType, detail: caseNumber })
  if (opts?.refresh) q.set('refresh', '1')
  if (opts?.tin) q.set('tin', opts.tin)
  return request<FullCaseData>(`/api/court-cases?${q}`, signal)
}

export function getUpcomingHearings(tin: string, signal?: AbortSignal) {
  return request<UpcomingHearingsData>(`/api/upcoming-hearings?tin=${tin}`, signal)
}

export function searchCompanies(query: string, signal?: AbortSignal) {
  return request<{ results: { tin: string; name: string; region?: string }[] }>(`/api/company?q=${encodeURIComponent(query)}`, signal)
}

export function getBillDetail(invoice: string, signal?: AbortSignal) {
  return request<BillDetailData>(`/api/bills?invoice=${encodeURIComponent(invoice)}`, signal)
}

export function getTorStatus(signal?: AbortSignal) {
  return request<{ running: boolean; installed: boolean; port?: number }>(`/api/tor-status`, signal)
}

export function getHealth(signal?: AbortSignal) {
  return request<Record<string, unknown>>(`/api/settings/health`, signal)
}

export function getWorkers(signal?: AbortSignal) {
  return request<{ source: string; workers: { url: string; addedAt?: string | null; lastTestedAt?: string | null; lastTestResult?: 'ok' | 'fail' | null }[] }>(`/api/settings/workers`, signal)
}

// ---- The bills job and the stored bills (lib/bill-cases, lib/bills-store) ----

/** What is stored, the background job's progress, and the cases it found after event `after` (nothing is scraped by asking). */
export function getBillJob(stir: string, after: number | null, signal?: AbortSignal) {
  return request<BillJobState>(`/api/bill-cases?tin=${stir}${after === null ? '' : `&after=${after}`}`, signal)
}

/** Started by a click (or by opening the Toʻlovlar tab of a company with no stored bills, `fill: false`). Returns at once. */
export async function startBillJob(stir: string, opts: { load: 'auto' | 'refresh' | 'skip'; fill: boolean; refresh?: 'open' }): Promise<ApiResult<{ job: BillJobStatus }>> {
  return post(`/api/bill-cases?tin=${stir}&action=start&load=${opts.load}&fill=${opts.fill ? 1 : 0}${opts.refresh ? '&refresh=open' : ''}`)
}

export async function stopBillJob(stir: string): Promise<ApiResult<{ job: BillJobStatus }>> {
  return post(`/api/bill-cases?tin=${stir}&action=stop`)
}

async function post<T>(url: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method: 'POST', headers: authHeaders(), cache: 'no-store' })
    const json = await res.json().catch(() => null)
    if (json?.ok === true && 'data' in json) return { ok: true, data: json.data as T }
    return { ok: false, error: json?.error || `Server xatosi (${res.status})`, status: res.status }
  } catch {
    return { ok: false, error: 'Tarmoq xatosi — serverga ulanib boʻlmadi', status: 0 }
  }
}

export interface BillsQueryParams {
  page: number
  size: number
  sort: BillSort
  seg: BillSeg
  q?: string
  court?: string
  kind?: string
}

/** A page of the company's STORED bills (no site is asked), the summary of all of them, the load's progress and the job. */
export function queryStoredBills(stir: string, p: BillsQueryParams, signal?: AbortSignal) {
  const q = new URLSearchParams({ inn: stir, page: String(p.page), size: String(p.size), sort: p.sort, seg: p.seg })
  if (p.q?.trim()) q.set('q', p.q.trim())
  if (p.court) q.set('court', p.court)
  if (p.kind) q.set('kind', p.kind)
  return request<BillsQueryResult>(`/api/bills/query?${q}`, signal)
}

/** One page of the cases found by number from the company's bills (the cases its TIN lists do not show). Database only. */
export function getFoundCases(stir: string, p: { court?: string; q?: string; page: number; size: number }, signal?: AbortSignal) {
  const q = new URLSearchParams({ tin: stir, page: String(p.page), size: String(p.size) })
  if (p.court) q.set('court', p.court)
  if (p.q?.trim()) q.set('q', p.q.trim())
  return request<FoundCasesResult>(`/api/found-cases?${q}`, signal)
}

/** The bills of ONE case (usually two: state duty and postal costs). */
export function getBillsOfCase(stir: string, caseNumber: string, signal?: AbortSignal) {
  return request<{ bills: BillRow[] }>(`/api/bills/query?inn=${stir}&forCase=${encodeURIComponent(caseNumber)}`, signal)
}

// ---- Exports (binary downloads) -------------------------------------------------

export async function exportBillsXlsx(payload: unknown): Promise<void> {
  await downloadPost('/api/bills/export', payload)
}

export async function exportStatsXlsx(payload: unknown): Promise<void> {
  await downloadPost('/api/stats/export', payload)
}

/** v204 (P-C): cases-list export — server re-fetches, client just downloads. */
export async function exportCasesXlsx(params: { tin: string; courtTypes?: string[] }): Promise<void> {
  const q = new URLSearchParams({ tin: params.tin })
  if (params.courtTypes?.length) q.set('courtTypes', params.courtTypes.join(','))
  await downloadGet(`/api/court-cases/export?${q}`)
}

/** Upcoming-hearings export — the client posts the rows it already loaded so
 *  the server just builds the workbook (no unreliable server-side re-scrape). */
export async function exportHearingsXlsx(params: { tin: string; hearings: unknown[] }): Promise<void> {
  await downloadPost('/api/upcoming-hearings/export', { tin: params.tin, hearings: params.hearings })
}

/** Document engine — fill a .docx template and download it (Hujjatlar).
 *  `opts.letterhead` (base64 image) replaces the embedded banner; `opts.blank`
 *  blanks it when none is given (categories that offer the uploader). */
async function fetchDocumentBlob(
  docId: string,
  values: Record<string, string>,
  opts: { letterhead?: string; blank?: boolean; script?: UzScript },
): Promise<{ blob: Blob; filename: string }> {
  let res: Response
  try {
    res = await fetch('/api/documents/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ docId, values, letterhead: opts.letterhead || undefined, blankLetterhead: !!opts.blank, script: opts.script }),
    })
  } catch {
    throw new Error('Tarmoq xatosi — serverga ulanib boʻlmadi')
  }
  if (!res.ok) {
    let msg = 'Hujjatni yaratib boʻlmadi'
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch { /* binary */ }
    throw new Error(msg)
  }
  const m = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)
  return { blob: await res.blob(), filename: m?.[1] || 'hujjat.docx' }
}

function saveFile(blob: Blob, filename: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
}

export async function generateDocument(
  docId: string,
  values: Record<string, string>,
  opts: { letterhead?: string; blank?: boolean; script?: UzScript } = {},
): Promise<void> {
  const { blob, filename } = await fetchDocumentBlob(docId, values, opts)
  saveFile(blob, filename)
}

/** One document for MANY rows (a spreadsheet): one .docx per row, returned as one .zip. */
export async function generateDocumentsBulk(
  docId: string,
  rows: Record<string, string>[],
  opts: { letterhead?: string; blank?: boolean; script?: UzScript } = {},
): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/documents/generate-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ docId, rows, letterhead: opts.letterhead || undefined, blankLetterhead: !!opts.blank, script: opts.script }),
    })
  } catch {
    throw new Error('Tarmoq xatosi — serverga ulanib boʻlmadi')
  }
  if (!res.ok) {
    let msg = 'Hujjatlarni yaratib boʻlmadi'
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch { /* binary */ }
    throw new Error(msg)
  }
  const m = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)
  saveFile(await res.blob(), m?.[1] || 'hujjatlar.zip')
}

/** Several documents from ONE form as ONE .zip (the browser would otherwise ask to allow many downloads). */
export async function generateDocumentsZip(
  docIds: string[],
  values: Record<string, string>,
  opts: { letterhead?: string; blank?: boolean; script?: UzScript } = {},
  zipName = 'hujjatlar',
): Promise<void> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const id of docIds) {
    const { blob, filename } = await fetchDocumentBlob(id, values, opts)
    zip.file(filename, blob)
  }
  const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  saveFile(out, `${zipName}-${new Date().toISOString().slice(0, 10)}.zip`)
}

// ---- the operator's own templates (Hujjatlar › Oʻz shablonlarim) ----

export async function listCustomDocs(signal?: AbortSignal): Promise<import('@/lib/documents/custom').CustomMeta[]> {
  const res = await fetch('/api/documents/custom', { headers: authHeaders(), signal })
  const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null
  return j?.ok && Array.isArray(j.data) ? (j.data as import('@/lib/documents/custom').CustomMeta[]) : []
}

export async function uploadCustomDoc(file: File, title: string): Promise<{ meta: import('@/lib/documents/custom').CustomMeta; invalid: string[] }> {
  const form = new FormData()
  form.append('file', file)
  form.append('title', title)
  let res: Response
  try {
    res = await fetch('/api/documents/custom', { method: 'POST', headers: privilegedHeaders(), body: form })
  } catch {
    throw new Error('Tarmoq xatosi — serverga ulanib boʻlmadi')
  }
  const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: { meta: import('@/lib/documents/custom').CustomMeta; invalid: string[] }; error?: string } | null
  if (!res.ok || !j?.ok || !j.data) throw new Error(j?.error || 'Shablonni saqlab boʻlmadi')
  return j.data
}

export async function deleteCustomDoc(id: string): Promise<void> {
  const res = await fetch(`/api/documents/custom?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: privilegedHeaders() })
  if (!res.ok) throw new Error('Oʻchirib boʻlmadi')
}

/** Raw .docx template for the live preview (placeholders intact). */
export async function fetchDocTemplate(docId: string): Promise<ArrayBuffer> {
  let res: Response
  try {
    res = await fetch(`/api/documents/template?id=${encodeURIComponent(docId)}`, { headers: authHeaders() })
  } catch {
    throw new Error('Tarmoq xatosi — serverga ulanib boʻlmadi')
  }
  if (!res.ok) throw new Error('Shablonni yuklab boʻlmadi')
  return res.arrayBuffer()
}

/** Претензия engine — generate one .docx per contract (or a .zip) and download.
 *  The xlsx is parsed on the client; only the derived figures are posted. */
export async function generatePretenzia(payload: {
  claimDate: string
  lang: 'ru' | 'uz'
  letterhead?: string
  blankLetterhead?: boolean
  /** the Uzbek Latin alphabet (Uzbek talabnoma only) */
  script?: UzScript
  constants: Record<string, string>
  contracts: { no: string; date: string; mainDebtTiyin: number; paymentTiyin: number; delayStart: string }[]
  terms?: { ratePerDay: number; capFraction: number }
}): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/pretenzia/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new Error('Tarmoq xatosi — serverga ulanib boʻlmadi')
  }
  if (!res.ok) {
    let msg = 'Hujjatni yaratib boʻlmadi'
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch { /* binary */ }
    throw new Error(msg)
  }
  await saveBlob(res, 'pretenziya.docx')
}

async function saveBlob(res: Response, fallbackName: string): Promise<void> {
  const blob = await res.blob()
  const cd = res.headers.get('content-disposition') || ''
  const m = cd.match(/filename="([^"]+)"/)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = m?.[1] || fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
}

async function downloadGet(url: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, { headers: authHeaders() })
  } catch {
    throw new Error('Tarmoq xatosi — serverga ulanib boʻlmadi')
  }
  if (!res.ok) {
    let msg = 'Eksport xatosi'
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch { /* binary */ }
    throw new Error(msg)
  }
  await saveBlob(res, 'export.xlsx')
}

async function downloadPost(url: string, body: unknown): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Tarmoq xatosi — serverga ulanib boʻlmadi')
  }
  if (!res.ok) {
    let msg = 'Eksport xatosi'
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch { /* binary */ }
    throw new Error(msg)
  }
  await saveBlob(res, 'export.xlsx')
}


// ---- public court-order library (local index) ----------------------------------------------------

export interface PublicOrdersData {
  caseNumber: string
  orders: StoredOrder[]
  /** when this case was last looked up in the library (null = never); `seen` = instances with a published order */
  checked: { at: string; error: string | null; seen: string[] } | null
  downloading: boolean
}

/** Instant: reads the local cache. */
export function getPublicOrders(caseNumber: string, signal?: AbortSignal) {
  return request<PublicOrdersData>(`/api/public-orders/orders?caseNumber=${encodeURIComponent(caseNumber)}`, signal)
}

/** public.sud.uz wants a person to verify the download: the order has to be saved by hand and given to the app. */
export class ManualOrderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManualOrderError'
  }
}

/** What the app's server did with an order's PDF. */
export interface OrderPdfResult {
  blob: Blob
  /** false = it could not be kept on disk (`saveError` says why): the order is NOT «Yuklangan» */
  saved: boolean
  saveError?: string
}

/** The order's PDF bytes from the app's own server (which keeps a copy on disk). Throws `ManualOrderError` when the site wants a person. */
async function fetchOrderPdf(pdfId: string, name: string | undefined, retryAuto: boolean): Promise<OrderPdfResult> {
  const qs = `id=${encodeURIComponent(pdfId)}${name ? `&name=${encodeURIComponent(name)}` : ''}${retryAuto ? '&retry=1' : ''}`
  // 'no-store': the request must REACH the server every time. An answer from the browser's cache would never make the server
  // save the file, so the order could not become «Yuklangan» (this is what «Qayta yuklash» silently did before).
  const res = await fetch(`/api/public-orders/file?${qs}&_=${Date.now()}`, { headers: authHeaders(), cache: 'no-store' })
  if (!res.ok) {
    let msg = 'Qarorni olib boʻlmadi'
    let code = ''
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
      if (typeof j?.code === 'string') code = j.code
    } catch { /* not JSON */ }
    throw code === 'manual_required' ? new ManualOrderError(msg) : new Error(msg)
  }
  const saved = res.headers.get('X-Order-Saved') !== '0' // an older server sends no header: assume kept
  let saveError: string | undefined
  try {
    saveError = saved ? undefined : decodeURIComponent(res.headers.get('X-Order-Save-Error') ?? '')
  } catch { /* undecodable */ }
  return { blob: await res.blob(), saved, saveError }
}

/**
 * Open an order's PDF. The window is opened FIRST (inside the click, or popup blockers reject it),
 * then pointed at the file once it has arrived — the same trick the company report uses.
 * Throws `ManualOrderError` when the site refuses the automatic download (the card then offers the hand-over).
 * Returns whether the server also KEPT the file (false: it opened, but is not «Yuklangan»).
 */
export async function openPublicOrderPdf(pdfId: string, name?: string, opts: { retryAuto?: boolean } = {}): Promise<{ saved: boolean; saveError?: string }> {
  const win = window.open('', '_blank')
  if (!win) throw new Error('Brauzer oynani blokladi — pop-up ruxsatini bering')
  win.document.title = 'Qaror yuklanmoqda…'
  win.document.body.textContent = 'Qaror yuklanmoqda…'
  try {
    const r = await fetchOrderPdf(pdfId, name, opts.retryAuto === true)
    win.location.href = URL.createObjectURL(r.blob)
    return { saved: r.saved, saveError: r.saveError }
  } catch (e) {
    try { win.close() } catch { /* already closed */ }
    throw e
  }
}

/** Save an order's PDF on this computer WITHOUT opening it (the server stores it; «Yuklangan» then shows on the Qarorlar page). */
export async function downloadPublicOrderPdf(pdfId: string, name?: string, opts: { retryAuto?: boolean } = {}): Promise<{ saved: boolean; saveError?: string }> {
  const r = await fetchOrderPdf(pdfId, name, opts.retryAuto === true)
  return { saved: r.saved, saveError: r.saveError }
}

/** Hand an order's PDF, saved by the person from public.sud.uz, to the app (stored like an automatic download). */
export async function importPublicOrderPdf(pdfId: string, file: File): Promise<ApiResult<{ id: string; size: number }>> {
  try {
    const res = await fetch(`/api/public-orders/import?id=${encodeURIComponent(pdfId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
      body: file,
    })
    const json = await res.json().catch(() => null)
    if (json?.ok === true && json.data) return { ok: true, data: json.data }
    return { ok: false, error: json?.error || `Server javob bermadi (${res.status})`, status: res.status }
  } catch {
    return { ok: false, error: 'Tarmoq xatosi — serverga ulanib boʻlmadi' }
  }
}

/** Hand over a HAR file the person saved from their own browser; every order PDF in it is stored (lib/public-orders/har-import). */
export async function importPublicOrdersHar(file: File): Promise<ApiResult<{ saved: { id: string; size: number }[]; skipped: number; matched: string[]; orders: number; restored: number; seen: number }>> {
  try {
    const res = await fetch('/api/public-orders/import-har', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
      body: file,
    })
    const json = await res.json().catch(() => null)
    if (json?.ok === true && json.data && Array.isArray(json.data.saved)) return { ok: true, data: json.data }
    return { ok: false, error: json?.error || `Server javob bermadi (${res.status})`, status: res.status }
  } catch {
    return { ok: false, error: 'Tarmoq xatosi — serverga ulanib boʻlmadi' }
  }
}

/** One page of the Qarorlar archive (`GET /api/public-orders/library`): filtered and paged on the server, local disk only. */
export interface LibraryPage {
  total: number
  items: LibraryItem[]
  /** how the matches split by download state, before the status filter */
  counts: { all: number; saved: number; gone: number; never: number; hidden: number }
  page: number
  size: number
  /** PDFs on this computer / orders in the local index */
  savedPdfs: number
  stored: number
}
export function getPublicOrdersLibrary(
  f: { q: string; status: LibraryStatus; court: string; instance: string; page: number; size: number },
  signal?: AbortSignal,
) {
  const qs = new URLSearchParams({ q: f.q, status: f.status, court: f.court, instance: f.instance, page: String(f.page), size: String(f.size) })
  return request<LibraryPage>(`/api/public-orders/library?${qs}&_=${Date.now()}`, signal)
}

/** «Tozalangan» › «Butunlay oʻchirish»: delete every cleared order entirely (record and PDF file). Local only. */
export async function purgeHiddenOrders(): Promise<ApiResult<{ purged: number; files: number }>> {
  try {
    const res = await fetch('/api/public-orders/purge-hidden', { method: 'POST', headers: privilegedHeaders() })
    const json = await res.json().catch(() => null)
    if (json?.ok === true && json.data && typeof json.data.purged === 'number') return { ok: true, data: json.data }
    return { ok: false, error: json?.error || `Server javob bermadi (${res.status})`, status: res.status }
  } catch {
    return { ok: false, error: 'Tarmoq xatosi — serverga ulanib boʻlmadi' }
  }
}

/** «Tozalash» / «Qaytarish»: clear orders from the Qarorlar lists (their records are kept) or bring them back. Local state only. */
export async function setOrdersHidden(action: 'hide' | 'restore', ids: string[]): Promise<ApiResult<{ changed: number; total: number }>> {
  try {
    const res = await fetch('/api/public-orders/hidden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ action, ids }),
    })
    const json = await res.json().catch(() => null)
    if (json?.ok === true && json.data) return { ok: true, data: json.data }
    return { ok: false, error: json?.error || `Server javob bermadi (${res.status})`, status: res.status }
  } catch {
    return { ok: false, error: 'Tarmoq xatosi — serverga ulanib boʻlmadi' }
  }
}

/** «Barchasini yuklash» runs on the SERVER (lib/public-orders/download-job): these only start / stop / read / dismiss it, so leaving the page does not stop it. */
async function downloadJobCall(init?: RequestInit): Promise<ApiResult<DownloadJobState>> {
  try {
    const res = await fetch('/api/public-orders/download-job', { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...authHeaders() } })
    const json = await res.json().catch(() => null)
    // an error body (401, 429, 500) is JSON without the fields we read: never stored as the job
    if (json?.ok === true && json.data && typeof json.data.phase === 'string' && Array.isArray(json.data.problems)) return { ok: true, data: json.data as DownloadJobState }
    return { ok: false, error: json?.error || `Server javob bermadi (${res.status})`, status: res.status }
  } catch {
    return { ok: false, error: 'Tarmoq xatosi — serverga ulanib boʻlmadi' }
  }
}
export const getDownloadJob = () => downloadJobCall()
export const startDownloadJob = (ids: string[]) => downloadJobCall({ method: 'POST', body: JSON.stringify({ action: 'start', ids }) })
export const stopDownloadJob = () => downloadJobCall({ method: 'POST', body: JSON.stringify({ action: 'stop' }) })
export const clearDownloadJob = () => downloadJobCall({ method: 'POST', body: JSON.stringify({ action: 'clear' }) })

/** Orders the app removed from its metadata (their file could not be downloaded), and «Qaytarish» (all, or the given file ids). Local state only. */
export async function getPurgedOrders(): Promise<ApiResult<{ total: number; items: { pdfId: string; caseNumber: string; at: number }[] }>> {
  try {
    const res = await fetch('/api/public-orders/purged', { cache: 'no-store', headers: authHeaders() })
    const json = await res.json().catch(() => null)
    if (json?.ok === true && json.data && Array.isArray(json.data.items)) return { ok: true, data: json.data }
    return { ok: false, error: json?.error || `Server javob bermadi (${res.status})`, status: res.status }
  } catch {
    return { ok: false, error: 'Tarmoq xatosi — serverga ulanib boʻlmadi' }
  }
}
export async function restorePurgedOrders(ids?: string[]): Promise<ApiResult<{ restored: number }>> {
  try {
    const res = await fetch('/api/public-orders/purged', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ action: 'restore', ...(ids ? { ids } : {}) }) })
    const json = await res.json().catch(() => null)
    if (json?.ok === true && json.data && typeof json.data.restored === 'number') return { ok: true, data: json.data }
    return { ok: false, error: json?.error || `Server javob bermadi (${res.status})`, status: res.status }
  } catch {
    return { ok: false, error: 'Tarmoq xatosi — serverga ulanib boʻlmadi' }
  }
}

/** Queue cases for the BACKGROUND download of their published orders; returns at once. */
export async function fetchPublicOrders(
  cases: { caseNumber: string; courtType: string; sig?: string; result?: string; caseStatus?: string }[],
  opts: { force?: boolean; keepPaused?: boolean } = {},
): Promise<ApiResult<{ job: PublicOrdersStatus['job']; queued: number; ongoing: number; known: number }>> {
  try {
    const res = await fetch('/api/public-orders/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ action: 'start', cases, force: opts.force === true, keepPaused: opts.keepPaused === true }),
    })
    const json = await res.json().catch(() => null)
    if (json?.ok === true && json.data) {
      return { ok: true, data: json.data }
    }
    return { ok: false, error: json?.error || `Server javob bermadi (${res.status})`, status: res.status }
  } catch {
    return { ok: false, error: 'Tarmoq xatosi — serverga ulanib boʻlmadi' }
  }
}

export function getPublicOrdersCache(signal?: AbortSignal) {
  return request<OrdersCacheStats>('/api/public-orders/cache', signal)
}

/** Settings › Maʼlumotlar bazasi: the whole database as one file (`sud-YYYYMMDD.db`), downloaded through the browser. Privileged. */
export async function downloadDatabase(): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/settings/db/download', { headers: privilegedHeaders(), cache: 'no-store' })
  } catch {
    throw new Error('Tarmoq xatosi: serverga ulanib boʻlmadi')
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(j?.error || `Nusxa olib boʻlmadi (${res.status})`)
  }
  await saveBlob(res, 'sud.db')
}
