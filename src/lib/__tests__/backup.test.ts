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
process.env.SNAPSHOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-snap-'))
process.env.CASE_STORE_DIR = path.join(DIR, 'cases')
process.env.TELEGRAM_CONFIG_FILE = path.join(DIR, 'telegram.json')
process.env.SUD_BACKUP_CHUNK = '4096'
process.env.SUD_BACKUP_GAP_MS = '0'
const crypt = await import('../backup-crypto')
const dbm = await import('../db')
const bk = await import('../db-buckets')
const cfg = await import('../telegram-config')
const backup = await import('../backup')
const catalogLib = await import('../telegram-catalog')
const admin = await import('../db-admin')
const billsLib = await import('../bills-store')
const index = await import('../telegram-index')

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
  const fileCalls: string[] = []
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
    if (method === 'getFile') fileCalls.push(b.file_id)
    if (method === 'getFile') return files.has(b.file_id) ? json({ ok: true, result: { file_path: b.file_id } }) : json({ ok: false, error_code: 400, description: 'Bad Request: wrong file_id' })
    return json({ ok: false, error_code: 404, description: 'Not Found' })
  }) as typeof fetch
  return { files, msgs, sent, fileCalls, pin: (m: number) => (pinned = m), next: () => next }
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
  cfg.saveTelegram({ token: TOKEN, chat: '@my_channel', mirrors: [] })
  const db = dbm.getDb()
  const bill = db.prepare('INSERT INTO bills (tin, number, pass, status, issued, amount, case_number, ctype, kind, yymm, hay, cat, court) VALUES (?, ?, 0, ?, ?, 100, ?, ?, ?, ?, ?, ?, ?)')
  // random filler so every year bucket is several pieces at the 4 KiB piece size
  for (let i = 0; i < 300; i++) bill.run(TIN, `a${i}`, 'PAID', ms('2024-03-01') + i, `2-1004-24${10 + (i % 80)}/${i}`, 'civil', 'duty', 2410, crypto.randomBytes(40).toString('hex'), 'x', 'c')
  for (let i = 0; i < 300; i++) bill.run(TIN, `b${i}`, 'PAID', ms('2025-03-01') + i, `2-1004-25${10 + (i % 80)}/${i}`, 'civil', 'duty', 2510, crypto.randomBytes(40).toString('hex'), 'x', 'c')
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
    const first = ch.files.get('F1')! // the state bucket: restored, so the change must be caught
    const bad = new Uint8Array(first)
    bad[40] ^= 1
    ch.files.set('F1', bad)
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

describe('a backup never takes data away from the channel', () => {
  const OTHER2 = '201052713'
  const seedOther = () => {
    const db = dbm.getDb()
    db.prepare("INSERT INTO bills (tin, number, pass, status, issued, amount, case_number, hay) VALUES (?, ?, 0, ?, ?, 5, '2-1004-2402/5', ?)").run(OTHER2, 'z1', 'PAID', ms('2024-02-02'), 'h')
    db.prepare('INSERT INTO bill_loads (tin, total_elements, total_pages, page_size, pass, pages_done, complete, stable, loaded_at) VALUES (?, 1, 1, 10000, 0, 1, 1, 1, 5)').run(OTHER2)
  }

  test('a computer that holds ANOTHER company backs up without dropping the first one', async () => {
    fakeChannel()
    await runBackup() // computer A: the company TIN
    // computer B: an empty database with only OTHER2
    dbm.closeDb()
    for (const n of fs.readdirSync(DIR)) if (n.startsWith('sud.db')) fs.rmSync(path.join(DIR, n), { force: true })
    seedOther()
    const b = await runBackup()
    expect(b.phase).toBe('done')
    expect(b.message).toContain('kanaldan olingan')
    const cat = catalogLib.readCatalog()!
    expect(cat.companies.map((c) => c.tin).sort()).toEqual([OTHER2, TIN].sort())
    // and the restore has both
    backup.startRestore(PASS)
    const r = await finished()
    const copy = dbm.openDbFile(r.result!.restoredFile!)
    expect(Number(copy.prepare('SELECT COUNT(*) c FROM bills WHERE tin = ?').get(TIN)?.c)).toBe(600)
    expect(Number(copy.prepare('SELECT COUNT(*) c FROM bills WHERE tin = ?').get(OTHER2)?.c)).toBe(1)
    copy.close()
  })

  test('a company both computers hold: the backup is the union of their rows', async () => {
    fakeChannel()
    await runBackup() // A: bills a0..a299 (2024) and b0..b299 (2025)
    dbm.closeDb()
    for (const n of fs.readdirSync(DIR)) if (n.startsWith('sud.db')) fs.rmSync(path.join(DIR, n), { force: true })
    // B holds the same company but only one new bill in 2025
    dbm.getDb().prepare("INSERT INTO bills (tin, number, pass, status, issued, amount, case_number, hay) VALUES (?, 'new1', 0, 'PAID', ?, 7, '2-1004-2506/77', 'h')").run(TIN, ms('2025-06-06'))
    await runBackup()
    backup.startRestore(PASS)
    const r = await finished()
    const copy = dbm.openDbFile(r.result!.restoredFile!)
    expect(Number(copy.prepare("SELECT COUNT(*) c FROM bills WHERE tin = ? AND number LIKE 'b%'").get(TIN)?.c)).toBe(300) // A's rows are still there
    expect(copy.prepare("SELECT amount FROM bills WHERE number = 'new1'").get()?.amount).toBe(7) // and B's new one
    copy.close()
  })
})

