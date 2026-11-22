import 'server-only'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { MIN_PASSPHRASE, chunkPlain, chunkAad, deriveKey, newSalt, open, openManifest, seal, sealManifest, sha256, type ChunkRef, type Manifest } from './backup-crypto'
import { dbPath, getDb } from './db'
import { snapshotFile } from './db-admin'
import { getFileBytes, pinMessage, pinnedDocument, sendFile } from './telegram-client'
import { readTelegram } from './telegram-config'

/**
 * Encrypted copy of the database in the operator's Telegram channel, and the way back.
 *
 * BACKUP: a consistent snapshot (VACUUM INTO a temp file) → gzip → cut into pieces of 19 MiB → each piece sealed (AES-256-GCM, key from the
 * passphrase) → sent as a file → a sealed MANIFEST (the list of pieces, sizes, hashes, the database's own hash) is sent last and PINNED, so a new
 * machine needs only the bot token, the channel and the passphrase. The passphrase is never stored: it is asked for every time.
 * RESTORE: pinned manifest → pieces (checked against their hashes, opened) → gunzip → a file `sud.restored-<time>.db` NEXT TO the live database,
 * checked against the manifest's hash. The live database is never touched: the operator closes the app and swaps the file (or keeps both).
 *
 * One job at a time, in this process, polled by the page. Nothing starts by itself.
 */

export type BackupPhase = 'idle' | 'snapshot' | 'compress' | 'upload' | 'manifest' | 'download' | 'unpack' | 'done' | 'error'

export interface BackupState {
  kind: 'backup' | 'restore' | null
  phase: BackupPhase
  /** pieces done / total in the upload or download phase */
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
  dbBytes: number
  uploadedBytes: number
  chunks: number
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
  void runBackup(passphrase, pre.token, pre.chat).catch(() => fail('Kutilmagan xato: zaxira toʻxtadi'))
  return { ok: true }
}

export function startRestore(passphrase: string): StartResult {
  const pre = precheck(passphrase)
  if (!('token' in pre)) return pre
  g.__sudBackup = { ...fresh(), kind: 'restore', phase: 'download', message: 'Manifest qidirilmoqda…', startedAt: Date.now() }
  void runRestore(passphrase, pre.token, pre.chat).catch(() => fail('Kutilmagan xato: tiklash toʻxtadi'))
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

async function sha256File(file: string): Promise<string> {
  const h = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), h)
  return h.digest('hex')
}

async function runBackup(passphrase: string, token: string, chat: string): Promise<void> {
  const snap = snapshotFile()
  const gz = tmp('.gz')
  try {
    const dbBytes = fs.statSync(snap.file).size
    const dbSha256 = await sha256File(snap.file)
    set({ phase: 'compress', message: 'Siqilmoqda…' })
    await pipeline(fs.createReadStream(snap.file), zlib.createGzip({ level: 6 }), fs.createWriteStream(gz))
    snap.done()
    const gzBytes = fs.statSync(gz).size
    const size = chunkPlain()
    const total = Math.max(1, Math.ceil(gzBytes / size))

    const salt = newSalt()
    const key = deriveKey(passphrase, salt)
    const id = crypto.randomBytes(8).toString('hex')
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const chunks: ChunkRef[] = []
    set({ phase: 'upload', done: 0, total, message: `Yuklanmoqda: 0/${total}` })

    const fd = fs.openSync(gz, 'r')
    try {
      const buf = Buffer.alloc(size)
      for (let i = 0; i < total; i++) {
        const n = fs.readSync(fd, buf, 0, size, i * size)
        const sealed = seal(key, buf.subarray(0, n), chunkAad(id, i))
        const sent = await sendFile(token, chat, sealed, `sud-${day}-${id.slice(0, 6)}-${String(i + 1).padStart(3, '0')}.bin`, `Sud tizimi zaxirasi ${i + 1}/${total}`)
        if (!sent.ok) return fail(`${i + 1}-boʻlakni yuborib boʻlmadi: ${sent.error}`)
        chunks.push({ i, fileId: sent.value.fileId, messageId: sent.value.messageId, size: sealed.length, sha256: sha256(sealed) })
        set({ done: i + 1, message: `Yuklanmoqda: ${i + 1}/${total}` })
      }
    } finally {
      fs.closeSync(fd)
    }

    set({ phase: 'manifest', message: 'Manifest yuborilmoqda…' })
    const created = new Date().toISOString()
    const manifest: Manifest = { v: 1, id, created, app: 'sud-tizimi', dbBytes, dbSha256, gzBytes, chunks }
    const sealedManifest = sealManifest(manifest, salt, key)
    const m = await sendFile(token, chat, sealedManifest, `sud-${day}-${id.slice(0, 6)}-manifest.bin`, `Sud tizimi: zaxira manifesti ${created.slice(0, 10)}`)
    if (!m.ok) return fail(`Manifestni yuborib boʻlmadi: ${m.error}`)
    const pin = await pinMessage(token, chat, m.value.messageId)

    const result: BackupResult = { id, created, dbBytes, uploadedBytes: chunks.reduce((a, c) => a + c.size, 0) + sealedManifest.length, chunks: total }
    getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run('last_backup', JSON.stringify({ ...result, pinned: pin.ok, manifestMessageId: m.value.messageId }))
    set({
      phase: 'done',
      result,
      finishedAt: Date.now(),
      message: pin.ok ? 'Tayyor: zaxira kanalga joylandi va manifest mahkamlandi' : `Zaxira joylandi, lekin manifestni mahkamlab boʻlmadi (${pin.error}): botga «Pin messages» huquqini bering`,
    })
  } finally {
    snap.done()
    rm(gz)
  }
}

