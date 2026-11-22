import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { TELEGRAM_ERROR_TEXT } from '@/core/telegram'
import { readTelegramBody } from '@/lib/telegram-request'
import { findChannels } from '@/lib/telegram-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/settings/telegram/find   Body: { token? }
 * Lists the channels the bot was added to or that posted in the last 24 h (Telegram's `getUpdates`), so the operator need not know the numeric id.
 * Post any message in the channel first. Reads only; nothing is saved.
 */
export const POST = guard(
  async (req) => {
    const v = await readTelegramBody(req, { needChat: false })
    if (!v.ok) return jsonFail(TELEGRAM_ERROR_TEXT[v.error] ?? 'xato', v.error, 400)
    const r = await findChannels(v.value.token)
    return r.ok ? jsonOk(r) : jsonFail(r.error, 'telegram', 502)
  },
  { privileged: true },
)