describe('catalog and loading single companies from the channel', () => {
  const OTHER = '201052713'

  test('the catalog lists what the channel holds, saved locally for the «already in Telegram» prompt', async () => {
    fakeChannel()
    await runBackup()
    // a backup already leaves the list behind
    expect(catalogLib.catalogFor(TIN)).toMatchObject({ tin: TIN, bills: 600, found: 1, firstAt: 100, refreshedAt: 777 })
    expect(catalogLib.catalogFor(OTHER)).toBeNull()
    dbm.getDb().prepare("DELETE FROM meta WHERE k = 'telegram_catalog'").run()
    expect(catalogLib.catalogFor(TIN)).toBeNull()
    const r = await backup.readRemoteCatalog(PASS)
    expect(r.ok && r.catalog.companies.map((c) => c.tin)).toEqual([TIN])
    expect(catalogLib.catalogFor(TIN)?.bills).toBe(600)
    expect(await backup.readRemoteCatalog('some other pass phrase')).toMatchObject({ ok: false })
  })

  test('a company forgotten here comes back from the channel: bills, found cases, details, state and dates', async () => {
    fakeChannel()
    await runBackup()
    const before = allBuckets(dbm.getDb())
    admin.forgetCompany(TIN)
    dbm.getDb().prepare('DELETE FROM case_details').run()
    expect(billsLib.queryBills(TIN, {})).toBeNull()
    const snap = await import('../snapshot-store')
    snap.writeSnapshot(TIN, 'stats', { old: true })
    snap.writeSnapshot(TIN, 'court:civil', ['old'])
    expect(backup.startLoad(PASS, [TIN]).ok).toBe(true)
    const r = await finished()
    expect(r.phase).toBe('done')
    expect(r.result!.loadedTins).toEqual([TIN])
    expect(snap.readSnapshot(TIN, 'stats')).toBeNull() // the day-old stats and court lists would still show the count from before the load
    expect(snap.readSnapshot(TIN, 'court:civil')).toBeNull()
    expect(allBuckets(dbm.getDb())).toEqual(before)
    expect(billsLib.queryBills(TIN, {})?.total).toBe(600) // the cached summary was dropped
    expect(dbm.getDb().prepare('SELECT first_at, refreshed_at FROM companies').get()).toMatchObject({ first_at: 100, refreshed_at: 777 })
  })

  test('other companies in the database are left alone', async () => {
    fakeChannel()
    await runBackup()
    dbm.getDb().prepare("INSERT INTO bills (tin, number, pass, status, issued, amount, hay) VALUES (?, 'z1', 0, 'PAID', 1, 5, 'h')").run(OTHER)
    admin.forgetCompany(TIN)
    backup.startLoad(PASS, [TIN])
    await finished()
    expect(Number(dbm.getDb().prepare('SELECT COUNT(*) c FROM bills WHERE tin = ?').get(OTHER)?.c)).toBe(1)
  })

  test('a newer copy in the database keeps its bills; only the missing ones are added', async () => {
    fakeChannel()
    await runBackup()
    const db = dbm.getDb()
    db.prepare("UPDATE bills SET status = 'OVERDUE' WHERE number = 'a1'").run()
    db.prepare("DELETE FROM bills WHERE number = 'a2'").run()
    db.prepare('UPDATE companies SET refreshed_at = 999999 WHERE tin = ?').run(TIN) // newer than the backup's 777
    backup.startLoad(PASS, [TIN])
    await finished()
    expect(db.prepare("SELECT status FROM bills WHERE number = 'a1'").get()?.status).toBe('OVERDUE') // kept
    expect(db.prepare("SELECT status FROM bills WHERE number = 'a2'").get()?.status).toBe('PAID') // added back
    expect(db.prepare('SELECT refreshed_at FROM companies WHERE tin = ?').get(TIN)?.refreshed_at).toBe(999999)
  })

  test('a company the channel does not hold, and bad input, are refused', async () => {
    fakeChannel()
    await runBackup()
    backup.startLoad(PASS, [OTHER])
    const r = await finished()
    expect(r.phase).toBe('error')
    expect(r.message).toContain('topilmadi')
    expect(backup.startLoad(PASS, []).ok).toBe(false)
    expect(backup.startLoad(PASS, ['12']).ok).toBe(false)
    expect(backup.startLoad('short', [TIN]).ok).toBe(false)
  })
})

