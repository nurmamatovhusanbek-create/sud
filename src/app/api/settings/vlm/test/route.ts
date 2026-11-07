import { NextResponse } from 'next/server'
import { guard } from '@/server/middleware'
import { jsonFail } from '@/server/envelope'
import { testVision } from '@/lib/vlm-test'
import { readVlmBody, VLM_ERROR_TEXT } from '@/lib/vlm-request'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/settings/vlm/test   Body: { provider, baseUrl, model, apiKey? }
 * Sends two small arithmetic pictures to the given provider and checks the answers: proves the key is accepted AND the
 * model can read images. Nothing is saved. The key is sent only to the given (public, https) address.
 */
export const POST = guard(
  async (req) => {
    const v = await readVlmBody(req)
    if (!v.ok) return jsonFail(VLM_ERROR_TEXT[v.error] ?? 'xato', v.error, 400)
    const result = await testVision(v.value)
    return NextResponse.json({ ok: true, data: result })
  },
  { privileged: true }, // it spends the key's quota and sends it to a given address
)
