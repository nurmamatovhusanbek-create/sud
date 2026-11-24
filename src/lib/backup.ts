import 'server-only'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import {
  CHUNK_PLAIN, MIN_PASSPHRASE, bucketAad, bucketId, chunkAad, chunkPlain, deriveKey, newSalt, open, openManifest, openManifestWithKey, seal, sealManifest, sha256,
  type AnyManifest, type BucketRef, type Manifest, type ManifestV2, type PartRef,
} from './backup-crypto'
import { retireCaseSnapshots } from './snapshot-store'
import { companyNameOf, importBucket, listBuckets, mergeBucketText, parseBucket, renderBucket } from './db-buckets'
import { dbPath, getDb, openDbFile } from './db'
import { snapshotFile } from './db-admin'
import { billJobRunning } from './bill-cases'
import { forgetBillsSummary } from './bills-store'
import { readCompany } from './company-meta'
import { buildCatalog, saveCatalog, type Catalog } from './telegram-catalog'
import { syncIndex, type SyncResult } from './telegram-index'
import { fileExists, getFileBytes, pinMessage, pinnedDocument, sendFile } from './telegram-client'
import { readTelegram } from './telegram-config'

/**
 * Encrypted copy of the database in the operator's Telegram channel, and the way back.
 *
 * BACKUP (incremental, content-addressed): a consistent snapshot of the database is cut into BUCKETS (`lib/db-buckets`: a company's bills of one year, its
 * found cases, case details of a year, its dates…). Each bucket gets an id = keyed SHA-256 of its text. The newest manifest in the channel (pinned)
 * says which ids are already there: a bucket whose id is unchanged is NOT sent again (it is checked to still exist in the channel), a changed or new one
 * is gzipped, cut into pieces of 19 MiB, sealed (AES-256-GCM, key from the passphrase) and sent under an opaque file name. A sealed MANIFEST (every bucket
 * with its pieces, each company's first-scrape and «as of» dates, and a pointer to the manifest before it) is sent last and PINNED. Nothing is ever deleted
 * from the channel: older manifests stay as history, and an unchanged bucket costs nothing. The passphrase is never stored: it is asked for every time,
 * and the SAME passphrase must be used again (the salt is carried over so that earlier pieces still open).
 * RESTORE: pinned manifest → every bucket's pieces (hash checked, opened, gunzipped, its id recomputed) → imported into a NEW file `sud.restored-<time>.db`
 * beside the live database. The live database is never touched; the operator closes the app and swaps the file. (Older full-file backups, manifest v1,
 * still restore.)
 *
 * One job at a time, in this process, polled by the page. Nothing starts by itself.
 */

export type BackupPhase = 'idle' | 'snapshot' | 'compress' | 'upload' | 'manifest' | 'download' | 'unpack' | 'done' | 'error'

export interface BackupState {
  kind: 'backup' | 'restore' | 'load' | null
  phase: BackupPhase
  /** buckets (or pieces, for an old backup) done / total */
  done: number
  total: number
  message: string
  startedAt: number
  finishedAt: number
  result: BackupResult | null
}

export interface BackupResult {
  id: string
  created: string
  /** plain bytes of everything in the backup */
  dbBytes: number
  /** bytes sent to Telegram by THIS run (pieces + manifest) */
  uploadedBytes: number
  /** pieces sent by this run */
  chunks: number
  buckets: number
  /** buckets that were already in the channel and were not sent again */
  reused: number
  /** restore only: the file written next to the live database */
  restoredFile?: string
  /** load only: the companies brought into the live database */
  loadedTins?: string[]
}

const g = globalThis as unknown as { __sudBackup?: BackupState }
const fresh = (): BackupState => ({ kind: null, phase: 'idle', done: 0, total: 0, message: '', startedAt: 0, finishedAt: 0, result: null })
const state = (): BackupState => (g.__sudBackup ??= fresh())

export const backupState = (): BackupState => ({ ...state() })
export const backupBusy = (): boolean => ['snapshot', 'compress', 'upload', 'manifest', 'download', 'unpack'].includes(state().phase)

function set(p: Partial<BackupState>): void {
  Object.assign(state(), p)
}
function fail(message: string): void {
  set({ phase: 'error', message, finishedAt: Date.now() })
}

/** a failure nobody planned for: the log gets the reason (never the token or passphrase: they are not in any message of this file), the page a short line */
function unexpected(what: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e)
  console.warn(`[backup] ${what}: ${msg}`)
  fail(`Kutilmagan xato: ${what} toʻxtadi (${msg.slice(0, 160)})`)
}

export type StartResult = { ok: true } | { ok: false; error: string }

function precheck(passphrase: string): StartResult | { ok: true; token: string; chat: string; chats: string[] } {
  if (backupBusy()) return { ok: false, error: 'Zaxira jarayoni allaqachon ketmoqda' }
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) return { ok: false, error: `Parol kamida ${MIN_PASSPHRASE} belgi boʻlishi kerak` }
  const tg = readTelegram()
  if (!tg) return { ok: false, error: 'Avval Telegram botini saqlang (Sozlamalar › Telegram)' }
  return { ok: true, token: tg.token, chat: tg.chat, chats: [tg.chat, ...tg.mirrors] }
}

