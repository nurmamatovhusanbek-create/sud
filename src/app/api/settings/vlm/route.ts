import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { clearSavedVlm, saveVlm, vlmStatus } from '@/lib/vlm-config'
import { readVlmBody, VLM_ERROR_TEXT } from '@/lib/vlm-request'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * /api/settings/vlm — the captcha reader (VLM) key of THIS operator.
 *   GET    → status: configured?, provider, base URL, model, last four characters of the key (never the key)
 *   POST   → save { provider, baseUrl, model, apiKey } (empty apiKey keeps the saved one)   [privileged]
 *   DELETE → forget the saved setting                                                         [privileged]
 */
export const GET = guard(async () => jsonOk(vlmStatus()), { rateLimit: false })

export const POST = guard(
  async (req) => {
    const v = await readVlmBody(req)
    if (!v.ok) return jsonFail(VLM_ERROR_TEXT[v.error] ?? 'xato', v.error, 400)
    saveVlm(v.value)
    return jsonOk(vlmStatus())
  },
  { privileged: true },
)

export const DELETE = guard(
  async () => {
    clearSavedVlm()
    return jsonOk(vlmStatus())
  },
  { privileged: true },
)
