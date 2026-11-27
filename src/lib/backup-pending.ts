import 'server-only'
import crypto from 'node:crypto'
import { getDb } from './db'
import { listBuckets, parseBucket, renderBucket } from './db-buckets'
import { orderBuckets, type ExtraBucket } from './orders-buckets'
import { readTelegram } from './telegram-config'

/**
 * «Yuklanmaganini koʻrsatish»: what this computer holds that a channel does NOT hold yet, bucket by bucket, in words. Every successful backup of a channel records,
 * locally, a keyless hash and the row count of what this computer held for each bucket (`meta` › `backup_snap:<chat>`; never sent anywhere: it says nothing the
 * database does not). The comparison renders the buckets now and sets them against that record, per channel (the main one and every mirror have their own).
 * Needs no passphrase and asks Telegram nothing, so it is the quick answer to «is everything uploaded?».
 */

export const localHash = (b: Uint8Array): string => crypto.createHash('sha256').update(b).digest('hex').slice(0, 20)

export type BucketSnapshot = Record<string, [string, number]>

export function saveBackupSnapshot(chat: string, at: string, snapshot: BucketSnapshot): void {
  try {
    getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(`backup_snap:${chat}`, JSON.stringify({ at, b: snapshot }))
  } catch {
    /* the comparison is a convenience; the backup itself succeeded */
  }
}

function readSnapshot(chat: string): { at: string; b: BucketSnapshot } | null {
  try {
    const r = getDb().prepare('SELECT v FROM meta WHERE k = ?').get(`backup_snap:${chat}`)
    const j = r ? (JSON.parse(String(r.v)) as { at?: string; b?: BucketSnapshot }) : null
    return j && j.b && typeof j.b === 'object' ? { at: String(j.at ?? ''), b: j.b } : null
  } catch {
    return null
  }
}

/** a bucket in words: «207275139 · toʻlovlar 2026», «qarorlar 2025» */
export function bucketLabel(name: string): string {
  const b = parseBucket(name)
  if (!b) return name
  const yr = (y: number | null): string => (y ? String(y) : 'sanasiz')
  switch (b.kind) {
    case 'bills': return `${b.tin} · toʻlovlar ${yr(b.year)}`
    case 'found': return `${b.tin} · raqam boʻyicha topilgan ishlar (${b.court} ${yr(b.year)})`
    case 'details': return `ish tafsilotlari (${b.court} ${yr(b.year)})`
    case 'tried': return `${b.tin} · tekshirilgan ish raqamlari`
    case 'state': return `${b.tin} · kompaniya holati`
    case 'lists': return `${b.tin} · sud roʻyxati`
    case 'hearings': return `${b.tin} · yaqin majlislar`
    case 'index': return `${b.tin} · qidiruv indeksi`
    case 'orders': return `qarorlar yozuvlari 20${String(b.year ?? '').padStart(2, '0')}`
    case 'pdf': return 'qaror fayli (PDF)'
    default: return name
  }
}

export interface PendingItem {
  name: string
  label: string
  rows: number
  /** rows the channel's last backup had (changed buckets only) */
  was?: number
}

export interface PendingChannel {
  chat: string
  role: 'asosiy' | 'zaxira'
  /** false: no record of an earlier backup of this channel here (never backed up, or backed up before this screen existed): nothing to compare */
  known: boolean
  lastAt: string
  fresh: PendingItem[]
  changed: PendingItem[]
  freshCount: number
  changedCount: number
  unchanged: number
  /** how many of the new ones are order PDFs (listed as a count, they are too many to name) */
  freshPdfs: number
}

export type PendingReport = { configured: false } | { configured: true; total: number; channels: PendingChannel[] }

const SHOWN = 60

export async function pendingBackup(): Promise<PendingReport> {
  const tg = readTelegram()
  if (!tg) return { configured: false }
  const db = getDb()
  let extras = new Map<string, ExtraBucket>()
  try {
    extras = await orderBuckets()
  } catch {
    /* no orders folder: the database alone */
  }
  // what is held now: name → [hash, rows] (a PDF: its name alone)
  const now = new Map<string, [string, number]>()
  for (const name of listBuckets(db)) {
    const r = renderBucket(name, db)
    if (r) now.set(name, [localHash(r.text), r.rows])
  }
  for (const [name, ex] of extras) {
    if (name.startsWith('pdf:')) now.set(name, ['', 1])
    else {
      const t = await ex.render()
      if (t) now.set(name, [localHash(t), ex.rows])
    }
  }
  const channels: PendingChannel[] = [tg.chat, ...tg.mirrors].map((chat, i) => {
    const out: PendingChannel = { chat, role: i === 0 ? 'asosiy' : 'zaxira', known: false, lastAt: '', fresh: [], changed: [], freshCount: 0, changedCount: 0, unchanged: 0, freshPdfs: 0 }
    const snap = readSnapshot(chat)
    if (!snap) return out
    out.known = true
    out.lastAt = snap.at
    for (const [name, [h, rows]] of now) {
      const old = snap.b[name]
      if (!old) {
        out.freshCount++
        if (name.startsWith('pdf:')) out.freshPdfs++
        else if (out.fresh.length < SHOWN) out.fresh.push({ name, label: bucketLabel(name), rows })
      } else if (!name.startsWith('pdf:') && old[0] !== h) {
        out.changedCount++
        if (out.changed.length < SHOWN) out.changed.push({ name, label: bucketLabel(name), rows, was: old[1] })
      } else out.unchanged++
    }
    return out
  })
  return { configured: true, total: now.size, channels }
}


// ---- which pieces were last seen in a channel (so a backup does not ask Telegram about every one of them every time) ----------------------------------

const verifiedKey = (chat: string): string => `backup_seen:${chat}`

/** file id → when this computer last got proof the channel holds it (it just sent it, or `getFile` answered) */
export function readVerified(chat: string): Map<string, number> {
  try {
    const r = getDb().prepare('SELECT v FROM meta WHERE k = ?').get(verifiedKey(chat))
    const j = r ? (JSON.parse(String(r.v)) as Record<string, number>) : {}
    return new Map(Object.entries(j).filter(([, t]) => typeof t === 'number'))
  } catch {
    return new Map()
  }
}

/** kept: only the pieces the newest manifest still names (the record never outgrows the backup) */
export function saveVerified(chat: string, seen: Map<string, number>, keep: Set<string>): void {
  try {
    const out: Record<string, number> = {}
    for (const [id, t] of seen) if (keep.has(id)) out[id] = t
    getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(verifiedKey(chat), JSON.stringify(out))
  } catch {
    /* a convenience: the next backup just checks more */
  }
}
