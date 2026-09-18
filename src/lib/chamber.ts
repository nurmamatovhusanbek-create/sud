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

// v206 (rate-limit fix): chamber no longer fires ALL workers in parallel.
// One hedged call through the shared scheduler (`net/worker-fetch`) — best
// worker first, second only after hedgeMs, capped at maxAttempts. A dead
// worker is still covered by the failover; we just stop paying 6× per call.
import { fetchViaWorkers } from './net/worker-fetch'

// ---- API -----------------------------------------------------------------

/**
 * Fetch contractor rating for a company by STIR from chamber.uz.
 *
 * GET https://admin.chamber.uz/api/GetCompanyCriteries/{STIR}
 * Returns rating score, category, taxpayer type, region, industry info.
 *
 * v206: single hedged scheduler call, same ChamberRating | null return.
 */
export async function getCompanyRating(tin: string): Promise<ChamberRating | null> {
  const cleanTin = tin.trim()
  if (!/^\d{9}$/.test(cleanTin)) return null

  const targetUrl = `https://admin.chamber.uz/api/GetCompanyCriteries/${cleanTin}`

  let data: {
    tin?: string
    name?: string
    nameUz?: string
    nameRu?: string
    nameLat?: string
    criteriaAll?: number
    type?: string
    taxpayerType?: number
    taxpayername?: string
    taxpayer_name_uz_latn?: string
    regionNameUz?: string
    regionNameLat?: string
    districtNameUz?: string
    districtNameLat?: string
    okedDetail?: {
      code?: string
      name_uz_latn?: string
      name?: string
      name_ru?: string
      section?: string
      name_short_ru?: string
      employee_limit_mf?: number
      employee_limit_lf?: number
    }
  } | null = null
  try {
    const res = await fetchViaWorkers(targetUrl, {
      originKey: 'admin.chamber.uz',
      timeoutMs: 10_000,
      hedgeMs: 700,
      maxAttempts: 3,
      headers: { Accept: 'application/json' },
    })
    if (res.ok) data = await res.json()
  } catch {
    /* all workers failed */
  }
  if (!data || !data.tin) {
    console.log(`[chamber] no rating data for TIN ${cleanTin} (workers exhausted or empty body)`)
    return null
  }
  console.log(`[chamber] TIN ${cleanTin} — rating via scheduler (admin.chamber.uz)`)
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