export function startBackup(passphrase: string): StartResult {
  const pre = precheck(passphrase)
  if (!('token' in pre)) return pre
  g.__sudBackup = { ...fresh(), kind: 'backup', phase: 'snapshot', message: 'Nusxa olinmoqda…', startedAt: Date.now() }
  void runBackupAll(passphrase, pre.token, pre.chats).catch((e) => unexpected('zaxira', e))
  return { ok: true }
}

export function startRestore(passphrase: string): StartResult {
  const pre = precheck(passphrase)
  if (!('token' in pre)) return pre
  g.__sudBackup = { ...fresh(), kind: 'restore', phase: 'download', message: 'Manifest qidirilmoqda…', startedAt: Date.now() }
  void withFallback(pre.chats, (c) => runRestore(passphrase, pre.token, c)).catch((e) => unexpected('tiklash', e))
  return { ok: true }
}

const tmp = (suffix: string): string => path.join(os.tmpdir(), `sud-backup-${process.pid}-${crypto.randomBytes(4).toString('hex')}${suffix}`)
const rm = (...files: string[]): void => {
  for (const f of files) {
    try {
      fs.rmSync(f, { force: true })
    } catch {
      /* gone */
    }
  }
}
const gapMs = (): number => (process.env.SUD_BACKUP_GAP_MS !== undefined && process.env.SUD_BACKUP_GAP_MS !== '' ? Math.max(0, Number(process.env.SUD_BACKUP_GAP_MS) || 0) : 1100)
const pause = (ms: number): Promise<void> => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve())

async function sha256File(file: string): Promise<string> {
  const h = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), h)
  return h.digest('hex')
}

/** the manifest pinned in the channel, opened (null: none pinned). An error text when it cannot be used. */
async function pinnedManifest(token: string, chat: string, passphrase: string, wrong: string): Promise<{ ok: true; value: { m: AnyManifest; salt: Buffer; key: Buffer; pin: { messageId: number; fileId: string } } | null } | { ok: false; error: string }> {
  const pinned = await pinnedDocument(token, chat)
  if (!pinned.ok) return { ok: false, error: pinned.error }
  if (!pinned.value) return { ok: true, value: null }
  const mf = await getFileBytes(token, pinned.value.fileId)
  if (!mf.ok) return { ok: false, error: `Manifestni olib boʻlmadi: ${mf.error}` }
  const o = openManifest(passphrase, mf.value)
  if (!o.ok) {
    if (o.error === 'not_backup') return { ok: true, value: null } // something else is pinned: a new chain starts
    return { ok: false, error: wrong }
  }
  return { ok: true, value: { m: o.manifest, salt: o.salt, key: o.key, pin: { messageId: pinned.value.messageId, fileId: pinned.value.fileId } } }
}

/** download, check, open and unpack one bucket of the channel */
async function downloadBucket(token: string, key: Buffer, b: BucketRef): Promise<Buffer | null> {
  const gz: Buffer[] = []
  for (let i = 0; i < b.parts.length; i++) {
    const p = b.parts[i]!
    const f = await getFileBytes(token, p.fileId)
    if (!f.ok || f.value.length !== p.size || sha256(f.value) !== p.sha256) return null
    try {
      gz.push(open(key, f.value, bucketAad(b.id, i)))
    } catch {
      return null
    }
  }
  const text = zlib.gunzipSync(Buffer.concat(gz))
  return bucketId(key, text) === b.id ? text : null
}

/**
 * What the channel holds, by bucket name: the NEWEST version of every bucket ever uploaded in this chain (the pinned manifest first, then each `prev`).
 * A computer that holds only part of the data (a second machine, a fresh scrape) must not take the rest away from the channel, so a backup starts from
 * this union: buckets it has nothing new for are carried over, buckets both have are merged.
 */
async function chainBuckets(token: string, key: Buffer, newest: ManifestV2, limit = 60): Promise<{ buckets: Map<string, BucketRef>; oldest: string }> {
  const out = new Map<string, BucketRef>()
  let oldest = newest.created
  let m: ManifestV2 | null = newest
  for (let depth = 0; m && depth < limit; depth++) {
    for (const b of m.buckets) if (!out.has(b.name)) out.set(b.name, b)
    for (const d of [m.created, m.since]) if (d && d < oldest) oldest = d
    if (!m.prev) break
    const f = await getFileBytes(token, m.prev.fileId)
    if (!f.ok) break // an older manifest that is gone: what was gathered so far is what the channel certainly holds
    const older = openManifestWithKey(key, f.value)
    m = older && older.v === 2 ? older : null
  }
  return { buckets: out, oldest }
}

/** a channel whose backup just finished: its key, its buckets by name and its companies: what the channels after it must hold at least */
interface Donor {
  key: Buffer
  refs: Map<string, BucketRef>
  companies: ManifestV2['companies']
}

/** two `companies` maps as one: the earlier first date, the later «as of», the name either one has */
function unionCompanies(a: ManifestV2['companies'], b: ManifestV2['companies']): ManifestV2['companies'] {
  const out: ManifestV2['companies'] = { ...a }
  for (const [tin, c] of Object.entries(b)) {
    const o = out[tin]
    const name = o?.name || c.name
    out[tin] = { firstAt: o?.firstAt ? Math.min(o.firstAt, c.firstAt || o.firstAt) : c.firstAt, refreshedAt: Math.max(o?.refreshedAt ?? 0, c.refreshedAt), ...(name ? { name } : {}) }
  }
  return out
}