async function runRestore(passphrase: string, token: string, chat: string): Promise<void> {
  const pinned = await pinnedDocument(token, chat)
  if (!pinned.ok) return fail(pinned.error)
  if (!pinned.value) return fail('Kanalda mahkamlangan manifest yoʻq: zaxira hali olinmagan yoki manifest mahkamlanmagan')
  const mf = await getFileBytes(token, pinned.value.fileId)
  if (!mf.ok) return fail(`Manifestni olib boʻlmadi: ${mf.error}`)
  const opened = openManifest(passphrase, mf.value)
  if (!opened.ok) return fail(opened.error === 'wrong_passphrase' ? 'Parol notoʻgʻri (yoki manifest shikastlangan)' : 'Mahkamlangan fayl Sud tizimi zaxirasi emas')
  const { manifest, key } = opened
  const total = manifest.chunks.length
  set({ phase: 'download', done: 0, total, message: `Yuklab olinmoqda: 0/${total}` })

  const gz = tmp('.gz')
  const dest = path.join(path.dirname(dbPath()), `sud.restored-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  try {
    const out = fs.openSync(gz, 'w')
    try {
      for (const c of manifest.chunks) {
        const f = await getFileBytes(token, c.fileId)
        if (!f.ok) return fail(`${c.i + 1}-boʻlakni olib boʻlmadi: ${f.error}`)
        if (f.value.length !== c.size || sha256(f.value) !== c.sha256) return fail(`${c.i + 1}-boʻlak shikastlangan (hash mos kelmadi)`)
        let plain: Buffer
        try {
          plain = open(key, f.value, chunkAad(manifest.id, c.i))
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
    if (fs.statSync(dest).size !== manifest.dbBytes || (await sha256File(dest)) !== manifest.dbSha256) {
      rm(dest)
      return fail('Tiklangan fayl asl nusxaga mos kelmadi (hash)')
    }
    set({
      phase: 'done',
      finishedAt: Date.now(),
      result: { id: manifest.id, created: manifest.created, dbBytes: manifest.dbBytes, uploadedBytes: 0, chunks: total, restoredFile: dest },
      message: 'Tayyor: baza tiklandi va tekshirildi. Almashtirish uchun ilovani yoping va faylni sud.db oʻrniga qoʻying',
    })
  } finally {
    rm(gz)
  }
}

export function lastBackup(): { created: string; chunks: number; dbBytes: number; uploadedBytes: number; pinned: boolean } | null {
  try {
    const r = getDb().prepare("SELECT v FROM meta WHERE k = 'last_backup'").get()
    return r ? JSON.parse(String(r.v)) : null
  } catch {
    return null
  }
}
