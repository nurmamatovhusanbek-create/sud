/**
 * Settings › Telegram: input checks, the saved file (0600, token never in the status), and the whole test path against a fake Bot API
 * (token ok → channel → admin → send → read back byte for byte → delete), including the failures an operator can fix.
 * The token below is a made-up one; a real token never belongs in a test or in git.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isTelegramToken, tokenHint, validateTelegramInput } from '../../core/telegram'

mock.module('server-only', () => ({}))
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-'))
process.env.TELEGRAM_CONFIG_FILE = path.join(DIR, 'telegram.json')
const cfg = await import('../telegram-config')
const client = await import('../telegram-client')

const SECRET = 'AAFakeFakeFakeFakeFakeFakeFakeFake_x1Yz'
const TOKEN = `123456789:${SECRET}`
const realFetch = globalThis.fetch

afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }))
beforeEach(() => fs.rmSync(process.env.TELEGRAM_CONFIG_FILE!, { force: true }))
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('input', () => {
  test('token and chat shapes', () => {
    expect(validateTelegramInput({ token: TOKEN, chat: '@my_channel' }).ok).toBe(true)
    expect(validateTelegramInput({ token: TOKEN, chat: '-1001234567890' }).ok).toBe(true)
    expect(validateTelegramInput({ token: '', chat: '@my_channel' })).toEqual({ ok: false, error: 'no_token' })
    expect(validateTelegramInput({ token: 'abc', chat: '@my_channel' })).toEqual({ ok: false, error: 'bad_token' })
    expect(validateTelegramInput({ token: TOKEN, chat: '' })).toEqual({ ok: false, error: 'no_chat' })
    expect(validateTelegramInput({ token: TOKEN, chat: 'my channel' })).toEqual({ ok: false, error: 'bad_chat' })
    expect(isTelegramToken(TOKEN)).toBe(true)
  })
  test('the hint shows the bot id and four characters, not the secret', () => {
    const h = tokenHint(TOKEN)
    expect(h).toBe('123456789:••••x1Yz')
    expect(h).not.toContain('AAFake')
  })
})

describe('mirror channels', () => {
  test('a list or a comma separated text; the primary and repeats are dropped; at most three; a bad one is refused', () => {
    const v = (mirrors: unknown) => validateTelegramInput({ token: TOKEN, chat: '@my_channel', mirrors })
    expect(v(undefined)).toEqual({ ok: true, value: { token: TOKEN, chat: '@my_channel', mirrors: [] } })
    expect(v(['@a_mirror', '-1001234567890', '@my_channel', '@a_mirror'])).toMatchObject({ ok: true, value: { mirrors: ['@a_mirror', '-1001234567890'] } })
    expect(v('@a_mirror, -1001234567890\n@third_one')).toMatchObject({ ok: true, value: { mirrors: ['@a_mirror', '-1001234567890', '@third_one'] } })
    expect(v(['@a_mirror', '@b_mirror', '@c_mirror', '@d_mirror'])).toEqual({ ok: false, error: 'too_many_mirrors' })
    expect(v(['not a channel'])).toEqual({ ok: false, error: 'bad_chat' })
  })
})

describe('saved file', () => {
  test('saved with 0600; status never carries the token; forget removes it', () => {
    expect(cfg.telegramStatus().configured).toBe(false)
    cfg.saveTelegram({ token: TOKEN, chat: '@my_channel', mirrors: ['@backup_channel'] })
    if (process.platform !== 'win32') expect(fs.statSync(cfg.telegramFile()).mode & 0o777).toBe(0o600)
    const s = cfg.telegramStatus()
    expect(s).toEqual({ configured: true, chat: '@my_channel', mirrors: ['@backup_channel'], tokenHint: '123456789:••••x1Yz' })
    expect(JSON.stringify(s)).not.toContain('AAFake')
    expect(cfg.readTelegram()?.token).toBe(TOKEN)
    cfg.removeTelegram()
    expect(cfg.telegramStatus().configured).toBe(false)
  })
})

/** a fake Bot API; the options steer the answers, `stored` keeps what was uploaded */
function fakeApi(o: { memberStatus?: string; chatType?: string; failSend?: string; corrupt?: boolean } = {}) {
  const calls: string[] = []
  let stored: Uint8Array | null = null
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
    if (u.includes('/file/bot')) return new Response(o.corrupt ? new Uint8Array([9, 9]) : (stored as BodyInit), { status: 200 })
    const method = u.split('/').pop()!
    calls.push(method)
    if (method === 'getMe') return json({ ok: true, result: { id: 123456789, username: 'tbot' } })
    if (method === 'getChat') return json({ ok: true, result: { id: -1001, type: o.chatType ?? 'channel', title: 'Zaxira' } })
    if (method === 'getChatMember') return json({ ok: true, result: { status: o.memberStatus ?? 'administrator', can_post_messages: true } })
    if (method === 'sendDocument') {
      if (o.failSend) return json({ ok: false, error_code: 400, description: o.failSend }, 400)
      const f = (init!.body as FormData).get('document') as Blob
      stored = new Uint8Array(await f.arrayBuffer())
      return json({ ok: true, result: { message_id: 7, document: { file_id: 'F1' } } })
    }
    if (method === 'getFile') return json({ ok: true, result: { file_path: 'documents/file_1' } })
    if (method === 'deleteMessage') return json({ ok: true, result: true })
    return json({ ok: false, error_code: 404, description: 'Not Found' }, 404)
  }) as typeof fetch
  return calls
}

