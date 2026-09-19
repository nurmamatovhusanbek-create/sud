/**
 * Source registry — one adapter per portal (blueprint §3.1, P3).
 *
 * Each adapter wraps the untouched scraper lib behind the SourceAdapter seam.
 * Cache policies read TTLs from the typed config; `force` bypasses where the
 * lib exposes a cache-clearing hook.
 */

import { z } from 'zod'
import { config } from '@/server/config'
import { defineSource } from './types'
import {
  CompanyStatsSchema,
  CompanyInfoResponseSchema,
  CourtCasesResponseSchema,
} from '@/core/schemas'
import type { CourtType, SearchMode } from '@/lib/court-case-types'

// ---- stats (orginfo + chamber + 3 court searches, classified) --------------

import { getCompanyStats, type CompanyStats } from '@/lib/stats'

export const statsSource = defineSource<string, CompanyStats>({
  name: 'stats',
  run: async (tin, ctx) => {
    if (ctx?.force) {
      const { clearCourtCaseCache } = await import('@/lib/court-case')
      clearCourtCaseCache(tin)
    }
    // v206: force also bypasses the 60s statsCache inside getCompanyStats.
    return getCompanyStats(tin, { force: ctx?.force })
  },
  schema: CompanyStatsSchema as unknown as z.ZodType<CompanyStats>,
})

// ---- company info (orginfo.uz + chamber.uz) ---------------------------------

import { getCompanyByTin } from '@/lib/orginfo'
import { getCompanyRating } from '@/lib/chamber'

export interface CompanyInfoMapped {
  tin: string
  officialName: string
  shortName: string
  registeredDate: string
  status: string
  address: string
  director: string
  phone: string
  email: string
  charterCapital: string
  registeringAuthority: string
  thsht: string
  dbibt: string
  ifut: string
  founders: { name?: string; share?: string }[]
  orgInfoUrl: string
}

export interface RatingMapped {
  score: unknown
  category: string | null
  taxpayerType: string | null
  region: string | null
  district: string | null
  okedCode: string | null
  okedName: string | null
  okedNameRu: string | null
  okedSection: string | null
  okedShortName: string | null
  employeeLimitMf: unknown
  employeeLimitLf: unknown
}

export interface CompanyInfoPayload {
  company: CompanyInfoMapped | null
  rating: RatingMapped | null
  /** Which independent sources failed while the other succeeded. */
  partial: { source: string; error: string }[]
}

const CompanyInfoPayloadSchema = z.object({
  company: CompanyInfoResponseSchema.shape.company.nullable(),
  rating: CompanyInfoResponseSchema.shape.rating.nullable(),
  partial: z.array(z.object({ source: z.string(), error: z.string() })),
})

export const companyInfoSource = defineSource<string, CompanyInfoPayload>({
  name: 'company-info',
  cachePolicy: { key: (tin) => `company-info:${tin}`, ttlMs: () => config.cache.ttl.companyMs },
  run: async (tin) => {
    const partial: { source: string; error: string }[] = []
    const [orginfoResult, chamberResult] = await Promise.allSettled([
      getCompanyByTin(tin),
      getCompanyRating(tin),
    ])
    const company = orginfoResult.status === 'fulfilled' ? orginfoResult.value : null
    const rating = chamberResult.status === 'fulfilled' ? chamberResult.value : null
    if (orginfoResult.status === 'rejected') {
      partial.push({ source: 'orginfo', error: orginfoResult.reason instanceof Error ? orginfoResult.reason.message : String(orginfoResult.reason) })
    }
    if (chamberResult.status === 'rejected') {
      partial.push({ source: 'chamber', error: chamberResult.reason instanceof Error ? chamberResult.reason.message : String(chamberResult.reason) })
    }
    if (!company && !rating) throw new Error('Kompaniya orginfo.uz yoki chamber.uz saytlarida topilmadi')
    return {
      company: company
        ? ({
            tin: company.tin,
            officialName: company.officialName || '',
            shortName: company.shortName || '',
            registeredDate: company.registeredDate || '',
            status: company.status || '',
            address: company.address || '',
            director: company.director || '',
            phone: company.phone || '',
            email: company.email || '',
            charterCapital: company.charterCapital || '',
            registeringAuthority: company.registeringAuthority || '',
            thsht: company.thsht || '',
            dbibt: company.dbibt || '',
            ifut: company.ifut || '',
            founders: company.founders || [],
            orgInfoUrl: company.orgInfoUrl || '',
          } as CompanyInfoMapped)
        : null,
      rating: rating
        ? ({
            score: rating.criteriaAll,
            category: rating.type,
            taxpayerType: rating.taxpayername,
            region: rating.regionNameLat || rating.regionNameUz,
            district: rating.districtNameLat || rating.districtNameUz,
            okedCode: rating.okedCode,
            okedName: rating.okedName,
            okedNameRu: rating.okedNameRu,
            okedSection: rating.okedSection,
            okedShortName: rating.okedShortName,
            employeeLimitMf: rating.employeeLimitMf,
            employeeLimitLf: rating.employeeLimitLf,
          } as RatingMapped)
        : null,
      partial,
    }
  },
  schema: CompanyInfoPayloadSchema as unknown as z.ZodType<CompanyInfoPayload>,
})

