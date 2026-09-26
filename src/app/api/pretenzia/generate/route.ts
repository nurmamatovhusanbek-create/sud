import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/server/middleware'
import { generatePretenzia } from '@/lib/pretenzia/fill.server'
import type { ClaimConstants, ClaimContractInput } from '@/lib/pretenzia/render'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/pretenzia/generate
 * body: {
 *   claimDate: ISO,
 *   constants: { creditorName, debtorName, debtorAddress, courtName,
 *                director, executor, executorPhone },
 *   contracts: [{ no, date: ISO, mainDebtTiyin, paymentTiyin, delayStart: ISO }],
 *   terms?: { ratePerDay, capFraction }
 * }
 * → one .docx (single contract) or a .zip bundle (several).
 *
 * The xlsx is parsed on the client; only the derived figures reach here.
 */
const MAX_CONTRACTS = 100

function asDate(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

async function POST_impl(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Notoʻgʻri soʻrov' }, { status: 400 })
  }

  const claimDate = asDate(body.claimDate)
  if (!claimDate) return NextResponse.json({ ok: false, error: 'Sana notoʻgʻri' }, { status: 400 })

  const lang = body.lang === 'uz' ? 'uz' : 'ru'
  const c = (body.constants ?? {}) as Record<string, unknown>
  const constants: ClaimConstants = {
    creditorName: asString(c.creditorName),
    debtorName: asString(c.debtorName),
    debtorAddress: asString(c.debtorAddress),
    courtName: asString(c.courtName),
    director: asString(c.director),
    executor: asString(c.executor),
    executorPhone: asString(c.executorPhone),
    claimDate,
    lang,
  }

  const terms = body.terms as Record<string, unknown> | undefined
  if (terms && typeof terms.ratePerDay === 'number' && typeof terms.capFraction === 'number') {
    constants.terms = { ratePerDay: terms.ratePerDay, capFraction: terms.capFraction }
  }

  const rawContracts = Array.isArray(body.contracts) ? body.contracts : []
  if (rawContracts.length === 0) {
    return NextResponse.json({ ok: false, error: 'Shartnoma tanlanmadi' }, { status: 400 })
  }
  if (rawContracts.length > MAX_CONTRACTS) {
    return NextResponse.json({ ok: false, error: 'Shartnomalar juda koʻp' }, { status: 400 })
  }

  const contracts: ClaimContractInput[] = []
  for (const item of rawContracts) {
    const o = item as Record<string, unknown>
    const date = asDate(o.date)
    const delayStart = asDate(o.delayStart)
    const no = asString(o.no)
    const mainDebtTiyin = Number(o.mainDebtTiyin)
    const paymentTiyin = Number(o.paymentTiyin)
    if (!no || !date || !delayStart || !Number.isFinite(mainDebtTiyin) || !Number.isFinite(paymentTiyin)) {
      return NextResponse.json({ ok: false, error: `Shartnoma maʼlumoti notoʻgʻri (${no || '?'})` }, { status: 400 })
    }
    contracts.push({ no, date, delayStart, mainDebtTiyin, paymentTiyin: Math.max(0, paymentTiyin) })
  }

  let out
  try {
    out = await generatePretenzia(contracts, constants)
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Hujjatni yaratib boʻlmadi' },
      { status: 400 },
    )
  }

  const contentType = out.zipped
    ? 'application/zip'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

  return new NextResponse(new Uint8Array(out.buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'Content-Length': String(out.buffer.length),
      'Cache-Control': 'no-store',
    },
  })
}

export const POST = guard(POST_impl)
