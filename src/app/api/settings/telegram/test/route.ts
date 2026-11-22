import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { TELEGRAM_ERROR_TEXT } from '@/core/telegram'
import { readTelegramBody } from '@/lib/telegram-request'
import { testTelegram } from '@/lib/telegram-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * POST /api/settings/telegram/test   Body: { token?, chat }
 * Sends one tiny file to the channel, reads it back, compares it and deletes it. Nothing is saved. The token goes only to api.telegram.org.
 */
export const POST = guard(
  async (req) => {
    const v = await readTelegramBody(req, { needChat: true })
    if (!v.ok) return jsonFail(TELEGRAM_ERROR_TEXT[v.error] ?? 'xato', v.error, 400)
    return jsonOk(await testTelegram(v.value.token, v.value.chat))
  },
  { privileged: true }, // it posts to a channel with the token
)