describe('the locator: search the Telegram copy without loading a company', () => {
  const clearLocal = () => {
    dbm.getDb().prepare('DELETE FROM locator').run()
    dbm.getDb().prepare('DELETE FROM locator_shards').run()
  }

  test('reading the catalog brings the locator; cases, bills and companies are found by prefix, and «loaded» tells what is local', async () => {
    fakeChannel()
    await runBackup()
    dbm.getDb().prepare("INSERT INTO bills (tin, number, pass, status, issued, amount, case_number, hay) VALUES (?, 'x1', 0, 'PAID', ?, 1, '2-1004-2403/55', 'h')").run(TIN, ms('2024-06-01'))
    await runBackup() // the new bill is in the index now
    clearLocal()
    expect(index.searchLocator('2-1004-24').hits).toEqual([]) // nothing local until the catalog is read
    const r = await backup.readRemoteCatalog(PASS)
    expect(r.ok && r.index).toMatchObject({ shards: 1, downloaded: 1 })

    const cases = index.searchLocator('2-1004-24')
    expect(cases.hits.map((h) => h.key).filter((k) => k.startsWith('2-1004-2403'))).toEqual(['2-1004-2403/1', '2-1004-2403/55'])
    expect(cases.hits[0]).toMatchObject({ kind: 'case', tin: TIN, court: 'civil', year: 24, loaded: true })
    expect(cases.indexed).toBeGreaterThan(600)

    expect(index.searchLocator('a1').hits).toEqual([]) // too short, and not a number
    dbm.getDb().prepare("INSERT OR REPLACE INTO locator (kind, key, tin, court, year, ref) VALUES ('b', '260880770031', ?, '', 2026, '2-1005-2602/19321')").run(TIN)
    expect(index.searchLocator('2608807').hits[0]).toMatchObject({ kind: 'bill', key: '260880770031', year: 2026, caseNumber: '2-1005-2602/19321' })

    const co = index.searchLocator(TIN.slice(0, 5))
    expect(co.hits[0]).toMatchObject({ kind: 'company', tin: TIN, bills: 601, loaded: true })
  })

  test('a company that is not in the local database is reported as not loaded, and a load makes it loaded', async () => {
    fakeChannel()
    await runBackup()
    clearLocal()
    await backup.readRemoteCatalog(PASS)
    admin.forgetCompany(TIN)
    expect(index.searchLocator('2-1004-2403/1').hits[0]).toMatchObject({ tin: TIN, loaded: false })
    backup.startLoad(PASS, [TIN])
    await finished()
    expect(index.searchLocator('2-1004-2403/1').hits[0]).toMatchObject({ loaded: true })
  })

  test('only an index bucket that changed is downloaded again', async () => {
    const ch = fakeChannel()
    await runBackup()
    clearLocal()
    await backup.readRemoteCatalog(PASS)
    const calls = ch.fileCalls.length
    const again = await backup.readRemoteCatalog(PASS)
    expect(again.ok && again.index).toMatchObject({ downloaded: 0 })
    expect(ch.fileCalls.length).toBe(calls + 1) // the manifest only
    dbm.getDb().prepare("UPDATE bills SET case_number = '2-1004-2403/77' WHERE number = 'a1'").run()
    await runBackup()
    const third = await backup.readRemoteCatalog(PASS)
    expect(third.ok && third.index).toMatchObject({ downloaded: 1 })
    expect(index.searchLocator('2-1004-2403/77').hits).toHaveLength(1)
  })

  test('a backup without a locator or a wrong passphrase leaves the search empty, not broken', async () => {
    fakeChannel()
    await runBackup()
    clearLocal()
    expect((await backup.readRemoteCatalog('some other pass phrase')).ok).toBe(false)
    expect(index.searchLocator('2-1004')).toMatchObject({ hits: [], indexed: 0, companies: 0 })
    expect(index.searchLocator('ab').hits).toEqual([])
  })
})

/** several fake channels in one Bot API: every chat keeps its own files and pinned message; a chat can be «banned» (everything of it fails) or lose its pin */
function fakeChannels() {
  const files = new Map<string, { chat: string; bytes: Uint8Array }>()
  const msgs = new Map<string, { chat: string; fileId: string; name: string }>()
  const pinned = new Map<string, string>() // chat → message key
  const banned = new Set<string>()
  const sentTo = new Map<string, number>()
  let next = 1
  const gone = (id: string) => new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the channel chat' }))
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const json = (v: unknown) => new Response(JSON.stringify(v))
    if (u.includes('/file/bot')) {
      const f = files.get(u.split('/file/bot')[1]!.split('/').slice(1).join('/'))
      return f && !banned.has(f.chat) ? new Response(f.bytes as BodyInit) : new Response('', { status: 404 })
    }
    const method = u.split('/').pop()!
    if (method === 'sendDocument') {
      const form = init!.body as FormData
      const chat = String(form.get('chat_id'))
      if (banned.has(chat)) return gone(chat)
      const blob = form.get('document') as File
      const id = `F${next}`
      files.set(id, { chat, bytes: new Uint8Array(await blob.arrayBuffer()) })
      msgs.set(`${chat}#${next}`, { chat, fileId: id, name: blob.name })
      sentTo.set(chat, (sentTo.get(chat) ?? 0) + 1)
      return json({ ok: true, result: { message_id: next++, document: { file_id: id } } })
    }
    const b = JSON.parse(String(init!.body))
    const chat = String(b.chat_id)
    if (method === 'getFile') {
      const f = files.get(b.file_id)
      return f && !banned.has(f.chat) ? json({ ok: true, result: { file_path: b.file_id } }) : json({ ok: false, error_code: 400, description: 'Bad Request: wrong file_id' })
    }
    if (banned.has(chat)) return gone(chat)
    if (method === 'pinChatMessage') {
      pinned.set(chat, `${chat}#${b.message_id}`)
      return json({ ok: true, result: true })
    }
    if (method === 'getChat') {
      const key = pinned.get(chat)
      const m = key ? msgs.get(key) : undefined
      return json({ ok: true, result: { id: -1001, type: 'channel', pinned_message: m ? { message_id: Number(key!.split('#')[1]), document: { file_id: m.fileId, file_name: m.name } } : undefined } })
    }
    return json({ ok: false, error_code: 404, description: 'Not Found' })
  }) as typeof fetch
  return { files, banned, sentTo, unpin: (chat: string) => pinned.delete(chat) }
}

