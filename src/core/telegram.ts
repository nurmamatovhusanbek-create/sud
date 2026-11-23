/**
 * The Telegram bot the operator brings (Settings › Telegram): its token and the channel it keeps copies in. Pure checks only; the token itself
 * never leaves the server (only `tokenHint` goes to the browser).
 */

export interface TelegramInput {
  /** from @BotFather: `123456789:AA…` */
  token: string
  /** the channel: `@username` of a public one, or the numeric id (`-100…`) of a private one */
  chat: string
  /** MIRROR channels (up to 3): the same encrypted backup is kept in each, so a banned channel or a deleted manifest message does not lose it; reading falls back to them in order */
  mirrors: string[]
}

export const MAX_MIRRORS = 3

export type TelegramInputError = 'no_token' | 'bad_token' | 'no_chat' | 'bad_chat' | 'too_many_mirrors'

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/
const CHAT_RE = /^(@[A-Za-z][A-Za-z0-9_]{4,31}|-?\d{5,20})$/

export function validateTelegramInput(raw: { token?: unknown; chat?: unknown; mirrors?: unknown }): { ok: true; value: TelegramInput } | { ok: false; error: TelegramInputError } {
  const token = typeof raw.token === 'string' ? raw.token.trim() : ''
  const chat = typeof raw.chat === 'string' ? raw.chat.trim() : ''
  if (!token) return { ok: false, error: 'no_token' }
  if (!TOKEN_RE.test(token)) return { ok: false, error: 'bad_token' }
  // the chat may be left out while the token is only being tested («Kanalni topish»): the caller decides
  if (!chat) return { ok: false, error: 'no_chat' }
  if (!CHAT_RE.test(chat)) return { ok: false, error: 'bad_chat' }
  // mirrors: a list of channels (or a comma / newline separated text); the primary and repeats are dropped
  const list = Array.isArray(raw.mirrors) ? raw.mirrors : typeof raw.mirrors === 'string' ? raw.mirrors.split(/[\s,;]+/) : []
  const mirrors: string[] = []
  for (const m of list) {
    const c = typeof m === 'string' ? m.trim() : ''
    if (!c) continue
    if (!CHAT_RE.test(c)) return { ok: false, error: 'bad_chat' }
    if (c !== chat && !mirrors.includes(c)) mirrors.push(c)
  }
  if (mirrors.length > MAX_MIRRORS) return { ok: false, error: 'too_many_mirrors' }
  return { ok: true, value: { token, chat, mirrors } }
}

/** the token's shape alone (for «find my channel», before a channel is chosen) */
export const isTelegramToken = (t: unknown): t is string => typeof t === 'string' && TOKEN_RE.test(t.trim())

/** «••••Jg» for display: never more than the last four characters of the secret part. */
export const tokenHint = (token: string): string => (token.length > 12 ? `${token.split(':')[0]}:••••${token.slice(-4)}` : '••••')

export const TELEGRAM_ERROR_TEXT: Record<string, string> = {
  bad_body: 'soʻrov notoʻgʻri',
  no_token: 'Bot tokeni kerak',
  bad_token: 'Token notoʻgʻri koʻrinishda (123456789:AA… shaklida boʻlishi kerak)',
  no_chat: 'Kanal kerak (@nom yoki -100… raqami)',
  bad_chat: 'Kanal notoʻgʻri koʻrinishda (@nom yoki -100… raqami)',
  too_many_mirrors: 'Zaxira kanallar koʻpi bilan 3 ta boʻlishi mumkin',
}

// ---- what Telegram's answers mean -------------------------------------------------------------------------------------

export type TelegramStep = 'bot' | 'chat' | 'admin' | 'send' | 'read' | 'delete'

export interface TelegramStepResult {
  step: TelegramStep
  ok: boolean
  /** short human line, never contains the token */
  note: string
}

export const STEP_LABEL: Record<TelegramStep, string> = {
  bot: 'Bot tokeni',
  chat: 'Kanal topildi',
  admin: 'Bot kanalda admin',
  send: 'Fayl yuborildi',
  read: 'Fayl qaytarib olindi',
  delete: 'Sinov xabari oʻchirildi',
}

/** Telegram's own error text → Uzbek, for the failures an operator can fix */
export function telegramFailure(code: number, description: string): string {
  const d = description.toLowerCase()
  if (code === 401) return 'Token qabul qilinmadi (401): @BotFather dagi tokenni tekshiring'
  if (code === 429) return 'Telegram juda tez soʻrovlarni rad etdi (429): birozdan soʻng qayta urining'
  if (d.includes('chat not found')) return 'Kanal topilmadi: nomi/raqami notoʻgʻri yoki bot kanalga qoʻshilmagan'
  if (d.includes('not enough rights') || d.includes('have no rights') || d.includes('administrator rights')) return 'Botda kanalga yozish huquqi yoʻq: uni adminga aylantiring ("Post messages")'
  if (d.includes('bot was kicked') || d.includes('bot is not a member')) return 'Bot kanaldan chiqarilgan yoki aʼzo emas'
  if (d.includes('file is too big')) return 'Fayl juda katta (bot 20 MB gacha oʻqiy oladi)'
  return `Telegram: ${description || `HTTP ${code}`}`
}
