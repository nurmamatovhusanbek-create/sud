import 'server-only'
import { telegramFailure, type TelegramStepResult } from '@/core/telegram'

/**
 * A thin Bot API client: fetch to the ONE fixed host `api.telegram.org`, nothing else (the operator cannot point it elsewhere, so the token
 * can only ever go to Telegram). The token is in the URL path by Telegram's design, therefore NO error, log line or result of this file may
 * contain the URL: failures are reduced to Telegram's own description or to a fixed text.
 */

const HOST = 'https://api.telegram.org'

export interface TgError {
  ok: false
  code: number
  description: string
}
export type TgReply<T> = { ok: true; result: T } | TgError

async function post<T>(token: string, method: string, body: unknown, timeoutMs = 20_000, tries = 3): Promise<TgReply<T>> {
  let last: TgError = { ok: false, code: 0, description: 'Telegramga ulanib boʻlmadi' }
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const isForm = body instanceof FormData
      const res = await fetch(`${HOST}/bot${token}/${method}`, {
        method: 'POST',
        headers: isForm ? undefined : { 'Content-Type': 'application/json' },
        body: isForm ? body : JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } } | null
      if (j?.ok) return { ok: true, result: j.result as T }
      last = { ok: false, code: j?.error_code ?? res.status, description: String(j?.description ?? '') }
      if (last.code === 429 && attempt < tries - 1) {
        // Telegram says how long to wait; never longer than a minute
        await new Promise((r) => setTimeout(r, Math.min(60, Math.max(1, j?.parameters?.retry_after ?? 5)) * 1000))
        continue
      }
      if (last.code >= 500 && attempt < tries - 1) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      return last
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      last = { ok: false, code: 0, description: timeout ? 'javob kelmadi (vaqt tugadi)' : 'Telegramga ulanib boʻlmadi' }
      if (attempt < tries - 1) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  return last
}

/** download a file Telegram holds (the token is part of the URL: never reported) */
async function downloadFile(token: string, filePath: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${HOST}/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(30_000), cache: 'no-store' })
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
  } catch {
    return null
  }
}

interface Chat {
  id: number
  type: string
  title?: string
  username?: string
}

export interface FoundChannel {
  id: string
  title: string
  username: string
}

/** Channels the bot has been added to or that posted since: from `getUpdates` (Telegram keeps them 24 h). */
export async function findChannels(token: string): Promise<{ ok: true; channels: FoundChannel[]; botUsername: string } | { ok: false; error: string }> {
  const me = await post<{ username?: string }>(token, 'getMe', {})
  if (!me.ok) return { ok: false, error: telegramFailure(me.code, me.description) }
  const up = await post<Array<Record<string, { chat?: Chat } | number>>>(token, 'getUpdates', { limit: 100, timeout: 0, allowed_updates: ['channel_post', 'my_chat_member'] })
  if (!up.ok) return { ok: false, error: telegramFailure(up.code, up.description) }
  const seen = new Map<string, FoundChannel>()
  for (const u of up.result) {
    for (const v of Object.values(u)) {
      const chat = typeof v === 'object' && v ? (v as { chat?: Chat }).chat : undefined
      if (chat && chat.type === 'channel') seen.set(String(chat.id), { id: String(chat.id), title: chat.title ?? '', username: chat.username ? `@${chat.username}` : '' })
    }
  }
  return { ok: true, channels: [...seen.values()], botUsername: me.result.username ?? '' }
}

export interface TestOutcome {
  ok: boolean
  steps: TelegramStepResult[]
  botUsername: string
  chatTitle: string
  /** the numeric id of the channel (so a public @name can be saved as the stable id) */
  chatId: string
}

/**
 * Proves the whole path a backup needs, in order: the token works, the channel exists, the bot is an admin who may post, a small file can be sent,
 * read back byte for byte, and deleted. Stops at the first failing step. The test message is deleted again.
 */
