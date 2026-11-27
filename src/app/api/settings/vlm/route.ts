import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { removeVlm, upsertVlm, vlmStatus } from '@/lib/vlm-config'
import { readVlmBody, VLM_ERROR_TEXT } from '@/lib/vlm-request'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * /api/settings/vlm — the captcha reader (VLM) key of THIS operator.
 *   GET    → status: the saved providers (id, kind, base URL, model, last four characters of the key; never the key)
 *   POST   → add one { provider, baseUrl, model, apiKey } (a new key of a saved provider is added next to it; `id` = the entry being edited, an empty apiKey keeps its key)  [privileged]
 *   DELETE → forget one (?id=) or all of them                                                             [privileged]
 * The solver takes the saved providers in turn and fails over to the next (lib/vlm-pool.ts).
 */
export const GET = guard(async () => jsonOk(vlmStatus()), { rateLimit: false })

export const POST = guard(
  async (req) => {
    const v = await readVlmBody(req)
    if (!v.ok) return jsonFail(VLM_ERROR_TEXT[v.error] ?? 'xato', v.error, 400)
    upsertVlm(v.value, v.editId)
    return jsonOk(vlmStatus())
  },
  { privileged: true },
)

export const DELETE = guard(
  async (req) => {
    removeVlm(new URL(req.url).searchParams.get('id') ?? undefined)
    return jsonOk(vlmStatus())
  },
  { privileged: true },
)
