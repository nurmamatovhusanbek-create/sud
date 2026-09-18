import 'server-only'
import { createWorkerPool } from '@/lib/cf-worker-pool'
import type { CourtType } from '@/lib/court-case-types'

/**
 * v205 (§5.5): One court/date docket fetch, ETag-aware, through the shared
 * CF worker pool.
 *
 * LIVE-VERIFIED (2026-09): the vka endpoint only serves TODAY/FUTURE dockets —
 * a past date returns 400 "Нотўғри сана белгиланган". The crawler therefore
 * walks the upcoming window; past rows accumulate in the index from earlier
 * sweeps (see crawler/index.ts).
 *
 * Date format on the path is DDMMYYYY (same as jadval2.ts uses in production).
 */

const pool = createWorkerPool()
const VKA = 'https://jadvalapi.sud.uz/vka'

// vka path uses the API's TYPE token, not our lowercase courtType.
const TYPE_TOKEN: Record<CourtType, string> = {
  economic: 'ECONOMIC',
  civil: 'CIVIL',
  administrative: 'CONFLICT',
  criminal: 'CRIMINAL',
}

export interface VkaRow {
  casenumber: string
  case_id?: string
  hearing_date?: string // DD.MM.YYYY
  hearing_time?: string
  responsible?: string // judge
  instance?: string
  category?: string
  claimtype?: string
  claiment?: string // plaintiff (API typo, kept verbatim)
  defendant?: string
  court?: string
  region?: string
  globalid?: string
}

export interface VkaResult {
  status: number
  etag: string | null
  rows: VkaRow[] // empty on 304 / not-modified (caller keeps prior data)
  notModified: boolean
}

/** DDMMYYYY for the vka path. */
export function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}${p(d.getMonth() + 1)}${d.getFullYear()}`
}

/** Fetch one court/date docket through a worker, honoring a stored ETag. */
export async function fetchVka(
  courtId: string,
  courtType: CourtType,
  date: Date,
  priorEtag?: string | null,
  timeoutMs = 12000,
): Promise<VkaResult> {
  const target = `${VKA}/${TYPE_TOKEN[courtType]}/${encodeURIComponent(courtId)}/${ddmmyyyy(date)}`
  const proxied = pool.nextProxyUrl(target) // worker + target
  const res = await fetch(proxied, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      Origin: 'https://jadval2.sud.uz',
      Referer: 'https://jadval2.sud.uz/',
      ...(priorEtag ? { 'If-None-Match': priorEtag } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 304) {
    return { status: 304, etag: priorEtag ?? null, rows: [], notModified: true }
  }
  if (!res.ok) return { status: res.status, etag: null, rows: [], notModified: false }

  const etag = res.headers.get('etag')
  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { status: res.status, etag, rows: [], notModified: false }
  }
  const rows = (Array.isArray(data) ? data : (data as Record<string, unknown>)?.data ?? []) as VkaRow[]
  return { status: res.status, etag, rows, notModified: false }
}