// ---- court cases -------------------------------------------------------------

import { searchCourtCases, getCaseDetails, type FullCaseData } from '@/lib/court-case'

export interface CourtSearchParams {
  courtType: CourtType
  mode: SearchMode
  value: string
}

export const courtCasesSource = defineSource<CourtSearchParams, Awaited<ReturnType<typeof searchCourtCases>>>({
  name: 'court-cases',
  cachePolicy: {
    key: (p) => `court:${p.courtType}:${p.mode}:${p.value}`,
    ttlMs: () => config.cache.ttl.courtCaseMs,
  },
  run: (p) => searchCourtCases(p.courtType, p.mode, p.value),
  schema: CourtCasesResponseSchema.shape.cases as unknown as z.ZodType<Awaited<ReturnType<typeof searchCourtCases>>>,
})

export const caseDetailSource = defineSource<{ courtType: CourtType; caseNumber: string }, FullCaseData>({
  name: 'case-detail',
  run: (p) => getCaseDetails(p.courtType, p.caseNumber),
})

// ---- upcoming hearings (3 court-type searches + upcoming filter, mirrors the
// shipped /api/upcoming-hearings workflow; criminal skipped for TINs) --------

export interface UpcomingHearing extends Record<string, unknown> {
  isoDate: string
  courtType: CourtType
  courtTypeLabel: string
}

export interface UpcomingHearingsPayload {
  tin: string
  count: number
  hearings: UpcomingHearing[]
}

export const upcomingHearingsSource = defineSource<string, UpcomingHearingsPayload>({
  name: 'upcoming-hearings',
  cachePolicy: { key: (tin) => `upcoming:${tin}`, ttlMs: () => config.cache.ttl.upcomingMs },
  run: async (tin) => {
    const courtTypes: CourtType[] = ['economic', 'civil', 'administrative']
    const results = await Promise.allSettled(
      courtTypes.map(async (ct) => {
        try {
          return await searchCourtCases(ct, 'tin', tin)
        } catch {
          return []
        }
      }),
    )
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().slice(0, 10)
    const allHearings: UpcomingHearing[] = []
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      const ct = courtTypes[results.indexOf(result)]
      for (const c of result.value) {
        if (!c.hearingDate || c.hearingDate === '—' || c.hearingDate === '-' || c.hearingDate === 'null') continue
        const m = c.hearingDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
        if (!m) continue
        const isoDate = `${m[3]}-${m[2]}-${m[1]}`
        if (isoDate < todayStr) continue
        allHearings.push({ ...c, courtType: ct, isoDate, courtTypeLabel: ct.charAt(0).toUpperCase() + ct.slice(1) })
      }
    }
    allHearings.sort((a, b) => {
      const da = (a as { hearingTime?: string }).hearingTime || '00:00'
      const db = (b as { hearingTime?: string }).hearingTime || '00:00'
      return (a.isoDate + da).localeCompare(b.isoDate + db)
    })
    return { tin, count: allHearings.length, hearings: allHearings }
  },
})
