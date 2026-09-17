import { NextRequest, NextResponse } from 'next/server'
import { getCompanyByTin, getCompanyByName, searchCompanies, lookupTinByName } from '@/lib/orginfo'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 15

/**
 * GET /api/company?tin=302678824
 *   -> Returns full company profile by TIN from orginfo.uz
 *
 * GET /api/company?name=ARTIKUL+AZIYA+KABEL
 *   -> Returns full company profile by name from orginfo.uz
 *
 * GET /api/company?name=ARTIKUL+AZIYA+KABEL&tinOnly=true
 *   -> Returns just the TIN (FAST: 1 HTTP request instead of 2-3)
 *
 * GET /api/company?search=ARTIKUL
 *   -> Returns list of matching companies (search results)
 */
async function GET_impl(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tin = searchParams.get('tin')?.trim()
  const name = searchParams.get('name')?.trim()
  const search = searchParams.get('search')?.trim()
  const tinOnly = searchParams.get('tinOnly') === 'true'

  // Search mode — return list of results
  if (search) {
    try {
      const results = await searchCompanies(search)
      return NextResponse.json({ ok: true, results })
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : 'Search failed' },
        { status: 502 },
      )
    }
  }

  // Name lookup
  if (name) {
    try {
      // Fast TIN-only mode: skip fetching org detail page (saves 5-10s)
      if (tinOnly) {
        const foundTin = await lookupTinByName(name)
        if (!foundTin) {
          return NextResponse.json(
            { ok: false, error: `No TIN found for name "${name}"` },
            { status: 404 },
          )
        }
        return NextResponse.json({ ok: true, company: { tin: foundTin } })
      }

      // Full profile mode
      const company = await getCompanyByName(name)
      if (!company) {
        return NextResponse.json(
          { ok: false, error: `No company found for name "${name}"` },
          { status: 404 },
        )
      }
      return NextResponse.json({ ok: true, company })
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : 'Failed to fetch company info' },
        { status: 502 },
      )
    }
  }

  // TIN lookup
  if (!tin || !/^\d{9}$/.test(tin)) {
    return NextResponse.json(
      { ok: false, error: 'Provide ?tin=XXXXXXXXX (9 digits), ?name=Company Name, or ?search=query' },
      { status: 400 },
    )
  }

  try {
    const company = await getCompanyByTin(tin)
    if (!company) {
      return NextResponse.json(
        { ok: false, error: 'Company not found on orginfo.uz' },
        { status: 404 },
      )
    }
    return NextResponse.json({ ok: true, company })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed to fetch company info' },
      { status: 502 },
    )
  }
}

export const GET = guard(GET_impl)
