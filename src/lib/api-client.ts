/**
 * The typed API client (arch guide §3.2) — the ONLY module allowed to fetch.
 * Components call these functions through useResource/useStream; no fetch()
 * lives anywhere else. Every call is abortable and maps server envelopes (and
 * legacy shapes) into ApiResult<T>.
 */

import type {
  ApiResult,
  BillDetailData,
  BillStreamMessage,
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

function authHeaders(): HeadersInit {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}
}

async function request<T>(url: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { signal, headers: authHeaders() })
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
  }
}

// ---- Endpoint functions ------------------------------------------------------

export function getStats(tin: string, opts?: { force?: boolean; signal?: AbortSignal }) {
  return request<CompanyStats>(`/api/stats?tin=${tin}${opts?.force ? '&force=1' : ''}`, opts?.signal)
}

export function getCompanyInfo(tin: string, opts?: { force?: boolean; signal?: AbortSignal }) {
  return request<CompanyInfoData>(`/api/company-info?tin=${tin}${opts?.force ? '&force=1' : ''}`, opts?.signal)
}

export function searchCases(params: { courtType: string; mode: string; value: string }, signal?: AbortSignal) {
  const q = new URLSearchParams({ courtType: params.courtType, mode: params.mode, value: params.value })
  return request<{ cases: CourtCase[] }>(`/api/court-cases?${q}`, signal)
}

export function getCaseDetail(courtType: string, caseNumber: string, signal?: AbortSignal) {
  const q = new URLSearchParams({ courtType, detail: caseNumber })
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

// ---- Bills stream (the NDJSON contract) ----------------------------------------

export interface StreamHandlers {
  onPhase?: (phase: string, detail?: string) => void
  onMeta?: (total: number) => void
  onBill?: (bill: EnrichedBill, index: number) => void
  onDone?: () => void
  onError?: (error: string) => void
}

export async function streamBills(stir: string, handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
  try {
    const res = await fetch(`/api/bills?inn=${stir}`, { signal, headers: authHeaders() })
    if (!res.ok || !res.body) {
      let msg = `Server xatosi (${res.status})`
      try {
        const j = await res.json()
        if (j?.error) msg = j.error
      } catch { /* stream content-type — ignore */ }
      handlers.onError?.(msg)
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        let msg: BillStreamMessage
        try {
          msg = JSON.parse(line) as BillStreamMessage
        } catch {
          continue
        }
        switch (msg.type) {
          case 'meta': handlers.onMeta?.(msg.total); break
          case 'phase': handlers.onPhase?.(msg.phase, msg.detail); break
          case 'bill': handlers.onBill?.(msg.bill, msg.index); break
          case 'done': handlers.onDone?.(); break
          case 'error': handlers.onError?.(msg.error); break
        }
      }
    }
    handlers.onDone?.()
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return
    handlers.onError?.('Tarmoq xatosi — serverga ulanib boʻlmadi')
  }
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

/** Document engine — fill a .docx template and download it (Hujjatlar). */
export async function generateDocument(docId: string, values: Record<string, string>): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/documents/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ docId, values }),
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
  await saveBlob(res, 'hujjat.docx')
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
