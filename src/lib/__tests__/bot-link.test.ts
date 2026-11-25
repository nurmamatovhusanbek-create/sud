/**
 * The link with the bot (lib/bot-link): the signature is the one the Rust bot checks (a fixed vector computed independently), the bot's address is
 * https only, the bot's answer is trusted for nothing but «nine digits and a number», and the poll loop does the right thing in order: take a job, refresh
 * the company, wait for a backup that STARTED after it, tell the bot; a failed refresh is told at once; the bot is told about every backup.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

mock.module('server-only', () => ({}))
// the shared PDF loader is replaced by a fake one passed in (the real one goes to public.sud.uz): what it does is set by each test
let loaderCalls: string[] = []
let loaderBehaviour: (id: string) => Promise<{ saved: boolean; saveError?: string }> = async () => ({ saved: true })
const fakeLoader = async (id: string) => { loaderCalls.push(id); return loaderBehaviour(id) }
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-link-'))
process.env.SUD_DB = path.join(DIR, 'sud.db')
process.env.CASE_STORE_DIR = path.join(DIR, 'cases')
process.env.SUD_BACKUP_PASS_FILE = path.join(DIR, 'pass.json')
process.env.PUBLIC_ORDERS_DIR = path.join(DIR, 'orders')
process.env.PUBLIC_ORDERS_BACKUP_DIR = path.join(DIR, 'orders-copy')
const dbm = await import('../db')
const store = await import('../case-store')
const ab = await import('../auto-backup')
const bl = await import('../bot-link')
import type { BackupView, LinkDeps, Reply } from '../bot-link'

beforeEach(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
  fs.mkdirSync(DIR, { recursive: true })
  store.forgetCaseStoreMemory()
  bl.forgetLink()
})
afterAll(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('the signature', () => {
  // computed with Python's hmac/hashlib, and the same vector is in bot/src/link.rs
  const TOKEN = '123456:TEST-token'
  test('is the one the Rust bot checks', () => {
    expect(bl.linkKey(TOKEN).toString('hex')).toBe('71bee8cd5078605f430a96601ec4ac51c8abf80c0e87d2e03ef27a28c77672d0')
    expect(bl.signLink(TOKEN, 1700000000, '/link/pull', '{"a":1}')).toBe('b8e0ad794adb63a34d19ea7551a533291d4c9958806875d8ae629094b336597c')
  })
  test('covers the time, the path and the body', () => {
    const base = bl.signLink(TOKEN, 1, '/link/pull', '{}')
    expect(bl.signLink(TOKEN, 2, '/link/pull', '{}')).not.toBe(base)
    expect(bl.signLink(TOKEN, 1, '/link/synced', '{}')).not.toBe(base)
    expect(bl.signLink(TOKEN, 1, '/link/pull', '{ }')).not.toBe(base)
    expect(bl.signLink('123456:other', 1, '/link/pull', '{}')).not.toBe(base)
  })
})

describe('the bot address and its answer', () => {
  test('https only (http for this computer), no path or credentials', () => {
    expect(bl.normalizeBotUrl('https://sud-bot.onrender.com/')).toBe('https://sud-bot.onrender.com')
    expect(bl.normalizeBotUrl(' https://sud-bot.onrender.com/app?x=1 ')).toBe('https://sud-bot.onrender.com')
    expect(bl.normalizeBotUrl('http://localhost:8080')).toBe('http://localhost:8080')
    for (const bad of ['http://sud-bot.onrender.com', 'ftp://x.y', 'https://user:pw@x.y', 'sud-bot.onrender.com', '', 5, null]) expect(bl.normalizeBotUrl(bad)).toBeNull()
  })
  test('only a STIR of nine digits and a whole number id are taken from the jobs', () => {
    expect(bl.parseJobs([{ id: 3, tin: '207275139' }, { id: '4', tin: '207275139' }, { id: 5, tin: '2072751390' }, { id: 6, tin: '../etc' }, { id: 1.5, tin: '207275139' }, null, 'x'])).toEqual([{ id: 3, tin: '207275139' }])
    expect(bl.parseJobs('nope')).toEqual([])
    // an order job: an order file id of the shapes the app writes, never a path
    const U = '11111111-2222-3333-4444-555555555555'
    expect(bl.parseJobs([{ id: 1, kind: 'order', pdfId: U }, { id: 2, kind: 'order', pdfId: '../x' }, { id: 3, kind: 'order', pdfId: 5 }, { id: 4, kind: 'order' }, { id: 5, kind: 'order', pdfId: 'old-civil-123' }, { id: 6, kind: 'weird', tin: '207275139' }])).toEqual([{ id: 1, pdfId: U }, { id: 5, pdfId: 'old-civil-123' }, { id: 6, tin: '207275139' }])
  })
  test('the setting is kept, and off keeps the address', () => {
    expect(bl.readLink()).toEqual({ enabled: false, url: '' })
    expect(bl.setLink(true, 'http://evil.example').ok).toBe(false)
    expect(bl.setLink(true, 'https://sud-bot.onrender.com/')).toEqual({ ok: true })
    expect(bl.readLink()).toEqual({ enabled: true, url: 'https://sud-bot.onrender.com' })
    bl.setLink(false)
    expect(bl.readLink()).toEqual({ enabled: false, url: 'https://sud-bot.onrender.com' })
  })
})

describe('the poll loop', () => {
  let t = 0
  let enabled = true
  let jobs: Array<{ id: number; tin: string }> = []
  let posts: Array<{ path: string; body: unknown }> = []
  let postOk = true
  let working = false
  let refreshed: string[] = []
  let refreshResult = { ok: true, note: '' }
  let downloaded: string[] = []
  let downloadResult = { ok: true, note: '' }
  let backup: BackupView = { busy: false, doneStartedAt: 0, doneId: '' }
  let nowAnswer: 'started' | 'unchanged' | 'busy' | 'unavailable' = 'started'
  let nowCalls = 0

  const deps: LinkDeps = {
    now: () => t,
    config: () => ({ enabled, url: 'https://sud-bot.onrender.com' }),
    hasToken: () => true,
    post: async (p, body): Promise<Reply> => {
      posts.push({ path: p, body })
      if (!postOk) return { ok: false, error: 'Bot javob bermadi' }
      if (p === '/link/pull') {
        const out = jobs
        jobs = []
        return { ok: true, jobs: out }
      }
      return { ok: true }
    },
    refresh: async (tin) => { refreshed.push(tin); return refreshResult },
    downloadOrder: async (id) => { downloaded.push(id); return downloadResult },
    working: () => working,
    backup: () => backup,
    backupNow: () => { nowCalls++; return nowAnswer },
  }
  const tick = async (advance = 60_000): Promise<void> => { t += advance; await bl.linkTick(deps); await new Promise((r) => setTimeout(r, 0)) }
  const synced = () => posts.filter((p) => p.path === '/link/synced')

  beforeEach(() => {
    t = 1_700_000_000_000; enabled = true; jobs = []; posts = []; postOk = true; working = false; refreshed = []; refreshResult = { ok: true, note: '' }; downloaded = []; downloadResult = { ok: true, note: '' }
    backup = { busy: false, doneStartedAt: 0, doneId: '' }; nowAnswer = 'started'; nowCalls = 0
  })

  test('off: nothing is sent', async () => {
    enabled = false
    await tick()
    expect(posts).toEqual([])
  })

  test('a refresh: pulled, read, a backup started after it, then the bot is told once', async () => {
    jobs = [{ id: 7, tin: '207275139' }]
    await tick() // pull → refresh runs → finished → no backup yet → backupNow
    await tick()
    expect(refreshed).toEqual(['207275139'])
    expect(nowCalls).toBeGreaterThanOrEqual(1)
    expect(synced()).toEqual([]) // not told before a backup holds it
    // a backup that started BEFORE the company was read does not count
    backup = { busy: false, doneStartedAt: t - 10 * 60_000, doneId: 'old' }
    await tick()
    expect(synced().every((p) => (p.body as { done: unknown[] }).done.length === 0)).toBe(true) // only the news of that backup
    // the backup that started after it
    backup = { busy: true, doneStartedAt: 0, doneId: '' }
    await tick()
    backup = { busy: false, doneStartedAt: t, doneId: 'new' }
    await tick()
    const told = synced().filter((p) => (p.body as { done: unknown[] }).done.length > 0)
    expect(told).toHaveLength(1)
    expect(told[0].body).toEqual({ done: [{ id: 7, ok: true, note: '' }] })
    await tick()
    expect(synced().filter((p) => (p.body as { done: unknown[] }).done.length > 0)).toHaveLength(1) // once
  })

  test('nothing new since the last automatic backup: the bot is told at once', async () => {
    jobs = [{ id: 1, tin: '207275139' }]
    nowAnswer = 'unchanged'
    await tick()
    await tick()
    expect(synced().at(-1)!.body).toEqual({ done: [{ id: 1, ok: true, note: '' }] })
  })

  test('a failed refresh is told at once, with its reason, and needs no backup', async () => {
    jobs = [{ id: 2, tin: '302678824' }]
    refreshResult = { ok: false, note: 'sud saytlari javob bermadi' }
    await tick()
    await tick()
    expect(synced()[0].body).toEqual({ done: [{ id: 2, ok: false, note: 'sud saytlari javob bermadi' }] })
    expect(nowCalls).toBe(0)
  })

  test('with the automatic backup off the bot is told so (nothing could carry the refresh to it)', async () => {
    jobs = [{ id: 3, tin: '207275139' }]
    nowAnswer = 'unavailable'
    await tick()
    await tick()
    const body = synced().at(-1)!.body as { done: Array<{ ok: boolean; note: string }> }
    expect(body.done[0].ok).toBe(false)
    expect(body.done[0].note).toContain('Avtomatik zaxira')
  })

  test('the bots hears of every finished backup, once, even with no refresh', async () => {
    backup = { busy: false, doneStartedAt: t, doneId: 'b1' }
    await tick()
    await tick()
    expect(synced()).toHaveLength(1)
    expect(synced()[0].body).toEqual({ done: [] })
    backup = { busy: false, doneStartedAt: t, doneId: 'b2' }
    await tick()
    expect(synced()).toHaveLength(2)
  })

  test('one company at a time, and not while the bills job or Kuzatuv runs', async () => {
    working = true
    jobs = [{ id: 1, tin: '207275139' }, { id: 2, tin: '302678824' }]
    await tick()
    expect(refreshed).toEqual([])
    working = false
    await tick()
    expect(refreshed).toEqual(['207275139'])
    await tick()
    expect(refreshed).toEqual(['207275139', '302678824'])
  })

  test('an order download from the phone: downloaded, a backup that started after it, then the bot is told (it sends the file)', async () => {
    const U = '11111111-2222-3333-4444-555555555555'
    jobs = [{ id: 31, kind: 'order', pdfId: U } as unknown as { id: number; tin: string }]
    await tick()
    await tick()
    expect(downloaded).toEqual([U])
    expect(refreshed).toEqual([])
    expect(synced()).toEqual([])
    backup = { busy: false, doneStartedAt: t + 1, doneId: 'o1' }
    await tick()
    expect(synced().at(-1)!.body).toEqual({ done: [{ id: 31, ok: true, note: '' }] })
  })

  test('a download the site refused is told at once with the reason and needs no backup', async () => {
    const U = '11111111-2222-3333-4444-555555555555'
    downloadResult = { ok: false, note: 'Sayt qarorni faqat odam tasdiqlagandan keyin beradi.' }
    jobs = [{ id: 32, kind: 'order', pdfId: U } as unknown as { id: number; tin: string }]
    await tick()
    await tick()
    expect(synced()[0]!.body).toEqual({ done: [{ id: 32, ok: false, note: 'Sayt qarorni faqat odam tasdiqlagandan keyin beradi.' }] })
    expect(nowCalls).toBe(0)
  })

  test('an unreachable bot is remembered and tried again, nothing is lost', async () => {
    postOk = false
    await tick()
    expect(bl.linkStatus().lastError).toBe('Bot javob bermadi')
    postOk = true
    jobs = [{ id: 9, tin: '207275139' }]
    await tick()
    expect(bl.linkStatus().lastError).toBeNull()
    expect(bl.linkStatus().lastPullAt).toBe(t)
  })
})

describe('a backup right now', () => {
  const PASS = 'a-long-test-passphrase'
  const mk = (over: Partial<import('../auto-backup').AutoDeps> = {}): import('../auto-backup').AutoDeps => ({
    now: () => 1_700_000_000_000, fingerprint: () => 'one', readPass: () => ab.readPass(), start: () => ({ ok: true }), busy: () => false, outcome: () => ({ ok: true, message: '' }), working: () => false, ...over,
  })
  test('needs the automatic backup on, skips the gap, and says «unchanged» when the channel already has everything', () => {
    expect(ab.backupNow(mk())).toBe('unavailable') // off
    ab.enableAuto(PASS)
    expect(ab.backupNow(mk({ busy: () => true }))).toBe('busy')
    expect(ab.backupNow(mk({ start: () => ({ ok: false, error: 'x' }) }))).toBe('unavailable')
    expect(ab.backupNow(mk())).toBe('started')
    expect(ab.backupNow(mk())).toBe('busy') // its own run is pending
    ab.autoBackupTick(mk({ now: () => 1_700_000_100_000 })) // the usual tick records how it ended
    expect(ab.backupNow(mk())).toBe('unchanged')
    expect(ab.backupNow(mk({ fingerprint: () => 'two' }))).toBe('started')
  })
})

describe('downloading one order for the phone', () => {
  const ORD = process.env.PUBLIC_ORDERS_DIR!
  const KNOWN = '66666666-7777-8888-9999-000000000000'
  const order = (pdfId: string) => ({ id: 'o-' + pdfId.slice(0, 4), caseNumber: '2-1004-2603/8020', instance: 'APPEAL', result: 'REFUSED', court: 'S', judge: 'J', category: 'C', pdfId, pdfName: 'q.pdf', pdfSize: 100, courtType: 'ECONOMIC' as const })
  beforeEach(() => {
    fs.rmSync(ORD, { recursive: true, force: true })
    fs.mkdirSync(ORD, { recursive: true })
    loaderCalls = []
    loaderBehaviour = async () => ({ saved: true })
  })

  test('only an order the app knows is asked for; one on disk is not asked again; a refusal says how to hand the file over; nothing is retried', async () => {
    const { appendOrders } = await import('../public-orders/store')
    const { writePdf } = await import('../public-orders/pdf-store')
    const { ManualDownloadRequired } = await import('../public-orders/order-pdf')
    // unknown: the site is not touched
    expect(await bl.downloadOrder(KNOWN, fakeLoader)).toMatchObject({ ok: false })
    expect(loaderCalls).toEqual([])
    await appendOrders([order(KNOWN)])
    // known: one attempt through the shared loader
    expect(await bl.downloadOrder(KNOWN, fakeLoader)).toEqual({ ok: true, note: '' })
    expect(loaderCalls).toEqual([KNOWN])
    // refused by the site: the reason and the way out, once
    loaderBehaviour = async () => { throw new ManualDownloadRequired('token rad etildi') }
    const refused = await bl.downloadOrder(KNOWN, fakeLoader)
    expect(refused.ok).toBe(false)
    expect(refused.note).toContain('HAR')
    expect(loaderCalls).toHaveLength(2)
    // a file that could not be kept on disk is not a success
    loaderBehaviour = async () => ({ saved: false, saveError: 'disk toʻla' })
    expect(await bl.downloadOrder(KNOWN, fakeLoader)).toMatchObject({ ok: false, note: expect.stringContaining('disk toʻla') })
    // already on disk: the loader is not asked at all
    await writePdf(KNOWN, Buffer.from('%PDF-1.4\nx\n%%EOF'), { via: 'import' })
    loaderCalls = []
    expect(await bl.downloadOrder(KNOWN, fakeLoader)).toEqual({ ok: true, note: '' })
    expect(loaderCalls).toEqual([])
  })
})