export async function testTelegram(token: string, chat: string): Promise<TestOutcome> {
  const steps: TelegramStepResult[] = []
  const out: TestOutcome = { ok: false, steps, botUsername: '', chatTitle: '', chatId: '' }
  const fail = (step: TelegramStepResult['step'], note: string) => {
    steps.push({ step, ok: false, note })
    return out
  }
  const pass = (step: TelegramStepResult['step'], note: string) => steps.push({ step, ok: true, note })

  const me = await post<{ id: number; username?: string }>(token, 'getMe', {})
  if (!me.ok) return fail('bot', telegramFailure(me.code, me.description))
  out.botUsername = me.result.username ?? ''
  pass('bot', `@${out.botUsername}`)

  const ch = await post<Chat>(token, 'getChat', { chat_id: chat })
  if (!ch.ok) return fail('chat', telegramFailure(ch.code, ch.description))
  if (ch.result.type !== 'channel') return fail('chat', `Bu kanal emas (${ch.result.type}): zaxira uchun kanal kerak`)
  out.chatTitle = ch.result.title ?? ''
  out.chatId = String(ch.result.id)
  pass('chat', out.chatTitle || out.chatId)

  const member = await post<{ status: string; can_post_messages?: boolean; can_delete_messages?: boolean }>(token, 'getChatMember', { chat_id: ch.result.id, user_id: me.result.id })
  if (!member.ok) return fail('admin', telegramFailure(member.code, member.description))
  if (member.result.status !== 'administrator' && member.result.status !== 'creator') return fail('admin', 'Bot kanalda admin emas: uni adminga aylantiring')
  if (member.result.status === 'administrator' && member.result.can_post_messages === false) return fail('admin', 'Botga "Post messages" huquqi berilmagan')
  pass('admin', member.result.can_delete_messages === false ? 'admin (eski xabarlarni oʻchira olmaydi)' : 'admin')

  const payload = new TextEncoder().encode(`sud-tizimi sinov ${new Date().toISOString()}\n`)
  const form = new FormData()
  form.append('chat_id', String(ch.result.id))
  form.append('disable_notification', 'true')
  form.append('caption', 'Sud tizimi: sinov (oʻzi oʻchiriladi)')
  form.append('document', new Blob([payload as BlobPart], { type: 'application/octet-stream' }), 'sud-sinov.txt')
  const sent = await post<{ message_id: number; document?: { file_id: string } }>(token, 'sendDocument', form, 60_000)
  if (!sent.ok) return fail('send', telegramFailure(sent.code, sent.description))
  pass('send', `${payload.length} bayt`)

  let readOk = false
  let readNote = 'Telegram fayl manzilini bermadi'
  const fileId = sent.result.document?.file_id
  if (fileId) {
    const f = await post<{ file_path?: string }>(token, 'getFile', { file_id: fileId })
    if (!f.ok) readNote = telegramFailure(f.code, f.description)
    else if (f.result.file_path) {
      const bytes = await downloadFile(token, f.result.file_path)
      if (!bytes) readNote = 'Faylni yuklab boʻlmadi'
      else if (bytes.length !== payload.length || bytes.some((b, i) => b !== payload[i])) readNote = 'Qaytgan fayl asl nusxadan farq qiladi'
      else {
        readOk = true
        readNote = 'bayt-baytiga mos'
      }
    }
  }
  steps.push({ step: 'read', ok: readOk, note: readNote })

  const del = await post<boolean>(token, 'deleteMessage', { chat_id: ch.result.id, message_id: sent.result.message_id })
  steps.push({ step: 'delete', ok: del.ok, note: del.ok ? 'tayyor' : telegramFailure(del.code, del.description) })

  out.ok = steps.every((s) => s.ok)
  return out
}


// ---- what the backup needs: send a file, get it back, pin it, find the pinned one ---------------------------------------------

export type TgResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Send one file to the channel. Returns the message id and the file id. */
export async function sendFile(token: string, chat: string, bytes: Uint8Array, filename: string, caption: string): Promise<TgResult<{ messageId: number; fileId: string }>> {
  const form = new FormData()
  form.append('chat_id', chat)
  form.append('disable_notification', 'true')
  form.append('caption', caption)
  form.append('document', new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), filename)
  const r = await post<{ message_id: number; document?: { file_id: string } }>(token, 'sendDocument', form, 180_000)
  if (!r.ok) return { ok: false, error: telegramFailure(r.code, r.description) }
  if (!r.result.document?.file_id) return { ok: false, error: 'Telegram fayl identifikatorini bermadi' }
  return { ok: true, value: { messageId: r.result.message_id, fileId: r.result.document.file_id } }
}

/** Bytes of a file the bot can read (Telegram lets a bot read up to 20 MB). */
export async function getFileBytes(token: string, fileId: string): Promise<TgResult<Uint8Array>> {
  const f = await post<{ file_path?: string }>(token, 'getFile', { file_id: fileId })
  if (!f.ok) return { ok: false, error: telegramFailure(f.code, f.description) }
  if (!f.result.file_path) return { ok: false, error: 'Telegram fayl manzilini bermadi' }
  for (let attempt = 0; attempt < 3; attempt++) {
    const bytes = await downloadFile(token, f.result.file_path)
    if (bytes) return { ok: true, value: bytes }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
  }
  return { ok: false, error: 'Faylni yuklab boʻlmadi' }
}

export async function pinMessage(token: string, chat: string, messageId: number): Promise<TgResult<true>> {
  const r = await post<boolean>(token, 'pinChatMessage', { chat_id: chat, message_id: messageId, disable_notification: true })
  return r.ok ? { ok: true, value: true } : { ok: false, error: telegramFailure(r.code, r.description) }
}

export async function deleteMessage(token: string, chat: string, messageId: number): Promise<boolean> {
  return (await post<boolean>(token, 'deleteMessage', { chat_id: chat, message_id: messageId })).ok
}

/** The document pinned in the channel (where the newest backup's manifest is kept). */
export async function pinnedDocument(token: string, chat: string): Promise<TgResult<{ fileId: string; name: string; messageId: number } | null>> {
  const r = await post<{ pinned_message?: { message_id: number; document?: { file_id: string; file_name?: string } } }>(token, 'getChat', { chat_id: chat })
  if (!r.ok) return { ok: false, error: telegramFailure(r.code, r.description) }
  const d = r.result.pinned_message?.document
  return { ok: true, value: d ? { fileId: d.file_id, name: d.file_name ?? '', messageId: r.result.pinned_message!.message_id } : null }
}

/** does Telegram still hold this file (a reused backup piece may have been deleted from the channel)? */
export async function fileExists(token: string, fileId: string): Promise<boolean> {
  return (await post<{ file_path?: string }>(token, 'getFile', { file_id: fileId })).ok
}

/** Send one plain text message to a chat or a person (the Kuzatuv's messages). No markup, so a name with any character is safe. */
/** a message as Telegram HTML: the caller has escaped every piece of data (`core/watch.escapeHtml`); `markup` = inline buttons (`reply_markup`) */
export async function sendMessage(token: string, chat: string | number, text: string, markup?: object): Promise<TgResult<number>> {
  const r = await post<{ message_id: number }>(token, 'sendMessage', { chat_id: chat, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) }, 20_000, 3)
  return r.ok ? { ok: true, value: r.result.message_id } : { ok: false, error: telegramFailure(r.code, r.description) }
}
