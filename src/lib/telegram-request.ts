import 'server-only'
import { isTelegramToken, validateTelegramInput, type TelegramInput, type TelegramInputError } from '@/core/telegram'
import { readTelegram } from './telegram-config'

/** The form's body → a setting the server may use. An empty token field means «keep the saved token» (so the channel can change without retyping it). */
export async function readTelegramBody(req: Request, opts: { needChat: boolean }): Promise<{ ok: true; value: TelegramInput } | { ok: false; error: TelegramInputError | 'bad_body' }> {
  let raw: { token?: unknown; chat?: unknown }
  try {
    raw = (await req.json()) as { token?: unknown; chat?: unknown }
  } catch {
    return { ok: false, error: 'bad_body' }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'bad_body' }
  const given = typeof raw.token === 'string' ? raw.token.trim() : ''
  const token = given || readTelegram()?.token || ''
  if (!opts.needChat) {
    if (!token) return { ok: false, error: 'no_token' }
    if (!isTelegramToken(token)) return { ok: false, error: 'bad_token' }
    return { ok: true, value: { token, chat: '' } }
  }
  return validateTelegramInput({ token, chat: raw.chat })
}