/**
 * MIRROR channels: the backup is kept in the main channel AND in each mirror, every one with its OWN chain (own manifest, own pinned message, own
 * pieces: a file id from one channel means nothing in another, and a banned channel takes its files with it). Each channel is brought up to date
 * in turn; a channel that fails does not stop the others (a banned main channel is exactly when the mirror matters), and the result says which worked.
 */
async function runBackupAll(passphrase: string, token: string, chats: string[]): Promise<void> {
  const outcomes: Array<{ chat: string; ok: boolean; message: string; result: BackupResult | null }> = []
  // the first channel that worked is the DONOR of the ones after it: what it holds and a later channel lacks is copied across (see runBackup)
  let donor: Donor | null = null
  for (const [i, chat] of chats.entries()) {
    set({ phase: 'snapshot', done: 0, total: 0, result: null, finishedAt: 0, message: i === 0 ? 'Nusxa olinmoqda…' : `Zaxira kanal ${i}/${chats.length - 1} yangilanmoqda…` })
    const mine = await runBackup(passphrase, token, chat, donor ?? undefined)
    if (!donor && mine) donor = mine
    const s = state()
    outcomes.push({ chat, ok: s.phase === 'done', message: s.message, result: s.result })
    if (!outcomes[i]!.ok && /Parol/.test(s.message)) break // a wrong passphrase is wrong for every channel's chain
  }
  if (chats.length === 1) return
  const okN = outcomes.filter((o) => o.ok).length
  const copied = (o: { message: string }): string => {
    const n = /(\d+) ta asosiy kanaldan koʻchirildi/.exec(o.message)?.[1]
    return n ? `, ${n} ta boʻlak asosiy kanaldan koʻchirildi` : ''
  }
  const line = outcomes.map((o, i) => `${i === 0 ? 'asosiy' : 'zaxira'} ${o.chat}: ${o.ok ? `tayyor${copied(o)}` : `xato (${o.message})`}`).join(' · ')
  try {
    const last = getDb().prepare('SELECT v FROM meta WHERE k = ?').get('last_backup')
    if (last) getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run('last_backup', JSON.stringify({ ...(JSON.parse(String(last.v)) as object), channels: outcomes.map((o) => ({ chat: o.chat, ok: o.ok })) }))
  } catch {
    /* the summary is a convenience */
  }
  set({
    phase: okN > 0 ? 'done' : 'error',
    result: outcomes.find((o) => o.ok)?.result ?? null,
    finishedAt: Date.now(),
    message: okN === chats.length ? `Tayyor: ${chats.length} ta kanalga zaxira olindi (${line})` : okN > 0 ? `Qisman: ${okN}/${chats.length} kanalga olindi: ${line}` : line,
  })
}

/**
 * Run a read (restore, load) against each channel in turn until one does not fail: the main channel first, then the mirrors. A wrong passphrase stops
 * at once (it is wrong for every channel). A failed attempt is reported in the message of the next one, so it is never silent that a mirror was used.
 */
async function withFallback(chats: string[], op: (chat: string) => Promise<void>): Promise<void> {
  let failed = ''
  for (const [i, chat] of chats.entries()) {
    await op(chat)
    const s = state()
    const last = i === chats.length - 1
    if (s.phase !== 'error' || last || /Parol/.test(s.message)) {
      if (i > 0 && s.phase === 'done') set({ message: `${s.message} (asosiy kanal ishlamadi: ${failed}; zaxira kanal ${chat} ishlatildi)` })
      return
    }
    failed = s.message
    set({ phase: 'download', finishedAt: 0, done: 0, total: 0, message: `Kanal ishlamadi (${s.message}); zaxira kanal sinalmoqda…` })
  }
}

