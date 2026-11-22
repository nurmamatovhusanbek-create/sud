/**
 * The encrypted Telegram backup: the crypto on its own, then the incremental flow through a fake channel: first backup, an unchanged one that sends only
 * a manifest, a changed bucket that sends only itself, a piece deleted from the channel, a wrong passphrase, a tampered piece, opaque file names, and the
 * restore of an old full-file (v1) backup. The token and passphrase below are made up.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

mock.module('server-only', () => ({}))
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-'))
process.env.SUD_DB = path.join(DIR, 'sud.db')
process.env.TELEGRAM_CONFIG_FILE = path.join(DIR, 'telegram.json')
process.env.SUD_BACKUP_CHUNK = '4096'
process.env.SUD_BACKUP_GAP_MS = '0'
const crypt = await import('../backup-crypto')
const dbm = await import('../db')
const bk = await import('../db-buckets')
const cfg = await import('../telegram-config')
const backup = await import('../backup')

const TOKEN = '123456789:AAFakeFakeFakeFakeFakeFakeFakeFake_x1Yz'
const PASS = 'a fine long pass phrase'
const TIN = '207324986'
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
  test('the bucket id is the same for the same content and key, and different with another key or content', () => {
    const a = crypt.bucketId(key, Buffer.from('rows'))
    expect(crypt.bucketId(key, Buffer.from('rows'))).toBe(a)
    expect(crypt.bucketId(key, Buffer.from('rows!'))).not.toBe(a)
    expect(crypt.bucketId(crypt.deriveKey('other pass phrase', salt), Buffer.from('rows'))).not.toBe(a)
    expect(a).not.toBe(crypt.sha256(Buffer.from('rows'))) // not a plain hash: a guessed content cannot be confirmed without the key
  })
  test('manifest: right passphrase opens (and gives the salt back), wrong one is told apart from a foreign file', () => {
    const m = { v: 2 as const, id: 'abc', created: 'now', app: 'sud-tizimi', prev: null, companies: {}, buckets: [] }
    const blob = crypt.sealManifest(m, salt, key)
    const ok = crypt.openManifest(PASS, blob)
    expect(ok.ok && ok.manifest.id).toBe('abc')
    expect(ok.ok && ok.salt.equals(salt)).toBe(true)
    expect(crypt.openManifest('wrong wrong wrong', blob)).toEqual({ ok: false, error: 'wrong_passphrase' })
    expect(crypt.openManifest(PASS, Buffer.from('not a backup at all, just text........'))).toEqual({ ok: false, error: 'not_backup' })
  })
})

/** a fake channel: keeps every file sent, serves them back, remembers the pinned message, can lose a file */
function fakeChannel() {
  const files = new Map<string, Uint8Array>()
  const msgs = new Map<number, { fileId: string; name: string }>()
  const sent: string[] = []
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
      sent.push(blob.name)
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
    if (method === 'getFile') return files.has(b.file_id) ? json({ ok: true, result: { file_path: b.file_id } }) : json({ ok: false, error_code: 400, description: 'Bad Request: wrong file_id' })
    return json({ ok: false, error_code: 404, description: 'Not Found' })
  }) as typeof fetch
  return { files, msgs, sent, pin: (m: number) => (pinned = m), next: () => next }
}

