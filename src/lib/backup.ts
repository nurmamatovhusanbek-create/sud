import 'server-only'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import {
  CHUNK_PLAIN, MIN_PASSPHRASE, bucketAad, bucketId, chunkAad, chunkPlain, deriveKey, newSalt, open, openManifest, seal, sealManifest, sha256,
  type AnyManifest, type BucketRef, type Manifest, type ManifestV2, type PartRef,
} from './backup-crypto'
import { importBucket, listBuckets, renderBucket } from './db-buckets'
import { dbPath, getDb, openDbFile } from './db'
import { snapshotFile } from './db-admin'
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
  kind: 'backup' | 'restore' | null
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

function precheck(passphrase: string): StartResult | { ok: true; token: string; chat: string } {
  if (backupBusy()) return { ok: false, error: 'Zaxira jarayoni allaqachon ketmoqda' }
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) return { ok: false, error: `Parol kamida ${MIN_PASSPHRASE} belgi boʻlishi kerak` }
  const tg = readTelegram()
  if (!tg) return { ok: false, error: 'Avval Telegram botini saqlang (Sozlamalar › Telegram)' }
  return { ok: true, token: tg.token, chat: tg.chat }
}

export function startBackup(passphrase: string): StartResult {
  const pre = precheck(passphrase)
  if (!('token' in pre)) return pre
  g.__sudBackup = { ...fresh(), kind: 'backup', phase: 'snapshot', message: 'Nusxa olinmoqda…', startedAt: Date.now() }
  void runBackup(passphrase, pre.token, pre.chat).catch((e) => unexpected('zaxira', e))
  return { ok: true }
}

export function startRestore(passphrase: string): StartResult {
  const pre = precheck(passphrase)
  if (!('token' in pre)) return pre
  g.__sudBackup = { ...fresh(), kind: 'restore', phase: 'download', message: 'Manifest qidirilmoqda…', startedAt: Date.now() }
  void runRestore(passphrase, pre.token, pre.chat).catch((e) => unexpected('tiklash', e))
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

async function runBackup(passphrase: string, token: string, chat: string): Promise<void> {
  const prev = await pinnedManifest(token, chat, passphrase, 'Parol notoʻgʻri: kanaldagi zaxira boshqa parol bilan yaratilgan (avvalgi parolni kiriting)')
  if (!prev.ok) return fail(prev.error)
  // the SAME key as the chain before (same salt), so earlier pieces still open; a fresh one when there is no chain
  const salt = prev.value?.salt ?? newSalt()
  const key = prev.value?.key ?? deriveKey(passphrase, salt)
  const known = new Map<string, BucketRef>()
  if (prev.value?.m.v === 2) for (const b of prev.value.m.buckets) known.set(b.id, b)

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

    for (let n = 0; n < total; n++) {
      const name = names[n]!
      const r = renderBucket(name, snapDb)
      if (!r) continue
      const bid = bucketId(key, r.text)
      plainBytes += r.text.length
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
      const gz = zlib.gzipSync(r.text, { level: 6 })
      const size = chunkPlain()
      const count = Math.max(1, Math.ceil(gz.length / size))
      const parts: PartRef[] = []
      for (let i = 0; i < count; i++) {
        const sealed = seal(key, gz.subarray(i * size, (i + 1) * size), bucketAad(bid, i))
        const sent = await sendFile(token, chat, sealed, `sud-${bid.slice(0, 12)}-${i + 1}.bin`, 'Sud tizimi zaxirasi')
        if (!sent.ok) return fail(`${n + 1}/${total}-boʻlakni yuborib boʻlmadi: ${sent.error}`)
        parts.push({ fileId: sent.value.fileId, messageId: sent.value.messageId, size: sealed.length, sha256: sha256(sealed) })
        sentBytes += sealed.length
        sentParts++
        await pause(gapMs())
      }
      refs.push({ name, id: bid, rows: r.rows, bytes: r.text.length, parts })
      set({ done: n + 1, message: `Yuklanmoqda: ${n + 1}/${total}` })
    }

    set({ phase: 'manifest', message: 'Manifest yuborilmoqda…' })
    const companies: ManifestV2['companies'] = {}
    for (const c of snapDb.prepare('SELECT tin, first_at, refreshed_at FROM companies').all()) companies[String(c.tin)] = { firstAt: Number(c.first_at), refreshedAt: Number(c.refreshed_at) }
    const created = new Date().toISOString()
    const manifest: ManifestV2 = {
      v: 2, id, created, app: 'sud-tizimi', companies, buckets: refs,
      prev: prev.value ? { messageId: prev.value.pin.messageId, fileId: prev.value.pin.fileId, created: prev.value.m.created } : null,
    }
    const sealedManifest = sealManifest(manifest, salt, key)
    if (sealedManifest.length > CHUNK_PLAIN) return fail('Manifest juda katta (bo‘laklar soni haddan oshdi)')
    const m = await sendFile(token, chat, sealedManifest, `sud-${day}-${id.slice(0, 6)}-manifest.bin`, `Sud tizimi: zaxira manifesti ${created.slice(0, 10)}`)
    if (!m.ok) return fail(`Manifestni yuborib boʻlmadi: ${m.error}`)
    const pin = await pinMessage(token, chat, m.value.messageId)

    const result: BackupResult = { id, created, dbBytes: plainBytes, uploadedBytes: sentBytes + sealedManifest.length, chunks: sentParts, buckets: refs.length, reused }
    getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run('last_backup', JSON.stringify({ ...result, pinned: pin.ok, manifestMessageId: m.value.messageId }))
    set({
      phase: 'done',
      result,
      finishedAt: Date.now(),
      message: pin.ok
        ? `Tayyor: ${refs.length - reused} ta yangi/oʻzgargan, ${reused} ta oʻzgarmagan boʻlak; manifest mahkamlandi`
        : `Zaxira joylandi, lekin manifestni mahkamlab boʻlmadi (${pin.error}): botga «Pin messages» huquqini bering`,
    })
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

  const total = m.buckets.length
  set({ phase: 'download', done: 0, total, message: `Yuklab olinmoqda: 0/${total}` })
  let target: ReturnType<typeof openDbFile> | null = null
  let plainBytes = 0
  try {
    target = openDbFile(dest)
    for (let n = 0; n < total; n++) {
      const b = m.buckets[n]!
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

export function lastBackup(): { created: string; chunks: number; buckets?: number; reused?: number; dbBytes: number; uploadedBytes: number; pinned: boolean } | null {
  try {
    const r = getDb().prepare("SELECT v FROM meta WHERE k = 'last_backup'").get()
    return r ? JSON.parse(String(r.v)) : null
  } catch {
    return null
  }
}
