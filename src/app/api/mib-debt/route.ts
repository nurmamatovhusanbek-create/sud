import { NextRequest } from 'next/server'
import { prepareMibCheck, submitMibCheck } from '@/lib/mib'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * GET /api/mib-debt?tin=XXXXXXXXX
 *   Phase 1: fetch mib.uz page + captcha. Returns { sessionId, captchaImage }.
 *   The user reads the captcha (Uzbek math words) and types the answer.
 *
 * POST /api/mib-debt  body: { tin, sessionId, captchaAnswer }
 *   Phase 2: submit the form with the user's answer. Returns the debt result.
 */
async function GET_impl(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tin = searchParams.get('tin')?.trim()

  if (!tin || !/^\d{9}$/.test(tin)) {
    return Response.json(
      { ok: false, error: 'TIN must be exactly 9 digits' },
      { status: 400 },
    )
  }

  const result = await prepareMibCheck(tin)
  return Response.json(result)
}

async function POST_impl(req: NextRequest) {
  try {
    const body = await req.json()
    const { tin, sessionId, captchaAnswer } = body as {
      tin?: string; sessionId?: string; captchaAnswer?: string
    }

    if (!tin || !sessionId || !captchaAnswer) {
      return Response.json(
        { ok: false, error: 'Missing tin, sessionId, or captchaAnswer' },
        { status: 400 },
      )
    }

    const result = await submitMibCheck(tin, sessionId, captchaAnswer)
    return Response.json({ ok: true, ...result })
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    )
  }
}

export const GET = guard(GET_impl)
export const POST = guard(POST_impl)