describe('test path', () => {
  test('every step passes and the file is read back and deleted', async () => {
    const calls = fakeApi()
    const r = await client.testTelegram(TOKEN, '@my_channel')
    expect(r.ok).toBe(true)
    expect(r.steps.map((s) => s.step)).toEqual(['bot', 'chat', 'admin', 'send', 'read', 'delete'])
    expect(r.chatId).toBe('-1001')
    expect(calls).toEqual(['getMe', 'getChat', 'getChatMember', 'sendDocument', 'getFile', 'deleteMessage'])
  })
  test('stops at a chat that is not a channel', async () => {
    fakeApi({ chatType: 'supergroup' })
    const r = await client.testTelegram(TOKEN, '@g_group')
    expect(r.ok).toBe(false)
    expect(r.steps.at(-1)).toMatchObject({ step: 'chat', ok: false })
  })
  test('a bot that is only a member is told to become admin', async () => {
    fakeApi({ memberStatus: 'member' })
    const r = await client.testTelegram(TOKEN, '@my_channel')
    expect(r.steps.at(-1)).toMatchObject({ step: 'admin', ok: false })
  })
  test('a file that comes back different is a failure, and the message is still deleted', async () => {
    const calls = fakeApi({ corrupt: true })
    const r = await client.testTelegram(TOKEN, '@my_channel')
    expect(r.ok).toBe(false)
    expect(r.steps.find((s) => s.step === 'read')?.ok).toBe(false)
    expect(calls.at(-1)).toBe('deleteMessage')
  })
  test('a rights error is explained in Uzbek', async () => {
    fakeApi({ failSend: 'Bad Request: not enough rights to send documents to the chat' })
    const r = await client.testTelegram(TOKEN, '@my_channel')
    expect(r.steps.at(-1)?.note).toContain('huquqi')
  })
  test('the token never appears in any result, even when the network fails', async () => {
    globalThis.fetch = (async () => {
      throw new Error(`connect failed for https://api.telegram.org/bot${TOKEN}/getMe`)
    }) as unknown as typeof fetch
    const r = await client.testTelegram(TOKEN, '@my_channel')
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain('AAFake')
  })
})

describe('find channels', () => {
  test('collects channels from updates', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const m = String(url).split('/').pop()
      const body =
        m === 'getMe'
          ? { ok: true, result: { id: 1, username: 'tbot' } }
          : { ok: true, result: [{ update_id: 1, channel_post: { chat: { id: -1005, type: 'channel', title: 'A', username: 'a_chan' } } }, { update_id: 2, my_chat_member: { chat: { id: 55, type: 'private' } } }] }
      return new Response(JSON.stringify(body))
    }) as typeof fetch
    const r = await client.findChannels(TOKEN)
    expect(r).toEqual({ ok: true, botUsername: 'tbot', channels: [{ id: '-1005', title: 'A', username: '@a_chan' }] })
  })
})
