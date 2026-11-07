import 'server-only'
import { fetchViaWorkers, pickWorker } from '@/lib/net/worker-fetch'
import { directRoute } from '@/lib/net/direct-route'
import { getCaptchaToken, PUBLIC_DOWNLOAD_CAPTCHA } from '@/lib/billing'
import { DIRECT, fetchOrderFileWith, type OrderFileDeps } from './order-file'
import type { PublicCourtType, RawPublication } from '@/core/public-orders'

/**
 * The public library's anonymous JSON API. By the owner's choice it is called DIRECTLY from this machine
 * (no worker redeploy needed; it is a public, anonymous API, so the only thing exposed is the machine's IP).
 * Set `PUBLIC_ORDERS_VIA_WORKERS=1` to route through the Cloudflare workers instead — that needs
 * cloudflare-worker/proxy.js (which already allows `adolatapi1.sud.uz`) redeployed.
 */

const PUBLIC_ORIGIN = 'https://public.sud.uz'
const BASE = process.env.PUBLIC_ORDERS_API || 'https://adolatapi1.sud.uz'
const DIRECT_LIST = process.env.PUBLIC_ORDERS_VIA_WORKERS !== '1'
const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://public.sud.uz',
  Referer: 'https://public.sud.uz/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
}

async function fetchUpstream(path: string, opts: { timeoutMs: number; background: boolean }): Promise<Response> {
  const url = BASE + path
  if (DIRECT_LIST) return fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(opts.timeoutMs) })
  return fetchViaWorkers(url, {
    originKey: 'adolatapi1.sud.uz',
    headers: HEADERS,
    timeoutMs: opts.timeoutMs,
    maxAttempts: 2,
    hedgeMs: opts.timeoutMs, // idempotent, but a crawl should not double its own load: fail over, don't race
    priority: opts.background ? 'background' : 'interactive',
  })
}

const realDeps: OrderFileDeps = {
  getToken: (route) => getCaptchaToken(3, undefined, route === DIRECT ? directRoute(PUBLIC_ORIGIN) : route, PUBLIC_DOWNLOAD_CAPTCHA),
  download: async (pdfId, token, route) => {
    const url = `${BASE}/public/onStream/${pdfId}?recaptcha_token=${encodeURIComponent(token)}`
    // never race a duplicate: the first request spends the token
    const res =
      route === DIRECT
        ? await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(45_000), redirect: 'manual' })
        : await fetchViaWorkers(url, { originKey: 'adolatapi1.sud.uz', headers: HEADERS, timeoutMs: 45_000, maxAttempts: 1, hedgeMs: 45_000, priority: 'interactive', worker: route })
    const body = new Uint8Array(await res.arrayBuffer())
    if (!res.ok) console.error(`[orders-file] ${route === DIRECT ? 'direct' : 'worker'} HTTP ${res.status}: ${Buffer.from(body.subarray(0, 200)).toString('utf8').replace(/\s+/g, ' ')}`)
    return { status: res.status, body }
  },
  pick: pickWorker,
}

/**
 * The raw multipart-wrapped order file (see core/public-orders.ts → parseMultipartFile). public.sud.uz wants a captcha
 * token on the download; the retry/pinning rules live in order-file.ts.
 */
export async function fetchOrderFile(pdfId: string): Promise<Uint8Array> {
  return fetchOrderFileWith(pdfId, realDeps)
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
