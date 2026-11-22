import 'server-only'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { tokenHint, validateTelegramInput, type TelegramInput } from '@/core/telegram'

/**
 * The Telegram bot of THIS operator: `~/.sud-tizimi/telegram.json` (0600, folder 0700; `TELEGRAM_CONFIG_FILE` overrides), like the captcha
 * keys. Outside the project, never in git. The token is never sent back to the browser (only its id and last four characters).
 */

export const telegramFile = (): string => process.env.TELEGRAM_CONFIG_FILE || path.join(os.homedir(), '.sud-tizimi', 'telegram.json')

export function readTelegram(): TelegramInput | null {
  try {
    const raw = JSON.parse(fs.readFileSync(telegramFile(), 'utf8')) as { token?: unknown; chat?: unknown }
    const v = validateTelegramInput(raw)
    return v.ok ? v.value : null
  } catch {
    return null
  }
}

export function saveTelegram(v: TelegramInput): void {
  const file = telegramFile()
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ token: v.token, chat: v.chat, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file) // never a half-written token
}

export function removeTelegram(): void {
  try {
    fs.rmSync(telegramFile(), { force: true })
  } catch {
    /* nothing to remove */
  }
}

export interface TelegramStatus {
  configured: boolean
  chat: string
  tokenHint: string
}

export function telegramStatus(): TelegramStatus {
  const t = readTelegram()
  return t ? { configured: true, chat: t.chat, tokenHint: tokenHint(t.token) } : { configured: false, chat: '', tokenHint: '' }
}