async function runBackup(passphrase: string, token: string, chat: string, donor?: Donor): Promise<Donor | null> {
  const bail = (message: string): null => {
    fail(message)
    return null
  }
  const prev = await pinnedManifest(token, chat, passphrase, 'Parol notoʻgʻri: kanaldagi zaxira boshqa parol bilan yaratilgan (avvalgi parolni kiriting)')
  if (!prev.ok) return bail(prev.error)
  // the SAME key as the chain before (same salt), so earlier pieces still open; a fresh one when there is no chain
  const salt = prev.value?.salt ?? newSalt()
  const key = prev.value?.key ?? deriveKey(passphrase, salt)
  const known = new Map<string, BucketRef>()
  let base = new Map<string, BucketRef>()
  let since = '' // when this channel's chain began: set from the chain that is there, else it is this backup
  if (prev.value?.m.v === 2) {
    for (const b of prev.value.m.buckets) known.set(b.id, b)
    set({ phase: 'snapshot', message: 'Kanaldagi zaxira tarixi oʻqilmoqda…' })
    const chain = await chainBuckets(token, key, prev.value.m)
    base = chain.buckets
    since = prev.value.m.since && prev.value.m.since < chain.oldest ? prev.value.m.since : chain.oldest
    for (const b of base.values()) known.set(b.id, b)
  }

  const snap = snapshotFile()
  let snapDb: ReturnType<typeof openDbFile> | null = null
  try {
    snapDb = openDbFile(snap.file)
    const names = listBuckets(snapDb)
    const total = names.length
    const id = crypto.randomBytes(8).toString('hex')
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const refs: BucketRef[] = []
    let sentBytes = 0
    let sentParts = 0
    let reused = 0
    let plainBytes = 0
    set({ phase: 'upload', done: 0, total, message: `Tekshirilmoqda: 0/${total}` })
    let putFailed = ''
    /** gzip, seal and send one bucket's text in pieces; its reference, or null (the reason is in `putFailed`) */
    const put = async (name: string, text: Buffer, rows: number): Promise<BucketRef | null> => {
      const bid = bucketId(key, text)
      const gz = zlib.gzipSync(text, { level: 6 })
      const size = chunkPlain()
      const count = Math.max(1, Math.ceil(gz.length / size))
      const parts: PartRef[] = []
      for (let i = 0; i < count; i++) {
        const sealed = seal(key, gz.subarray(i * size, (i + 1) * size), bucketAad(bid, i))
        const sent = await sendFile(token, chat, sealed, `sud-${bid.slice(0, 12)}-${i + 1}.bin`, 'Sud tizimi zaxirasi')
        if (!sent.ok) {
          putFailed = sent.error
          return null
        }
        parts.push({ fileId: sent.value.fileId, messageId: sent.value.messageId, size: sealed.length, sha256: sha256(sealed) })
        sentBytes += sealed.length
        sentParts++
        await pause(gapMs())
      }
      return { name, id: bid, rows, bytes: text.length, parts }
    }

    for (let n = 0; n < total; n++) {
      const name = names[n]!
      const r = renderBucket(name, snapDb)
      if (!r) continue
      let text: Buffer = r.text
      let rows = r.rows
      // the channel already holds a DIFFERENT version of this bucket (another computer, an older scrape): the backup is their union
      const held = base.get(name)
      if (held && held.id !== bucketId(key, text)) {
        const theirs = await downloadBucket(token, key, held)
        if (theirs) {
          text = mergeBucketText(name, theirs, text)
          rows = text.toString('utf8').split('\n').filter(Boolean).length
        }
      }
      // the DONOR channel (the first one that worked) holds MORE rows of this bucket than this computer and this channel's own chain: they are merged in
      const dref = donor?.refs.get(name)
      if (donor && dref && dref.rows > rows) {
        const theirs = await downloadBucket(token, donor.key, dref)
        if (theirs) {
          text = mergeBucketText(name, theirs, text)
          rows = text.toString('utf8').split('\n').filter(Boolean).length
        }
      }
      const bid = bucketId(key, text)
      plainBytes += text.length
      const old = known.get(bid)
      // an unchanged bucket is reused when the channel still holds all of its pieces
      if (old && old.name === name) {
        let alive = true
        for (const p of old.parts) if (!(await fileExists(token, p.fileId))) { alive = false; break }
        if (alive) {
          refs.push(old)
          reused++
          set({ done: n + 1, message: `Oʻzgarmagan: ${n + 1}/${total}` })
          continue
        }
      }
      const ref = await put(name, text, rows)
      if (!ref) return bail(`${n + 1}/${total}-boʻlakni yuborib boʻlmadi: ${putFailed}`)
      refs.push(ref)
      set({ done: n + 1, message: `Yuklanmoqda: ${n + 1}/${total}` })
    }

    const have = new Set(refs.map((x) => x.name))
    // CATCH-UP: a bucket the donor channel holds and this channel's chain lacks (or holds with fewer rows) is copied across: downloaded from the donor,
    // merged with this channel's own version, sealed with THIS channel's key and sent. Each channel has its own chain, so a mirror started later would
    // otherwise never get what the main channel got from another computer.
    let caught = 0
    if (donor) {
      for (const [bname, dref] of donor.refs) {
        if (have.has(bname)) continue
        const mine = base.get(bname)
        if (mine && mine.rows >= dref.rows) continue // carried over below
        set({ phase: 'upload', message: `Asosiy kanaldan koʻchirilmoqda: ${caught + 1}…` })
        const theirs = await downloadBucket(token, donor.key, dref)
        if (!theirs) continue // the donor's piece is gone or damaged: nothing to copy, the backup itself goes on
        let text: Buffer = theirs
        if (mine) {
          const own = await downloadBucket(token, key, mine)
          if (own) text = mergeBucketText(bname, theirs, own)
        }
        const ref = await put(bname, text, text.toString('utf8').split('\n').filter(Boolean).length)
        if (!ref) return bail(`${bname} boʻlagini yuborib boʻlmadi: ${putFailed}`)
        refs.push(ref)
        have.add(bname)
        caught++
      }
    }
    // buckets of other companies / years that this computer has nothing for stay in the manifest: a backup never takes data away from the channel
    let carried = 0
    for (const [bname, ref] of base) {
      if (have.has(bname)) continue
      refs.push(ref)
      carried++
    }
    set({ phase: 'manifest', message: 'Manifest yuborilmoqda…' })
    // the companies the channel already knows come first (a backup never takes data away: another computer's company keeps its dates and its name),
    // this computer's own rows are merged over them (first date: the earlier; «as of»: the later; the name this computer's bills give, else the old one)
    let companies: ManifestV2['companies'] = prev.value?.m.v === 2 ? { ...prev.value.m.companies } : {}
    if (donor) companies = unionCompanies(companies, donor.companies)
    for (const c of snapDb.prepare('SELECT tin, first_at, refreshed_at FROM companies').all()) {
      const tin = String(c.tin)
      const old = companies[tin]
      const name = companyNameOf(tin, snapDb) ?? old?.name
      companies[tin] = { firstAt: old?.firstAt ? Math.min(old.firstAt, Number(c.first_at)) : Number(c.first_at), refreshedAt: Math.max(old?.refreshedAt ?? 0, Number(c.refreshed_at)), ...(name ? { name } : {}) }
    }
    // a company whose bills name it but that has no `companies` row here is still named
    for (const tin of Object.keys(companies)) if (!companies[tin]!.name) { const n = companyNameOf(tin, snapDb); if (n) companies[tin] = { ...companies[tin]!, name: n } }
    const created = new Date().toISOString()
    const manifest: ManifestV2 = {
      v: 2, id, created, since: since || created, app: 'sud-tizimi', companies, buckets: refs,
      prev: prev.value ? { messageId: prev.value.pin.messageId, fileId: prev.value.pin.fileId, created: prev.value.m.created } : null,
    }
    const sealedManifest = sealManifest(manifest, salt, key)
    if (sealedManifest.length > CHUNK_PLAIN) return bail('Manifest juda katta (bo‘laklar soni haddan oshdi)')
    const m = await sendFile(token, chat, sealedManifest, `sud-${day}-${id.slice(0, 6)}-manifest.bin`, `Sud tizimi: zaxira manifesti ${created.slice(0, 10)}`)
    if (!m.ok) return bail(`Manifestni yuborib boʻlmadi: ${m.error}`)
    const pin = await pinMessage(token, chat, m.value.messageId)

    const result: BackupResult = { id, created, dbBytes: plainBytes, uploadedBytes: sentBytes + sealedManifest.length, chunks: sentParts, buckets: refs.length, reused }
    saveCatalog(buildCatalog(manifest))
    getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run('last_backup', JSON.stringify({ ...result, pinned: pin.ok, manifestMessageId: m.value.messageId }))
    set({
      phase: 'done',
      result,
      finishedAt: Date.now(),
      message: pin.ok
        ? `Tayyor: ${refs.length - reused - carried - caught} ta yangi/oʻzgargan, ${reused} ta oʻzgarmagan${carried ? `, ${carried} ta kanaldan olingan` : ''}${caught ? `, ${caught} ta asosiy kanaldan koʻchirildi` : ''} boʻlak; manifest mahkamlandi`
        : `Zaxira joylandi, lekin manifestni mahkamlab boʻlmadi (${pin.error}): botga «Pin messages» huquqini bering`,
    })
    return { key, refs: new Map(refs.map((r) => [r.name, r])), companies }
  } finally {
    try {
      snapDb?.close()
    } catch {
      /* closed */
    }
    snap.done()
    rm(`${snap.file}-wal`, `${snap.file}-shm`)
  }
}