describe('mirror channels: a banned channel or a deleted manifest message does not lose the backup', () => {
  const MAIN = '@my_channel'
  const MIRROR = '@backup_channel'
  beforeEach(() => cfg.saveTelegram({ token: TOKEN, chat: MAIN, mirrors: [MIRROR] }))

  test('one backup fills BOTH channels, each with its own chain, and says so', async () => {
    const ch = fakeChannels()
    const done = await runBackup()
    expect(done.phase).toBe('done')
    expect(done.message).toContain('2 ta kanalga')
    expect(ch.sentTo.get(MAIN)).toBeGreaterThan(5)
    expect(ch.sentTo.get(MIRROR)).toBe(ch.sentTo.get(MAIN)) // the same pieces and a manifest in each
    expect(backup.lastBackup()?.channels).toEqual([{ chat: MAIN, ok: true }, { chat: MIRROR, ok: true }])
    // the channels share no file: a file id of one means nothing in the other
    const owners = new Set([...ch.files.values()].map((f) => f.chat))
    expect(owners).toEqual(new Set([MAIN, MIRROR]))
  })

  const OTHER = '201052713'
  const seedOtherCompany = (numbers: string[]) => {
    const db = dbm.getDb()
    for (const n of numbers) db.prepare("INSERT INTO bills (tin, number, pass, status, issued, amount, case_number, ctype, kind, yymm, hay) VALUES (?, ?, 0, 'PAID', ?, 5, ?, 'civil', 'duty', 2402, 'h')").run(OTHER, n, ms('2024-02-02'), `2-1004-2402/${n.slice(1)}`)
    db.prepare('INSERT OR REPLACE INTO bill_loads (tin, total_elements, total_pages, page_size, pass, pages_done, complete, stable, loaded_at) VALUES (?, ?, 1, 10000, 0, 1, 1, 1, 5)').run(OTHER, numbers.length)
    db.prepare('INSERT OR REPLACE INTO companies (tin, first_at, refreshed_at, last_added) VALUES (?, 1, 5, 0)').run(OTHER)
  }
  const forgetOtherHere = () => {
    const db = dbm.getDb()
    db.prepare('DELETE FROM bills WHERE tin = ?').run(OTHER)
    db.prepare('DELETE FROM bill_loads WHERE tin = ?').run(OTHER)
    db.prepare('DELETE FROM companies WHERE tin = ?').run(OTHER)
  }

  test('CATCH-UP: a mirror started later gets what the main channel holds from another computer, and says so', async () => {
    const ch = fakeChannels()
    cfg.saveTelegram({ token: TOKEN, chat: MAIN, mirrors: [] })
    seedOtherCompany(['z1', 'z2'])
    expect((await runBackup()).phase).toBe('done') // computer B backs up TWO companies to the main channel only
    // this computer holds only the first company; the mirror is new
    forgetOtherHere()
    cfg.saveTelegram({ token: TOKEN, chat: MAIN, mirrors: [MIRROR] })
    const done = await runBackup()
    expect(done.phase).toBe('done')
    expect(done.message).toContain('2 ta kanalga')
    expect(done.message).toContain('asosiy kanaldan koʻchirildi')
    // the main channel is lost: the mirror alone has BOTH companies, and a load brings the other one back
    ch.banned.add(MAIN)
    const cat = await backup.readRemoteCatalog(PASS)
    expect(cat.ok && cat.catalog.companies.map((c) => c.tin).sort()).toEqual([OTHER, TIN].sort())
    expect(backup.startLoad(PASS, [OTHER]).ok).toBe(true)
    expect((await finished()).phase).toBe('done')
    expect(dbm.getDb().prepare('SELECT COUNT(*) n FROM bills WHERE tin = ?').get(OTHER)?.n).toBe(2)
    expect(dbm.getDb().prepare('SELECT first_at FROM companies WHERE tin = ?').get(OTHER)?.first_at).toBe(1)
  })

  test('CATCH-UP: a bucket the mirror has with FEWER rows than the main channel is merged, not replaced', async () => {
    fakeChannels()
    cfg.saveTelegram({ token: TOKEN, chat: MAIN, mirrors: [] })
    seedOtherCompany(['z1', 'z2', 'z3'])
    await runBackup()
    forgetOtherHere()
    seedOtherCompany(['z1']) // this computer has one of the three
    cfg.saveTelegram({ token: TOKEN, chat: MAIN, mirrors: [MIRROR] })
    const done = await runBackup()
    expect(done.phase).toBe('done')
    // the mirror's bucket holds all three (its own text was only z1)
    cfg.saveTelegram({ token: TOKEN, chat: MIRROR, mirrors: [] }) // read the mirror as if it were the only channel
    forgetOtherHere()
    expect(backup.startLoad(PASS, [OTHER]).ok).toBe(true)
    expect((await finished()).phase).toBe('done')
    expect(dbm.getDb().prepare('SELECT COUNT(*) n FROM bills WHERE tin = ?').get(OTHER)?.n).toBe(3)
  })

  test('CATCH-UP costs nothing once the channels agree: a second backup copies nothing and the message does not mention it', async () => {
    const ch = fakeChannels()
    cfg.saveTelegram({ token: TOKEN, chat: MAIN, mirrors: [] })
    seedOtherCompany(['z1'])
    await runBackup()
    forgetOtherHere()
    cfg.saveTelegram({ token: TOKEN, chat: MAIN, mirrors: [MIRROR] })
    await runBackup() // copies
    const before = ch.sentTo.get(MIRROR) ?? 0
    const again = await runBackup()
    expect(again.phase).toBe('done')
    expect(again.message).not.toContain('koʻchirildi')
    expect((ch.sentTo.get(MIRROR) ?? 0) - before).toBe(1) // only the new manifest
  })

  test('a main channel that failed is not a donor: the mirror backs up from this computer alone, as before', async () => {
    const ch = fakeChannels()
    await runBackup()
    ch.banned.add(MAIN)
    const done = await runBackup()
    expect(done.message).toContain('Qisman: 1/2')
    expect(done.message).not.toContain('koʻchirildi')
  })

  test('inspectChannels: what each channel really holds, since when its chain exists, missing pieces, and what it lacks', async () => {
    const ch = fakeChannels()
    cfg.saveTelegram({ token: TOKEN, chat: MAIN, mirrors: [] })
    await runBackup()
    // a mirror added LATER: nothing in it yet
    cfg.saveTelegram({ token: TOKEN, chat: MAIN, mirrors: [MIRROR] })
    const before = await backup.inspectChannels(PASS)
    expect(before.ok && before.channels.map((c) => [c.role, c.ok])).toEqual([['asosiy', true], ['zaxira', false]])
    expect(before.ok && before.channels[1]!.error).toContain('yoʻq')
    await runBackup()
    const a = await backup.inspectChannels(PASS)
    if (!a.ok) throw new Error(a.error)
    const [main, mirror] = a.channels as [typeof a.channels[number], typeof a.channels[number]]
    expect(main).toMatchObject({ role: 'asosiy', ok: true, partsMissing: 0 })
    expect(mirror).toMatchObject({ role: 'zaxira', ok: true, partsMissing: 0, lacking: 0 })
    expect(mirror.buckets).toBe(main.buckets)
    // the main chain began with the FIRST backup; the mirror's chain began with the second: «since» tells them apart
    expect(Date.parse(main.since!)).toBeLessThan(Date.parse(mirror.since!))
    expect(main.since! <= main.created!).toBe(true)
    // a third backup moves «created» on and keeps «since»
    await runBackup()
    const b = await backup.inspectChannels(PASS)
    expect(b.ok && b.channels[0]!.since).toBe(main.since)
    expect(b.ok && b.channels[0]!.created! > main.created!).toBe(true)
    // a piece of the mirror is gone: it is counted
    const victim = [...ch.files.entries()].find(([, f]) => f.chat === MIRROR)![0]
    ch.files.delete(victim)
    const c = await backup.inspectChannels(PASS)
    expect(c.ok && c.channels[1]!.partsMissing).toBe(1)
    expect(await backup.inspectChannels('another long passphrase')).toMatchObject({ ok: false })
  })

  test('the main channel is banned: the catalog, the locator, a load and a restore all come from the mirror', async () => {
    const ch = fakeChannels()
    await runBackup()
    ch.banned.add(MAIN)
    const cat = await backup.readRemoteCatalog(PASS)
    expect(cat.ok && cat.catalog.companies.map((c) => c.tin)).toEqual([TIN])
    backup.startRestore(PASS)
    const r = await finished()
    expect(r.phase).toBe('done')
    expect(r.message).toContain(`zaxira kanal ${MIRROR} ishlatildi`)
    const copy = dbm.openDbFile(r.result!.restoredFile!)
    expect(allBuckets(copy)).toEqual(allBuckets(dbm.getDb()))
    copy.close()
    dbm.getDb().prepare('DELETE FROM bills WHERE tin = ?').run(TIN)
    expect(backup.startLoad(PASS, [TIN]).ok).toBe(true)
    expect((await finished()).phase).toBe('done')
    expect(dbm.getDb().prepare('SELECT COUNT(*) n FROM bills WHERE tin = ?').get(TIN)?.n).toBe(600)
  })

  test('the pinned manifest message of the main channel is deleted: the mirror is read', async () => {
    const ch = fakeChannels()
    await runBackup()
    ch.unpin(MAIN)
    const cat = await backup.readRemoteCatalog(PASS)
    expect(cat.ok).toBe(true)
    backup.startRestore(PASS)
    expect((await finished()).phase).toBe('done')
  })

  test('a piece deleted from the main channel while its manifest is alive: the restore falls to the mirror', async () => {
    const ch = fakeChannels()
    await runBackup()
    const victim = [...ch.files.entries()].find(([, f]) => f.chat === MAIN)![0]
    ch.files.delete(victim)
    backup.startRestore(PASS)
    const r = await finished()
    expect(r.phase).toBe('done')
    expect(r.message).toContain('zaxira kanal')
  })

  test('a banned main channel does not stop the mirror from being updated, and the result says what worked', async () => {
    const ch = fakeChannels()
    await runBackup()
    ch.banned.add(MAIN)
    dbm.getDb().prepare("UPDATE bills SET status = 'USED' WHERE number = 'b5'").run()
    const done = await runBackup()
    expect(done.phase).toBe('done')
    expect(done.message).toContain('Qisman: 1/2')
    expect(backup.lastBackup()?.channels).toEqual([{ chat: MAIN, ok: false }, { chat: MIRROR, ok: true }])
    backup.startRestore(PASS)
    const r = await finished()
    const copy = dbm.openDbFile(r.result!.restoredFile!)
    expect(copy.prepare("SELECT status FROM bills WHERE number = 'b5'").get()?.status).toBe('USED')
    copy.close()
  })

  test('every channel down is an error that names each of them; a wrong passphrase is not retried on the mirror', async () => {
    const ch = fakeChannels()
    await runBackup()
    const bad = await runBackup('some other pass phrase')
    expect(bad.phase).toBe('error')
    expect(bad.message).toContain('Parol')
    ch.banned.add(MAIN)
    ch.banned.add(MIRROR)
    const none = await backup.readRemoteCatalog(PASS)
    expect(none.ok).toBe(false)
    expect(!none.ok && none.error).toContain(MAIN)
    expect(!none.ok && none.error).toContain(MIRROR)
  })
})