async function finished() {
  for (let i = 0; i < 600; i++) {
    const s = backup.backupState()
    if (s.phase === 'done' || s.phase === 'error') return s
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('job did not finish')
}
const runBackup = async (pass = PASS) => {
  expect(backup.startBackup(pass).ok).toBe(true)
  return finished()
}
const ms = (iso: string) => Date.parse(iso)

beforeEach(() => {
  dbm.closeDb()
  for (const n of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, n), { force: true })
  cfg.saveTelegram({ token: TOKEN, chat: '@my_channel' })
  const db = dbm.getDb()
  const bill = db.prepare('INSERT INTO bills (tin, number, pass, status, issued, amount, case_number, ctype, kind, yymm, hay, cat, court) VALUES (?, ?, 0, ?, ?, 100, ?, ?, ?, ?, ?, ?, ?)')
  // random filler so every year bucket is several pieces at the 4 KiB piece size
  for (let i = 0; i < 300; i++) bill.run(TIN, `a${i}`, 'PAID', ms('2024-03-01') + i, null, 'civil', 'duty', -1, crypto.randomBytes(40).toString('hex'), 'x', 'c')
  for (let i = 0; i < 300; i++) bill.run(TIN, `b${i}`, 'PAID', ms('2025-03-01') + i, null, 'civil', 'duty', -1, crypto.randomBytes(40).toString('hex'), 'x', 'c')
  db.prepare('INSERT INTO found_cases (court, tin, num, yymm, status, hay, row, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('civil', TIN, '2-1004-2403/1', 2403, 's', 'h', '{"n":1}', 10)
  db.prepare('INSERT INTO case_details (court, num, t, d) VALUES (?, ?, ?, ?)').run('civil', '2-1004-2403/1', 10, crypto.randomBytes(100))
  db.prepare('INSERT INTO bill_loads (tin, total_elements, total_pages, page_size, pass, pages_done, complete, stable, loaded_at) VALUES (?, 600, 1, 10000, 0, 1, 1, 1, 777)').run(TIN)
  db.prepare('INSERT INTO companies (tin, first_at, refreshed_at, last_added) VALUES (?, 100, 777, 600)').run(TIN)
})

const allBuckets = (db: ReturnType<typeof dbm.getDb>) => Object.fromEntries(bk.listBuckets(db).map((n) => [n, bk.renderBucket(n, db)!.text.toString('utf8')]))

describe('incremental backup and restore through a fake channel', () => {
  test('the first backup sends every bucket; the restore gives back identical data and the company dates', async () => {
    const ch = fakeChannel()
    const done = await runBackup()
    expect(done.phase).toBe('done')
    expect(done.result!.reused).toBe(0)
    expect(done.result!.chunks).toBeGreaterThan(done.result!.buckets) // the year buckets are several pieces
    expect(backup.lastBackup()?.pinned).toBe(true)
    // nothing readable leaves the machine: names are opaque, no file holds a plain tin or SQLite text
    for (const name of ch.sent) expect(name).not.toContain(TIN)
    for (const f of ch.files.values()) expect(Buffer.from(f).includes(Buffer.from(TIN))).toBe(false)

    expect(backup.startRestore(PASS).ok).toBe(true)
    const r = await finished()
    expect(r.phase).toBe('done')
    expect(fs.existsSync(`${r.result!.restoredFile}-wal`)).toBe(false) // one file, ready to be swapped in
    const copy = dbm.openDbFile(r.result!.restoredFile!)
    expect(allBuckets(copy)).toEqual(allBuckets(dbm.getDb()))
    expect(copy.prepare('SELECT first_at, refreshed_at FROM companies').get()).toMatchObject({ first_at: 100, refreshed_at: 777 })
    copy.close()
  })

  test('an unchanged database sends only a new manifest, and the manifests are chained', async () => {
    const ch = fakeChannel()
    const first = await runBackup()
    const files1 = ch.files.size
    const second = await runBackup()
    expect(second.phase).toBe('done')
    expect(second.result!.reused).toBe(second.result!.buckets)
    expect(second.result!.chunks).toBe(0)
    expect(ch.files.size).toBe(files1 + 1) // the manifest only
    expect(second.result!.id).not.toBe(first.result!.id)
  })

  test('a change sends only its own bucket (and the manifest)', async () => {
    const ch = fakeChannel()
    await runBackup()
    const files1 = ch.files.size
    dbm.getDb().prepare("UPDATE bills SET status = 'USED' WHERE number = 'b5'").run() // one bill of the 2025 bucket
    const again = await runBackup()
    expect(again.result!.buckets - again.result!.reused).toBe(1)
    expect(ch.files.size).toBe(files1 + again.result!.chunks + 1)
    expect(again.result!.chunks).toBeGreaterThan(1)
    // and the restore of the newest backup has the change
    backup.startRestore(PASS)
    const r = await finished()
    const copy = dbm.openDbFile(r.result!.restoredFile!)
    expect(copy.prepare("SELECT status FROM bills WHERE number = 'b5'").get()?.status).toBe('USED')
    copy.close()
  })

  test('a piece that was deleted from the channel is sent again instead of being trusted', async () => {
    const ch = fakeChannel()
    await runBackup()
    const victim = [...ch.files.keys()][0]! // the first piece of the first bucket
    ch.files.delete(victim)
    const again = await runBackup()
    expect(again.phase).toBe('done')
    expect(again.result!.buckets - again.result!.reused).toBe(1)
    backup.startRestore(PASS)
    expect((await finished()).phase).toBe('done')
  })

  test('another passphrase cannot continue an existing chain, and cannot restore it', async () => {
    fakeChannel()
    await runBackup()
    const bad = await runBackup('some other pass phrase')
    expect(bad.phase).toBe('error')
    expect(bad.message).toContain('Parol')
    backup.startRestore('some other pass phrase')
    const r = await finished()
    expect(r.phase).toBe('error')
    expect(r.message).toContain('Parol')
  })

  test('a piece changed in the channel is caught and nothing is left behind', async () => {
    const ch = fakeChannel()
    await runBackup()
    const first = ch.files.get('F2')!
    const bad = new Uint8Array(first)
    bad[40] ^= 1
    ch.files.set('F2', bad)
    backup.startRestore(PASS)
    const r = await finished()
    expect(r.phase).toBe('error')
    expect(r.message).toContain('shikastlangan')
    expect(fs.readdirSync(DIR).some((n) => n.startsWith('sud.restored'))).toBe(false)
  })

  test('an old full-file (v1) backup still restores', async () => {
    const ch = fakeChannel()
    // build a v1 backup the way the first version did
    const snap = (await import('../db-admin')).snapshotFile()
    const dbBytes = fs.readFileSync(snap.file)
    snap.done()
    const gz = zlib.gzipSync(dbBytes)
    const salt = crypt.newSalt()
    const key = crypt.deriveKey(PASS, salt)
    const id = 'oldbackup00000001'
    const size = 4096
    const chunks: Array<{ i: number; fileId: string; messageId: number; size: number; sha256: string }> = []
    const total = Math.ceil(gz.length / size)
    const form = async (name: string, data: Buffer) => {
      const f = new FormData()
      f.append('chat_id', '@my_channel')
      f.append('document', new Blob([data as BlobPart]), name)
      const res = (await (await fetch('https://api.telegram.org/botX/sendDocument', { method: 'POST', body: f })).json()) as { result: { message_id: number; document: { file_id: string } } }
      return res.result
    }
    for (let i = 0; i < total; i++) {
      const sealed = crypt.seal(key, gz.subarray(i * size, (i + 1) * size), crypt.chunkAad(id, i))
      const r = await form(`p${i}.bin`, sealed)
      chunks.push({ i, fileId: r.document.file_id, messageId: r.message_id, size: sealed.length, sha256: crypt.sha256(sealed) })
    }
    const manifest = { v: 1 as const, id, created: new Date().toISOString(), app: 'sud-tizimi', dbBytes: dbBytes.length, dbSha256: crypt.sha256(dbBytes), gzBytes: gz.length, chunks }
    const mm = await form('manifest.bin', crypt.sealManifest(manifest, salt, key))
    ch.pin(mm.message_id)
    backup.startRestore(PASS)
    const r = await finished()
    expect(r.phase).toBe('done')
    const copy = dbm.openDbFile(r.result!.restoredFile!)
    expect(Number(copy.prepare('SELECT COUNT(*) c FROM bills').get()?.c)).toBe(600)
    copy.close()
  })

  test('short passphrase and a missing bot are refused up front', () => {
    expect(backup.startBackup('short').ok).toBe(false)
    cfg.removeTelegram()
    expect(backup.startBackup(PASS)).toEqual({ ok: false, error: expect.stringContaining('Telegram') })
  })
})
