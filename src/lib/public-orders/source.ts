import 'server-only'
import { fetchViaWorkers } from '@/lib/net/worker-fetch'
import type { PublicCourtType, RawPublication } from '@/core/public-orders'

/**
 * The public library's anonymous JSON API. By the owner's choice it is called DIRECTLY from this machine
 * (no worker redeploy needed; it is a public, anonymous API, so the only thing exposed is the machine's IP).
 * Set `PUBLIC_ORDERS_VIA_WORKERS=1` to route through the Cloudflare workers instead — that needs
 * cloudflare-worker/proxy.js (which already allows `adolatapi1.sud.uz`) redeployed.
 */

const BASE = process.env.PUBLIC_ORDERS_API || 'https://adolatapi1.sud.uz'
const DIRECT = process.env.PUBLIC_ORDERS_VIA_WORKERS !== '1'
const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://public.sud.uz',
  Referer: 'https://public.sud.uz/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
}

async function fetchUpstream(path: string, opts: { timeoutMs: number; background: boolean }): Promise<Response> {
  const url = BASE + path
  if (DIRECT) return fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(opts.timeoutMs) })
  return fetchViaWorkers(url, {
    originKey: 'adolatapi1.sud.uz',
    headers: HEADERS,
    timeoutMs: opts.timeoutMs,
    maxAttempts: 2,
    hedgeMs: opts.timeoutMs, // idempotent, but a crawl should not double its own load: fail over, don't race
    priority: opts.background ? 'background' : 'interactive',
  })
}

export interface ListPage {
  rows: RawPublication[]
  /** the API's own count for this window (null when it reports none) */
  total: number | null
}

export interface ListParams {
  courtType: PublicCourtType
  /** inclusive ISO days */
  startDate: string
  endDate: string
  page: number
  size?: number
}

/** One page of a date window — the fast, indexed query (≈0.1–0.2 s for 100 rows). */
export async function listPage(p: ListParams): Promise<ListPage> {
  const qs = new URLSearchParams({
    court_type: p.courtType,
    startDate: p.startDate,
    endDate: p.endDate,
    size: String(p.size ?? 100),
    page: String(p.page),
  })
  const res = await fetchUpstream(`/publications/list?${qs}`, { timeoutMs: 30_000, background: true })
  if (!res.ok) throw new Error(`public.sud.uz list: HTTP ${res.status}`)
  const json = (await res.json()) as { content?: RawPublication[]; totalElements?: number | null }
  if (!json || !Array.isArray(json.content)) throw new Error('public.sud.uz list: unexpected response shape')
  return { rows: json.content, total: typeof json.totalElements === 'number' ? json.totalElements : null }
}

/** The raw multipart-wrapped order file (see core/public-orders.ts → parseMultipartFile). */
export async function fetchOrderFile(pdfId: string): Promise<Uint8Array> {
  const res = await fetchUpstream(`/public/onStream/${pdfId}`, { timeoutMs: 45_000, background: false })
  if (!res.ok) throw new Error(`public.sud.uz file: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** The slow upstream search for ONE case in ONE instance (~10 s). Only ever called from the background job. */
export async function searchCase(caseNumber: string, courtType: PublicCourtType, instance: string): Promise<RawPublication[]> {
  const qs = new URLSearchParams({ court_type: courtType, case_number: caseNumber, instance, size: '30', page: '0' })
  const res = await fetchUpstream(`/publications/list?${qs}`, { timeoutMs: 150_000, background: true })
  if (!res.ok) throw new Error(`public.sud.uz search: HTTP ${res.status}`)
  const json = (await res.json()) as { content?: RawPublication[] }
  if (!json || !Array.isArray(json.content)) throw new Error('public.sud.uz search: unexpected response shape')
  return json.content
}
