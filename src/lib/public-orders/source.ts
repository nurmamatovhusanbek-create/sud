import 'server-only'
import { fetchViaWorkers } from '@/lib/net/worker-fetch'
import type { PublicCourtType, RawPublication } from '@/core/public-orders'

/**
 * The public library's anonymous JSON API. Calls go through the owner's Cloudflare workers like every
 * other scraper (the operator IP stays hidden) — the worker must allow `adolatapi1.sud.uz`
 * (cloudflare-worker/proxy.js). `PUBLIC_ORDERS_DIRECT=1` fetches straight from this machine instead,
 * for an owner who accepts exposing their own IP to a public, anonymous API.
 */

const BASE = process.env.PUBLIC_ORDERS_API || 'https://adolatapi1.sud.uz'
const DIRECT = process.env.PUBLIC_ORDERS_DIRECT === '1'
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
