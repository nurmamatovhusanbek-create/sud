/**
 * chamber.uz — Chamber of Commerce contractor rating API client.
 *
 * Fetches company rating data from admin.chamber.uz/api/GetCompanyCriteries/{STIR}
 * Returns: rating score (0-100), category (AAA-D), taxpayer type, region, industry.
 *
 * No authentication required — completely free.
 */

import 'server-only'

// ---- Types ---------------------------------------------------------------

export interface ChamberRating {
  tin: string
  name: string
  nameRu: string
  nameLat: string
  /** Rating score 0-100 */
  criteriaAll: number
  /** Rating category: AAA, AA, A, BBB, BB, B, CCC, CC, C, D */
  type: string
  /** Taxpayer type ID */
  taxpayerType: number
  /** Taxpayer type name (e.g. "SDT" = Large Taxpayer) */
  taxpayername: string
  regionNameUz: string
  regionNameLat: string
  districtNameUz: string
  districtNameLat: string
  okedCode: string
  okedName: string
  okedNameRu: string
  okedSection: string
  okedShortName: string
  employeeLimitMf: number
  employeeLimitLf: number
}

// ---- CF Worker proxy helper ----------------------------------------------

// v150 P3: Uses shared cf-worker-pool.ts instead of duplicate logic.
// chamber-fix: Import getCfWorkerUrls to fire ALL workers in PARALLEL
// (Promise.allSettled race) instead of round-robin picking just one.
// A single slow/dead worker can no longer cause the Company tab to show
// no rating — as long as ANY worker reaches chamber.uz within 10s, we win.
import { getCfWorkerUrls } from './cf-worker-pool'

// ---- API -----------------------------------------------------------------

/**
 * Fetch contractor rating for a company by STIR from chamber.uz.
 *
 * GET https://admin.chamber.uz/api/GetCompanyCriteries/{STIR}
 * Returns rating score, category, taxpayer type, region, industry info.
 *
 * chamber-fix: Fires ALL CF Workers in PARALLEL (Promise.allSettled) and
 * takes the first successful response. Mirrors the resilient strategy
 * already used in court-case.ts: if one worker is slow/dead, the others
 * still deliver. 10s timeout per request, same ChamberRating | null return.
 */
export async function getCompanyRating(tin: string): Promise<ChamberRating | null> {
  const cleanTin = tin.trim()
  if (!/^\d{9}$/.test(cleanTin)) return null

  const targetUrl = `https://admin.chamber.uz/api/GetCompanyCriteries/${cleanTin}`
  const workers = getCfWorkerUrls()

  console.log(`[chamber] fetching rating for TIN ${cleanTin} via ${workers.length} workers in parallel`)

  // Fire ALL workers simultaneously. 10s timeout per request. Each promise
  // resolves with { workerUrl, data } on success or rejects on any failure
  // (timeout, HTTP error, parse error, no data.tin). The first fulfilled
  // result with valid data wins; the rest are ignored.
  const results = await Promise.allSettled(
    workers.map(async (workerUrl) => {
      const proxiedUrl = workerUrl + targetUrl
      const res = await fetch(proxiedUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      // Check if we got actual company data (not an error/empty response)
      if (!data || !data.tin) {
        throw new Error('no data')
      }
      return { workerUrl, data }
    }),
  )

  // Take the FIRST successful response with valid data.
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { workerUrl, data } = r.value
      let workerLabel = workerUrl
      try { workerLabel = new URL(workerUrl).hostname } catch { /* keep raw URL */ }
      console.log(`[chamber] TIN ${cleanTin} — worker ${workerLabel} succeeded`)
      return {
        tin: data.tin,
        name: data.name || data.nameUz || '',
        nameRu: data.nameRu || '',
        nameLat: data.nameLat || data.nameUz || '',
        criteriaAll: data.criteriaAll ?? 0,
        type: data.type || '-',
        taxpayerType: data.taxpayerType ?? 0,
        taxpayername: data.taxpayername || data.taxpayer_name_uz_latn || '',
        regionNameUz: data.regionNameUz || '',
        regionNameLat: data.regionNameLat || '',
        districtNameUz: data.districtNameUz || '',
        districtNameLat: data.districtNameLat || '',
        okedCode: data.okedDetail?.code || '',
        okedName: data.okedDetail?.name_uz_latn || data.okedDetail?.name || '',
        okedNameRu: data.okedDetail?.name_ru || '',
        okedSection: data.okedDetail?.section || '',
        okedShortName: data.okedDetail?.name_short_ru || '',
        employeeLimitMf: data.okedDetail?.employee_limit_mf ?? 0,
        employeeLimitLf: data.okedDetail?.employee_limit_lf ?? 0,
      }
    }
  }

  // All workers failed (timeout, HTTP error, or no data).
  const reasons = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => (r.reason instanceof Error ? r.reason.message : String(r.reason)))
  console.log(`[chamber] all ${workers.length} workers failed for TIN ${cleanTin}: ${reasons.join(', ')}`)
  return null
}

/**
 * Get the rating category color based on score.
 * AAA-AA: green, A-BBB: blue, BB-B: amber, CCC-D: red
 */
export function getRatingColor(type: string): string {
  if (['AAA', 'AA', 'A'].includes(type)) return '#34d399' // emerald
  if (['BBB'].includes(type)) return '#38bdf8' // cyan
  if (['BB', 'B'].includes(type)) return '#f59e0b' // amber
  return '#f43f5e' // rose for CCC, CC, C, D
}

/**
 * Get the rating category label in Uzbek.
 */
export function getRatingLabel(type: string): string {
  const labels: Record<string, string> = {
    'AAA': 'Yuqori',
    'AA': 'Yuqori',
    'A': 'Yuqori',
    'BBB': "Oʻrta",
    'BB': "Oʻrta",
    'B': "Oʻrta",
    'CCC': 'Qoniqarli',
    'CC': 'Qoniqarli',
    'C': 'Qoniqarli',
    'D': 'Quyi',
  }
  return labels[type] || 'Noma\'lum'
}
