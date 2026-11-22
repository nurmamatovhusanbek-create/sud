/**
 * The encrypted Telegram backup: the crypto on its own, then a whole backup → restore through a fake Bot API with several pieces, a wrong
 * passphrase, and a piece that was changed in the channel. The token and passphrase below are made up.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

mock.module('server-only', () => ({}))
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-'))
process.env.SUD_DB = path.join(DIR, 'sud.db')
process.env.TELEGRAM_CONFIG_FILE = path.join(DIR, 'telegram.json')
process.env.SUD_BACKUP_CHUNK = '4096'
const crypt = await import('../backup-crypto')
const dbm = await import('../db')
const cfg = await import('../telegram-config')
const backup = await import('../backup')

const TOKEN = '123456789:AAFakeFakeFakeFakeFakeFakeFakeFake_x1Yz'
const PASS = 'a fine long pass phrase'
const realFetch = globalThis.fetch

afterAll(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('crypto', () => {
  const salt = crypt.newSalt()
  const key = crypt.deriveKey(PASS, salt)
  test('a sealed piece opens only with the key and its own place', () => {
    const sealed = crypt.seal(key, Buffer.from('hello'), 'id:0')
    expect(crypt.open(key, sealed, 'id:0').toString()).toBe('hello')
    expect(() => crypt.open(key, sealed, 'id:1')).toThrow() // moved to another place
    expect(() => crypt.open(crypt.deriveKey('other pass phrase', salt), sealed, 'id:0')).toThrow()
    const bad = Buffer.from(sealed)
    bad[bad.length - 1] ^= 1
    expect(() => crypt.open(key, bad, 'id:0')).toThrow() // one changed byte
  })
  test('the same text seals differently every time (fresh IV)', () => {
    expect(crypt.seal(key, Buffer.from('x'), 'a').equals(crypt.seal(key, Buffer.from('x'), 'a'))).toBe(false)
  })
  test('manifest: right passphrase opens, wrong one is told apart from a foreign file', () => {
    const m = { v: 1 as const, id: 'abc', created: 'now', app: 'sud-tizimi', dbBytes: 1, dbSha256: 'x', gzBytes: 1, chunks: [] }
    const blob = crypt.sealManifest(m, salt, key)
    const ok = crypt.openManifest(PASS, blob)
    expect(ok.ok && ok.manifest.id).toBe('abc')
    expect(crypt.openManifest('wrong wrong wrong', blob)).toEqual({ ok: false, error: 'wrong_passphrase' })
    expect(crypt.openManifest(PASS, Buffer.from('not a backup at all, just text........'))).toEqual({ ok: false, error: 'not_backup' })
  })
})

/** a fake channel: keeps every file sent, serves them back, remembers the pinned message */
function fakeChannel() {
  const files = new Map<string, Uint8Array>()
  const msgs = new Map<number, { fileId: string; name: string }>()
  let pinned = 0
  let next = 1
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const json = (v: unknown) => new Response(JSON.stringify(v))
    if (u.includes('/file/bot')) {
      const f = files.get(u.split('/file/bot')[1]!.split('/').slice(1).join('/'))
      return f ? new Response(f as BodyInit) : new Response('', { status: 404 })
    }
    const method = u.split('/').pop()!
    const body = init!.body
    if (method === 'sendDocument') {
      const form = body as FormData
      const blob = form.get('document') as File
      const id = `F${next}`
      files.set(id, new Uint8Array(await blob.arrayBuffer()))
      msgs.set(next, { fileId: id, name: blob.name })
      return json({ ok: true, result: { message_id: next++, document: { file_id: id } } })
    }
    const b = JSON.parse(String(body))
    if (method === 'pinChatMessage') {
      pinned = b.message_id
      return json({ ok: true, result: true })
    }
    if (method === 'getChat') {
      const m = msgs.get(pinned)
      return json({ ok: true, result: { id: -1001, type: 'channel', pinned_message: m ? { message_id: pinned, document: { file_id: m.fileId, file_name: m.name } } : undefined } })
    }
    if (method === 'getFile') return json({ ok: true, result: { file_path: b.file_id } })
    return json({ ok: false, error_code: 404, description: 'Not Found' })
  }) as typeof fetch
  return { files, msgs }
}

async function finished() {
  for (let i = 0; i < 400; i++) {
    const s = backup.backupState()
    if (s.phase === 'done' || s.phase === 'error') return s
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('job did not finish')
}

beforeEach(() => {
  dbm.closeDb()
  for (const n of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, n), { force: true })
  cfg.saveTelegram({ token: TOKEN, chat: '@my_channel' })
  // enough random data that the gzip is several 4 KiB pieces
  const db = dbm.getDb()
  const ins = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)')
  for (let i = 0; i < 400; i++) ins.run(`k${i}`, crypto.randomBytes(32).toString('hex'))
})

describe('backup and restore through a fake channel', () => {
  test('several pieces go up, the manifest is pinned, and restore gives back an identical database', async () => {
    const ch = fakeChannel()
    expect(backup.startBackup(PASS).ok).toBe(true)
    const done = await finished()
    expect(done.phase).toBe('done')
    expect(done.result!.chunks).toBeGreaterThan(2)
    expect(ch.files.size).toBe(done.result!.chunks + 1) // pieces + manifest
    // what is stored is random-looking: no plain text of the database in any file
    for (const f of ch.files.values()) expect(Buffer.from(f).includes(Buffer.from('SQLite format'))).toBe(false)
    expect(backup.lastBackup()?.pinned).toBe(true)

    expect(backup.startRestore(PASS).ok).toBe(true)
    const r = await finished()
    expect(r.phase).toBe('done')
    const { Database } = createRequire(import.meta.url)('bun:sqlite')
    const copy = new Database(r.result!.restoredFile!, { readonly: true })
    expect((copy.query('SELECT COUNT(*) c FROM meta').get() as { c: number }).c).toBeGreaterThan(400)
    copy.close()
  })

  test('a wrong passphrase is refused before anything is downloaded', async () => {
    fakeChannel()
    backup.startBackup(PASS)
    await finished()
    backup.startRestore('some other pass phrase')
    const r = await finished()
    expect(r.phase).toBe('error')
    expect(r.message).toContain('Parol')
  })

  test('a piece changed in the channel is caught', async () => {
    const ch = fakeChannel()
    backup.startBackup(PASS)
    await finished()
    const first = ch.files.get('F1')!
    const bad = new Uint8Array(first)
    bad[40] ^= 1
    ch.files.set('F1', bad)
    backup.startRestore(PASS)
    const r = await finished()
    expect(r.phase).toBe('error')
    expect(r.message).toContain('shikastlangan')
    expect(fs.readdirSync(DIR).some((n) => n.startsWith('sud.restored'))).toBe(false)
  })

  test('short passphrase and a missing bot are refused up front', () => {
    expect(backup.startBackup('short').ok).toBe(false)
    cfg.removeTelegram()
    expect(backup.startBackup(PASS)).toEqual({ ok: false, error: expect.stringContaining('Telegram') })
  })
})