describe('company names in the backup', () => {
  const name = (c: unknown) => (c as { name?: string }).name
  test('the manifest names a company by what its own bills say (the most common payer whose TIN is the company\'s)', async () => {
    fakeChannel()
    const db = dbm.getDb()
    const ins = db.prepare('UPDATE bills SET payer = ?, payer_tin = ? WHERE number = ?')
    for (let i = 0; i < 5; i++) ins.run('"ANOR TEXTILE" МЧЖ', TIN, `a${i}`)
    ins.run('"ANOR TEXTILE MChJ"', TIN, 'a5') // a rarer spelling
    ins.run('Somebody Else', '111111111', 'a6') // a bill paid by another person: not the company
    expect(bk.companyNameOf(TIN)).toBe('"ANOR TEXTILE" МЧЖ')
    expect((await runBackup()).phase).toBe('done')
    const cat = await backup.readRemoteCatalog(PASS)
    expect(cat.ok && name(cat.catalog.companies.find((c) => c.tin === TIN))).toBe('"ANOR TEXTILE" МЧЖ')
  })

  test('a company with no bill that names it has no name; another computer\'s company keeps its name and dates when this one backs up', async () => {
    fakeChannel()
    const first = await runBackup()
    expect(first.phase).toBe('done')
    const none = await backup.readRemoteCatalog(PASS)
    expect(none.ok && name(none.catalog.companies[0])).toBeUndefined()
    // another computer's company is in the channel (bills + a name); this computer knows nothing about it
    const db = dbm.getDb()
    db.prepare("UPDATE bills SET payer = 'Boshqa MChJ', payer_tin = ? WHERE number = 'b1'").run(TIN)
    expect((await runBackup()).phase).toBe('done')
    // the local company row goes away (a computer that never scraped it): the next backup still carries its name and dates
    db.prepare('DELETE FROM bills WHERE tin = ?').run(TIN)
    db.prepare('DELETE FROM companies WHERE tin = ?').run(TIN)
    expect((await runBackup()).phase).toBe('done')
    const kept = await backup.readRemoteCatalog(PASS)
    const c = kept.ok ? kept.catalog.companies.find((x) => x.tin === TIN) : undefined
    expect(name(c)).toBe('Boshqa MChJ')
    expect(c?.refreshedAt).toBe(777)
  })
})

