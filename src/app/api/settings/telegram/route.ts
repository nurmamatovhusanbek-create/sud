import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { TELEGRAM_ERROR_TEXT } from '@/core/telegram'
import { removeTelegram, saveTelegram, telegramStatus } from '@/lib/telegram-config'
import { readTelegramBody } from '@/lib/telegram-request'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * /api/settings/telegram: the Telegram bot of THIS operator (token + channel for the encrypted copies).
 *   GET    → status: configured, the channel, the token's id and last four characters (never the token)
 *   POST   → save { token?, chat } (an empty token keeps the saved one)   [privileged]
 *   DELETE → forget the bot                                                [privileged]
 */
export const GET = guard(async () => jsonOk(telegramStatus()), { rateLimit: false })

export const POST = guard(
  async (req) => {
    const v = await readTelegramBody(req, { needChat: true })
    if (!v.ok) return jsonFail(TELEGRAM_ERROR_TEXT[v.error] ?? 'xato', v.error, 400)
    saveTelegram(v.value)
    return jsonOk(telegramStatus())
  },
  { privileged: true },
)

export const DELETE = guard(
  async () => {
    removeTelegram()
    return jsonOk(telegramStatus())
  },
  { privileged: true },
)