/** a restored copy is ONE file: fold the write-ahead log into it before it is handed over */
function sealRestored(db: ReturnType<typeof openDbFile>): void {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.exec('PRAGMA journal_mode = DELETE')
}

async function runRestore(passphrase: string, token: string, chat: string): Promise<void> {
  const prev = await pinnedManifest(token, chat, passphrase, 'Parol notoʻgʻri (yoki manifest shikastlangan)')
  if (!prev.ok) return fail(prev.error)
  if (!prev.value) return fail('Kanalda mahkamlangan manifest yoʻq: zaxira hali olinmagan yoki manifest mahkamlanmagan')
  const { m, key } = prev.value
  const dest = path.join(path.dirname(dbPath()), `sud.restored-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  if (m.v === 1) return restoreV1(m, key, token, dest)

  const buckets = m.buckets.filter((b) => { const k = parseBucket(b.name)?.kind; return k !== 'index' && k !== 'lists' && k !== 'hearings' }) // locators and court lists are for the search and the bot, not for a database
  const total = buckets.length
  set({ phase: 'download', done: 0, total, message: `Yuklab olinmoqda: 0/${total}` })
  let target: ReturnType<typeof openDbFile> | null = null
  let plainBytes = 0
  try {
    target = openDbFile(dest)
    for (let n = 0; n < total; n++) {
      const b = buckets[n]!
      const gzParts: Buffer[] = []
      for (let i = 0; i < b.parts.length; i++) {
        const p = b.parts[i]!
        const f = await getFileBytes(token, p.fileId)
        if (!f.ok) return failRestore(dest, target, `${n + 1}/${total}-boʻlakni olib boʻlmadi: ${f.error}`)
        if (f.value.length !== p.size || sha256(f.value) !== p.sha256) return failRestore(dest, target, `${n + 1}/${total}-boʻlak shikastlangan (hash mos kelmadi)`)
        try {
          gzParts.push(open(key, f.value, bucketAad(b.id, i)))
        } catch {
          return failRestore(dest, target, `${n + 1}/${total}-boʻlakni ochib boʻlmadi`)
        }
      }
      const text = zlib.gunzipSync(Buffer.concat(gzParts))
      if (bucketId(key, text) !== b.id) return failRestore(dest, target, `${n + 1}/${total}-boʻlak mazmuni id ga mos kelmadi`)
      importBucket(b.name, text, target)
      plainBytes += text.length
      set({ done: n + 1, message: `Yuklab olinmoqda: ${n + 1}/${total}` })
    }
    set({ phase: 'unpack', message: 'Tekshirilmoqda…' })
    // the dates the manifest carries survive even for a company whose state bucket was never written
    for (const [tin, c] of Object.entries(m.companies ?? {})) {
      target.prepare('INSERT INTO companies (tin, first_at, refreshed_at) VALUES (?, ?, ?) ON CONFLICT(tin) DO UPDATE SET first_at = MIN(first_at, excluded.first_at), refreshed_at = MAX(refreshed_at, excluded.refreshed_at)').run(tin, c.firstAt, c.refreshedAt)
    }
    const check = String((target.prepare('PRAGMA quick_check(1)').get() ?? {}).quick_check ?? '')
    if (check !== 'ok') return failRestore(dest, target, `Tiklangan baza tekshiruvdan oʻtmadi: ${check}`)
    sealRestored(target)
    target.close()
    target = null
    set({
      phase: 'done',
      finishedAt: Date.now(),
      result: { id: m.id, created: m.created, dbBytes: plainBytes, uploadedBytes: 0, chunks: 0, buckets: total, reused: 0, restoredFile: dest },
      message: 'Tayyor: baza tiklandi va tekshirildi. Almashtirish uchun ilovani yoping va faylni sud.db oʻrniga qoʻying',
    })
  } finally {
    try {
      target?.close()
    } catch {
      /* closed */
    }
    rm(`${dest}-wal`, `${dest}-shm`)
  }
}

function failRestore(dest: string, target: ReturnType<typeof openDbFile>, message: string): void {
  try {
    target.close()
  } catch {
    /* closed */
  }
  rm(dest, `${dest}-wal`, `${dest}-shm`)
  fail(message)
}

/** the first format: one gzip of the whole database cut into sealed pieces */
async function restoreV1(m: Manifest, key: Buffer, token: string, dest: string): Promise<void> {
  const total = m.chunks.length
  set({ phase: 'download', done: 0, total, message: `Yuklab olinmoqda: 0/${total}` })
  const gz = tmp('.gz')
  try {
    const out = fs.openSync(gz, 'w')
    try {
      for (const c of m.chunks) {
        const f = await getFileBytes(token, c.fileId)
        if (!f.ok) return fail(`${c.i + 1}-boʻlakni olib boʻlmadi: ${f.error}`)
        if (f.value.length !== c.size || sha256(f.value) !== c.sha256) return fail(`${c.i + 1}-boʻlak shikastlangan (hash mos kelmadi)`)
        let plain: Buffer
        try {
          plain = open(key, f.value, chunkAad(m.id, c.i))
        } catch {
          return fail(`${c.i + 1}-boʻlakni ochib boʻlmadi`)
        }
        fs.writeSync(out, plain)
        set({ done: c.i + 1, message: `Yuklab olinmoqda: ${c.i + 1}/${total}` })
      }
    } finally {
      fs.closeSync(out)
    }
    set({ phase: 'unpack', message: 'Ochilmoqda…' })
    await pipeline(fs.createReadStream(gz), zlib.createGunzip(), fs.createWriteStream(dest, { mode: 0o600 }))
    if (fs.statSync(dest).size !== m.dbBytes || (await sha256File(dest)) !== m.dbSha256) {
      rm(dest)
      return fail('Tiklangan fayl asl nusxaga mos kelmadi (hash)')
    }
    set({
      phase: 'done',
      finishedAt: Date.now(),
      result: { id: m.id, created: m.created, dbBytes: m.dbBytes, uploadedBytes: 0, chunks: total, buckets: 0, reused: 0, restoredFile: dest },
      message: 'Tayyor: baza tiklandi va tekshirildi. Almashtirish uchun ilovani yoping va faylni sud.db oʻrniga qoʻying',
    })
  } finally {
    rm(gz)
  }
}

/** the companies the channel holds (needs the passphrase: the manifest is sealed); saved locally so the app can offer them before it scrapes */
export interface ChannelReport {
  chat: string
  role: 'asosiy' | 'zaxira'
  ok: boolean
  error?: string
  /** the pinned manifest: its message, when it was made, when this channel's chain began */
  messageId?: number
  created?: string
  since?: string
  buckets?: number
  parts?: number
  /** pieces the manifest lists that the channel no longer has */
  partsMissing?: number
  companies?: number
  /** buckets the first working channel holds and this one lacks (the next backup copies them) */
  lacking?: number
}

/**
 * What each channel really holds, read from Telegram (nothing is changed): the pinned manifest, when this channel's chain began, whether every piece it
 * lists still exists, and what it lacks compared with the first working channel. A wrong passphrase stops at once (it is wrong for every chain).
 */
export async function inspectChannels(passphrase: string): Promise<{ ok: true; channels: ChannelReport[] } | { ok: false; error: string }> {
  const pre = precheck(passphrase)
  if (!('token' in pre)) return pre.ok ? { ok: false, error: 'xato' } : pre
  const out: ChannelReport[] = []
  let donorNames: Set<string> | null = null
  for (const [i, chat] of pre.chats.entries()) {
    const rep: ChannelReport = { chat, role: i === 0 ? 'asosiy' : 'zaxira', ok: false }
    out.push(rep)
    const r = await pinnedManifest(pre.token, chat, passphrase, 'Parol notoʻgʻri: bu kanaldagi zaxira boshqa parol bilan yaratilgan')
    if (!r.ok) {
      rep.error = r.error
      if (/Parol/.test(r.error) && i === 0) return { ok: false, error: r.error }
      continue
    }
    if (!r.value) {
      rep.error = 'Mahkamlangan zaxira yoʻq (kanal hali toʻldirilmagan: «Zaxiralash» bosing)'
      continue
    }
    const m = r.value.m
    rep.messageId = r.value.pin.messageId
    rep.created = m.created
    if (m.v !== 2) {
      rep.ok = true
      rep.error = 'Eski formatdagi zaxira'
      continue
    }
    rep.since = m.since
    rep.buckets = m.buckets.length
    rep.companies = Object.keys(m.companies).length
    const ids = m.buckets.flatMap((b) => b.parts.map((p) => p.fileId))
    rep.parts = ids.length
    let missing = 0
    let next = 0
    const worker = async () => {
      for (;;) {
        const k = next++
        if (k >= ids.length) return
        if (!(await fileExists(pre.token, ids[k]!))) missing++
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
    rep.partsMissing = missing
    const names = new Set(m.buckets.map((b) => b.name))
    if (donorNames) rep.lacking = [...donorNames].filter((n) => !names.has(n)).length
    else donorNames = names
    rep.ok = true
  }
  return { ok: true, channels: out }
}

export async function readRemoteCatalog(passphrase: string): Promise<{ ok: true; catalog: Catalog; index: SyncResult | null; indexError?: string } | { ok: false; error: string }> {
  const pre = precheck(passphrase)
  if (!('token' in pre)) return pre.ok ? { ok: false, error: 'xato' } : pre
  // the main channel first; when it has no readable pinned manifest (banned, message deleted) the mirrors in order; a wrong passphrase stops at once
  let prev: Awaited<ReturnType<typeof pinnedManifest>> = { ok: true, value: null }
  const why: string[] = []
  for (const chat of pre.chats) {
    prev = await pinnedManifest(pre.token, chat, passphrase, 'Parol notoʻgʻri (yoki manifest shikastlangan)')
    if (prev.ok && prev.value) break
    if (!prev.ok && /Parol/.test(prev.error)) return prev
    why.push(`${chat}: ${prev.ok ? 'mahkamlangan zaxira yoʻq' : prev.error}`)
  }
  if (!prev.ok) return { ok: false, error: why.join(' · ') }
  if (!prev.value) return { ok: false, error: `Kanalda mahkamlangan zaxira yoʻq${why.length > 1 ? ` (${why.join(' · ')})` : ''}` }
  if (prev.value.m.v !== 2) return { ok: false, error: 'Kanaldagi zaxira eski formatda: kompaniyalarni tanlab boʻlmaydi (yangi zaxira oling)' }
  const catalog = buildCatalog(prev.value.m)
  saveCatalog(catalog)
  // the locator (where each case and bill sits) comes along: only the index buckets that changed are downloaded
  const idx = await syncIndex(pre.token, prev.value.m, prev.value.key)
  return idx.ok ? { ok: true, catalog, index: idx.value } : { ok: true, catalog, index: null, indexError: idx.error }
}

/**
 * Is this the passphrase of the chain in the channel? The main channel first, then the mirrors; ok also when NO manifest is pinned anywhere yet (the
 * first backup starts the chain with it). A wrong passphrase, or a channel nobody could read, is an error: an automatic backup must not start on a guess.
 */
export async function verifyPassphrase(passphrase: string): Promise<{ ok: true; fresh: boolean } | { ok: false; error: string }> {
  const pre = precheck(passphrase)
  if (!('token' in pre)) return pre.ok ? { ok: false, error: 'xato' } : pre
  const why: string[] = []
  for (const chat of pre.chats) {
    const r = await pinnedManifest(pre.token, chat, passphrase, 'Parol notoʻgʻri (kanaldagi zaxira bu parol bilan ochilmadi)')
    if (r.ok && r.value) return { ok: true, fresh: false }
    if (!r.ok && /Parol/.test(r.error)) return { ok: false, error: r.error }
    why.push(r.ok ? '' : `${chat}: ${r.error}`)
  }
  const real = why.filter(Boolean)
  return real.length ? { ok: false, error: `Kanalni oʻqib boʻlmadi: ${real.join(' · ')}` } : { ok: true, fresh: true }
}

const TIN_RE = /^\d{9}$/

export function startLoad(passphrase: string, tins: unknown): StartResult {
  const pre = precheck(passphrase)
  if (!('token' in pre)) return pre
  const list = Array.isArray(tins) ? [...new Set(tins.filter((t): t is string => typeof t === 'string' && TIN_RE.test(t)))] : []
  if (!list.length || list.length > 50) return { ok: false, error: 'Kamida bitta (koʻpi bilan 50 ta) kompaniyani tanlang' }
  if (billJobRunning()) return { ok: false, error: 'Toʻlovlarni oʻqish jarayoni ketmoqda: avval uni toʻxtating' }
  g.__sudBackup = { ...fresh(), kind: 'load', phase: 'download', message: 'Manifest qidirilmoqda…', startedAt: Date.now() }
  void withFallback(pre.chats, (c) => runLoad(passphrase, pre.token, c, list)).catch((e) => unexpected('yuklash', e))
  return { ok: true }
}

/**
 * Bring the chosen companies from the channel into the LIVE database, without a file swap: their buckets (bills, found cases, tried numbers, state)
 * and the case-detail buckets of the court/year pairs their found cases fall in. Rows already in the database are kept when they are newer (cases by
 * the time they were fetched); the bills of a company the database holds a newer copy of are only added to, never overwritten.
 */
async function runLoad(passphrase: string, token: string, chat: string, tins: string[]): Promise<void> {
  const prev = await pinnedManifest(token, chat, passphrase, 'Parol notoʻgʻri (yoki manifest shikastlangan)')
  if (!prev.ok) return fail(prev.error)
  if (!prev.value) return fail('Kanalda mahkamlangan zaxira yoʻq')
  const { m, key } = prev.value
  if (m.v !== 2) return fail('Kanaldagi zaxira eski formatda: kompaniyalarni tanlab boʻlmaydi (yangi zaxira oling)')
  const want = new Set(tins)
  const picked: BucketRef[] = []
  const detailKeys = new Set<string>()
  for (const b of m.buckets) {
    const p = parseBucket(b.name)
    if (p?.tin && p.kind !== 'index' && p.kind !== 'hearings' && want.has(p.tin)) {
      picked.push(b)
      if (p.kind === 'found') detailKeys.add(`${p.court}:${p.year}`)
    }
  }
  for (const b of m.buckets) {
    const p = parseBucket(b.name)
    if (p?.kind === 'details' && detailKeys.has(`${p.court}:${p.year}`)) picked.push(b)
  }
  const present = new Set(picked.map((b) => parseBucket(b.name)?.tin).filter(Boolean))
  const missing = tins.filter((t) => !present.has(t))
  if (!picked.length) return fail('Tanlangan kompaniyalar kanaldagi zaxirada topilmadi')

  const total = picked.length
  set({ phase: 'download', done: 0, total, message: `Yuklab olinmoqda: 0/${total}` })
  const db = getDb()
  let rows = 0
  for (let n = 0; n < total; n++) {
    const b = picked[n]!
    const p = parseBucket(b.name)!
    const gzParts: Buffer[] = []
    for (let i = 0; i < b.parts.length; i++) {
      const part = b.parts[i]!
      const f = await getFileBytes(token, part.fileId)
      if (!f.ok) return fail(`${n + 1}/${total}-boʻlakni olib boʻlmadi: ${f.error}`)
      if (f.value.length !== part.size || sha256(f.value) !== part.sha256) return fail(`${n + 1}/${total}-boʻlak shikastlangan (hash mos kelmadi)`)
      try {
        gzParts.push(open(key, f.value, bucketAad(b.id, i)))
      } catch {
        return fail(`${n + 1}/${total}-boʻlakni ochib boʻlmadi`)
      }
    }
    const text = zlib.gunzipSync(Buffer.concat(gzParts))
    if (bucketId(key, text) !== b.id) return fail(`${n + 1}/${total}-boʻlak mazmuni id ga mos kelmadi`)
    // the database's own copy of this company is NEWER than the backup: its bills are only added to
    const live = p.tin ? (readCompany(p.tin)?.refreshedAt ?? 0) : 0
    const theirs = p.tin ? (m.companies[p.tin]?.refreshedAt ?? 0) : 0
    rows += importBucket(b.name, text, db, { bills: live > theirs ? 'keep' : 'replace' })
    set({ done: n + 1, message: `Yuklab olinmoqda: ${n + 1}/${total}` })
  }
  for (const t of tins) {
    forgetBillsSummary(t)
    retireCaseSnapshots(t) // the day-old stats and court lists would still show the count from before the load
  }
  const loaded = tins.filter((t) => present.has(t))
  set({
    phase: 'done',
    finishedAt: Date.now(),
    result: { id: m.id, created: m.created, dbBytes: 0, uploadedBytes: 0, chunks: 0, buckets: total, reused: 0, loadedTins: loaded },
    message: `Tayyor: ${loaded.length} ta kompaniya Telegramdan yuklandi (${rows} qator)${missing.length ? `; zaxirada yoʻq: ${missing.join(', ')}` : ''}`,
  })
}

export function lastBackup(): { channels?: Array<{ chat: string; ok: boolean }>; created: string; chunks: number; buckets?: number; reused?: number; dbBytes: number; uploadedBytes: number; pinned: boolean } | null {
  try {
    const r = getDb().prepare("SELECT v FROM meta WHERE k = 'last_backup'").get()
    return r ? JSON.parse(String(r.v)) : null
  } catch {
    return null
  }
}