describe('downloaded court orders travel with the backup (for the bot)', () => {
  const ORD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-bk-'))
  const ID1 = '11111111-2222-3333-4444-555555555555'
  const ID2 = '66666666-7777-8888-9999-000000000000'
  const ORPHAN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const ID3 = '12121212-3434-5656-7878-909090909090'
  const pdf = (tag: string) => Buffer.from(`%PDF-1.4\n% ${tag}\n${crypto.randomBytes(300).toString('hex')}\n%%EOF`)
  const order = (id: string, pdfId: string, caseNumber: string, instance = 'FIRST') => ({ id, caseNumber, instance, result: 'FULFILLED', court: 'Andijon tumanlararo iqtisodiy sudi', judge: 'J. J.', category: 'Qarz', pdfId, pdfName: 'qaror.pdf', pdfSize: 400, courtType: 'ECONOMIC' as const })
  const orders = () => import('../public-orders/store')
  const pdfs = () => import('../public-orders/pdf-store')
  /** the buckets the newest manifest names, and the plain bytes of one of them (opened with the passphrase) */
  async function manifestOf(ch: ReturnType<typeof fakeChannel>) {
    const pinnedMsg = [...ch.msgs.entries()].filter(([, m]) => m.name.endsWith('manifest.bin')).pop()!
    const blob = ch.files.get(pinnedMsg[1].fileId)!
    const opened = crypt.openManifest(PASS, Buffer.from(blob))
    if (!opened.ok) throw new Error('manifest did not open')
    const m = opened.manifest as { buckets: Array<{ name: string; id: string; rows: number; parts: Array<{ fileId: string }> }> }
    const plain = (name: string) => {
      const b = m.buckets.find((x) => x.name === name)!
      const gz = Buffer.concat(b.parts.map((p, i) => crypt.open(opened.key, Buffer.from(ch.files.get(p.fileId)!), crypt.bucketAad(b.id, i))))
      return zlib.gunzipSync(gz)
    }
    return { names: m.buckets.map((b) => b.name), plain, m }
  }

  beforeEach(() => {
    process.env.PUBLIC_ORDERS_DIR = ORD_DIR
    process.env.PUBLIC_ORDERS_BACKUP_DIR = path.join(ORD_DIR, '..', 'orders-bk-copy')
    fs.rmSync(ORD_DIR, { recursive: true, force: true })
    fs.mkdirSync(ORD_DIR, { recursive: true })
  })
  afterAll(() => {
    fs.rmSync(ORD_DIR, { recursive: true, force: true })
    fs.rmSync(path.join(ORD_DIR, '..', 'orders-bk-copy'), { recursive: true, force: true })
    delete process.env.PUBLIC_ORDERS_DIR
    delete process.env.PUBLIC_ORDERS_BACKUP_DIR
  })

  test('every found order goes in as a record, a downloaded one also as its PDF bit for bit (a stray PDF and a failed check do not); a checked case with none says so; the PDF is sent once', async () => {
    const { appendOrders } = await orders()
    const { writePdf } = await pdfs()
    const bytes = pdf('one')
    await appendOrders([order('o1', ID1, '2-1004-2603/8020'), order('o2', ID2, '2-1004-2603/8021')]) // o2 was found, never downloaded
    await writePdf(ID1, bytes, { name: 'qaror.pdf', via: 'import' })
    await writePdf(ORPHAN, pdf('orphan'), { via: 'import' }) // a file with no record: nothing to attach it to
    const { markChecked } = await orders()
    const at = '2026-11-20T10:00:00.000Z'
    await markChecked({ caseNumber: '4-1001-2601/1', at, sig: '', seen: [], misses: 1 }) // checked, nothing published
    await markChecked({ caseNumber: '4-1001-2601/2', at, sig: '', seen: [], misses: 1, error: 'timeout' }) // a failed attempt says nothing
    await markChecked({ caseNumber: '2-1004-2603/8020', at, sig: '', seen: ['FIRST'], misses: 0 }) // has an order: no check line
    const ch = fakeChannel()
    const first = await runBackup()
    expect(first.phase).toBe('done')
    const m = await manifestOf(ch)
    expect(m.names).toContain('orders:26')
    expect(m.names).toContain(`pdf:${ID1}`)
    expect(m.names).not.toContain(`pdf:${ID2}`)
    expect(m.names).not.toContain(`pdf:${ORPHAN}`)
    // what the bot will read: both found orders (o2 with saved-at 0 = not downloaded) and the one «checked, none» line; the PDF identical to the file on disk
    const lines = m.plain('orders:26').toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown[])
    expect(lines).toHaveLength(3)
    const byId = (id: string) => lines.find((l) => l[0] === id)!
    expect(byId('o1').slice(0, 11)).toEqual(['o1', '2-1004-2603/8020', 'FIRST', 'FULFILLED', 'Andijon tumanlararo iqtisodiy sudi', 'J. J.', 'Qarz', ID1, 'qaror.pdf', 400, 'ECONOMIC'])
    expect(Number(byId('o1')[11])).toBeGreaterThan(0)
    expect(byId('o2')[11]).toBe(0)
    expect(byId('k')).toEqual(['k', '4-1001-2601/1', Date.parse('2026-11-20T10:00:00.000Z')])
    expect(m.plain(`pdf:${ID1}`).equals(bytes)).toBe(true)
    // nothing readable in the channel: the file names are opaque and the PDF text does not appear
    for (const f of ch.files.values()) expect(Buffer.from(f).includes(Buffer.from('%PDF-1.4'))).toBe(false)
    // a second backup sends only a manifest
    const files1 = ch.files.size
    const again = await runBackup()
    expect(again.result!.chunks).toBe(0)
    expect(ch.files.size).toBe(files1 + 1)
    // another order downloaded: its PDF and the changed year bucket go, the first PDF is not sent again
    const { appendOrders: add } = await orders()
    await add([order('o3', ID3, '2-1004-2603/8020', 'APPEAL')])
    await writePdf(ID3, pdf('two'), { via: 'import' })
    const third = await runBackup()
    expect(third.result!.buckets - third.result!.reused).toBe(2) // orders:26 + pdf:ID3
    const m3 = await manifestOf(ch)
    expect(m3.plain('orders:26').toString('utf8').split('\n').filter(Boolean)).toHaveLength(4) // o1, o2, o3 and the check line
    expect(m3.names.filter((n) => n.startsWith('pdf:'))).toHaveLength(2)
  })

  test('the restore and the company load ignore the orders (they are for the bot, not for the database); a backup with none is unchanged', async () => {
    const { appendOrders } = await orders()
    const { writePdf } = await pdfs()
    await appendOrders([order('o1', ID1, '2-1004-2603/8020')])
    await writePdf(ID1, pdf('one'), { via: 'import' })
    fakeChannel()
    expect((await runBackup()).phase).toBe('done')
    backup.startRestore(PASS)
    const r = await finished()
    expect(r.phase).toBe('done')
    const copy = dbm.openDbFile(r.result!.restoredFile!)
    expect(allBuckets(copy)).toEqual(allBuckets(dbm.getDb()))
    copy.close()
    // no orders on disk: no order bucket at all
    fs.rmSync(ORD_DIR, { recursive: true, force: true })
    fs.mkdirSync(ORD_DIR, { recursive: true })
    expect((await runBackup()).phase).toBe('done')
  })

  test('the fingerprint moves when a PDF or a record arrives and stays still otherwise', async () => {
    const ob = await import('../orders-buckets')
    const { appendOrders } = await orders()
    const { writePdf } = await pdfs()
    const empty = ob.ordersFingerprint()
    expect(ob.ordersFingerprint()).toBe(empty)
    await appendOrders([order('o1', ID1, '2-1004-2603/8020')])
    const withRecord = ob.ordersFingerprint()
    expect(withRecord).not.toBe(empty)
    await writePdf(ID1, pdf('one'), { via: 'import' })
    const withPdf = ob.ordersFingerprint()
    expect(withPdf).not.toBe(withRecord)
    expect(ob.ordersFingerprint()).toBe(withPdf)
  })

  test('bucket names: the year comes from the case number, and only well-formed names parse', async () => {
    const ob = await import('../orders-buckets')
    expect(ob.orderYear('2-1004-2603/8020')).toBe(26)
    expect(ob.orderYear('nonsense')).toBe(0)
    expect(bk.parseBucket('orders:26')).toMatchObject({ kind: 'orders', year: 26 })
    expect(bk.parseBucket('orders:x')).toBeNull()
    expect(bk.parseBucket(`pdf:${ID1}`)).toMatchObject({ kind: 'pdf', key: ID1 })
    expect(bk.parseBucket('pdf:../etc/passwd')).toBeNull()
    expect(bk.parseBucket('pdf:a:b')).toBeNull()
    // a PDF has nothing to merge, and an old record is replaced by this computer's
    expect(bk.mergeBucketText(`pdf:${ID1}`, Buffer.from('old'), Buffer.from([1, 2, 3])).equals(Buffer.from([1, 2, 3]))).toBe(true)
    const merged = bk.mergeBucketText('orders:26', Buffer.from('["o1","old"]\n["o0","x"]\n'), Buffer.from('["o1","new"]\n')).toString('utf8')
    expect(merged).toBe('["o0","x"]\n["o1","new"]\n')
    // an order the channel knows as DOWNLOADED is not turned back into «not downloaded» by a computer that lacks the PDF; a later check replaces an earlier one
    const row = (id: string, saved: number) => JSON.stringify([id, 'c', 'FIRST', '', '', '', '', 'pdf-' + id, '', 1, 'ECONOMIC', saved])
    const m2 = bk.mergeBucketText('orders:26', Buffer.from(`${row('a', 1700)}\n["k","x",100]\n`), Buffer.from(`${row('a', 0)}\n["k","x",200]\n`)).toString('utf8').split('\n').filter(Boolean)
    expect(m2).toEqual([row('a', 1700), '["k","x",200]'])
  })
})
