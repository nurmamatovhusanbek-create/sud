import { NextRequest } from 'next/server'
import { getCompanyByTin } from '@/lib/orginfo'
import { findCourtsByAddress, findBestCourt, getAllCourts, type CourtEntry } from '@/lib/court-map'
import { scanDateRange, fetchHearingsForDate } from '@/lib/jadval2'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

/**
 * GET /api/court-hearings?tin=XXXXXXXXX&days=90
 *   1. Look up company name + address from orginfo.uz by STIR
 *   2. Find matching court from the court map (or use courtId param for manual selection)
 *   3. Scan jadvalapi.sud.uz for hearings matching the company name
 *   4. Return matching hearings (past + future) + company info + court info + all regional courts
 *
 * GET /api/court-hearings?tin=XXX&courtId=andtfsud&days=90
 *   Same as above but uses the specified courtId instead of auto-matching.
 *
 * GET /api/court-hearings?courtId=andtfsud&date=09072026
 *   Browse: fetch hearings for a specific court on a specific date (no company filter).
 */
async function GET_impl(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tin = searchParams.get('tin')?.trim()
  const courtId = searchParams.get('courtId')?.trim()
  const date = searchParams.get('date')?.trim()
  const days = Math.min(parseInt(searchParams.get('days') ?? '90'), 365)

  // Mode 1: browse a specific court on a specific date
  if (courtId && date) {
    const courts = getAllCourts()
    const court = courts.find(c => c.id === courtId)
    const hearings = await fetchHearingsForDate(courtId, date, 'CIVIL')
    return Response.json({
      ok: true,
      court: court?.name ?? courtId,
      date,
      hearings,
    })
  }

  // Mode 2: search by STIR
  if (!tin || !/^\d{9}$/.test(tin)) {
    return Response.json(
      { ok: false, error: 'Provide a valid 9-digit TIN, or courtId + date' },
      { status: 400 },
    )
  }

  try {
    console.log(`[court-hearings] looking up company for TIN ${tin}`)
    const company = await getCompanyByTin(tin)
    if (!company) {
      return Response.json({ ok: false, error: 'Company not found on orginfo.uz' }, { status: 404 })
    }

    const companyName = company.officialName || company.shortName || ''
    if (!companyName) {
      return Response.json({ ok: false, error: 'Company name not found' }, { status: 404 })
    }

    console.log(`[court-hearings] company: "${companyName}", address: "${company.address}"`)

    // Find matching court — either from courtId param (manual) or auto-match
    let court: CourtEntry | null = null
    if (courtId) {
      court = getAllCourts().find(c => c.id === courtId) ?? null
      console.log(`[court-hearings] using manual court: ${courtId} (${court?.name ?? 'not found'})`)
    } else {
      court = findBestCourt(company.address)
    }

    const allCourts = findCourtsByAddress(company.address)

    if (!court) {
      return Response.json({
        ok: true,
        company: { name: companyName, address: company.address, tin },
        courts: allCourts.length > 0 ? allCourts : getAllCourts(),
        hearings: [],
        message: 'Select a court to search for hearings.',
      })
    }

    console.log(`[court-hearings] court: ${court.id} (${court.name}), scanning ${days} days forward`)

    // Scan date range — FUTURE ONLY (today + N days forward).
    // jadvalapi.sud.uz/vka rejects ALL past dates with HTTP 400
    // ("Нотўғри сана белгиланган"). Scanning past dates was wasting
    // half the requests. Now we only scan today → today+days.
    const today = new Date()
    const startDate = new Date(today)
    const endDate = new Date(today)
    endDate.setDate(today.getDate() + days)

    const result = await scanDateRange(
      court.id,
      court.name,
      companyName,
      startDate,
      endDate,
    )

    return Response.json({
      ok: true,
      company: { name: companyName, address: company.address, tin },
      court: { id: court.id, name: court.name, region: court.region },
      allCourts: allCourts.length > 0 ? allCourts : getAllCourts(),
      hearings: result.hearings,
      datesScanned: result.datesScanned,
      totalFound: result.totalFound,
    })
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 502 },
    )
  }
}

export const GET = guard(GET_impl)
