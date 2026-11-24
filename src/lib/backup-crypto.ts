import crypto from 'node:crypto'

/**
 * The cryptography of a Telegram backup, nothing else (no network, no files): AES-256-GCM with a key from the operator's passphrase (scrypt).
 * Every piece (chunk) is sealed on its own with a fresh random IV and tied to its place by the authenticated data `backupId:index`, so a chunk
 * cannot be swapped, reordered or taken from another backup unnoticed. The manifest (which lists the chunks) is sealed with the same key;
 * its header carries the scrypt salt in the clear, which is not secret. Telegram sees only random bytes.
 */

export const MAGIC = Buffer.from('SUDB1')
const SALT = 16
const IV = 12
const TAG = 16
/** one piece of plain (already gzipped) data: with the 28 bytes of IV and tag it stays under 19.5 MB, which a bot can read back (20 MB limit) */
export const CHUNK_PLAIN = 19 * 1024 * 1024
const KDF = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }

/** the piece size in use (tests make it small to get several pieces from a small file) */
export const chunkPlain = (): number => Math.max(1024, Number(process.env.SUD_BACKUP_CHUNK) || CHUNK_PLAIN)

export const MIN_PASSPHRASE = 10

export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase.normalize('NFKC'), salt, 32, KDF)
}

/** iv | tag | ciphertext */
export function seal(key: Buffer, plain: Uint8Array, aad: string): Buffer {
  const iv = crypto.randomBytes(IV)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(plain), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct])
}

/** throws when the key is wrong or one byte changed */
export function open(key: Buffer, blob: Uint8Array, aad: string): Buffer {
  const b = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength)
  if (b.length < IV + TAG) throw new Error('short')
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, IV))
  d.setAAD(Buffer.from(aad))
  d.setAuthTag(b.subarray(IV, IV + TAG))
  return Buffer.concat([d.update(b.subarray(IV + TAG)), d.final()])
}

export interface ChunkRef {
  i: number
  fileId: string
  messageId: number
  /** bytes and sha-256 of the SEALED chunk as stored in Telegram */
  size: number
  sha256: string
}

export interface Manifest {
  v: 1
  id: string
  created: string
  app: string
  /** the database file before compression */
  dbBytes: number
  dbSha256: string
  gzBytes: number
  chunks: ChunkRef[]
}

export interface PartRef {
  fileId: string
  messageId: number
  /** bytes and sha-256 of the SEALED part as stored in Telegram */
  size: number
  sha256: string
}

export interface BucketRef {
  /** what it holds, e.g. `bills:207324986:2024` (only inside the sealed manifest: file names and captions in Telegram are opaque) */
  name: string
  /** keyed hash (HMAC-SHA-256) of the bucket's plain text: the same content has the same id, whoever looks cannot confirm a guess without the key */
  id: string
  rows: number
  /** plain (uncompressed) bytes */
  bytes: number
  parts: PartRef[]
}

/** the incremental format: a list of content-addressed buckets and a pointer to the manifest before it */
export interface ManifestV2 {
  v: 2
  id: string
  created: string
  app: string
  prev: { messageId: number; fileId: string; created: string } | null
  /** when THIS channel's chain began (its first backup): carried over from manifest to manifest; absent on manifests older than this field */
  since?: string
  /** every company's first-scrape and «as of» dates at the time of this backup */
  companies: Record<string, { firstAt: number; refreshedAt: number; /** the company's name as its own bills spell it (the courts' spelling); absent when no bill names it */ name?: string }>
  buckets: BucketRef[]
}

export type AnyManifest = Manifest | ManifestV2

export const bucketAad = (id: string, part: number): string => `bucket:${id}:${part}`

export function bucketId(key: Buffer, plain: Uint8Array): string {
  const sub = crypto.createHmac('sha256', key).update('sud-bucket-id').digest()
  return crypto.createHmac('sha256', sub).update(plain).digest('hex')
}

export const chunkAad = (id: string, i: number): string => `${id}:${i}`

// The manifest's authenticated data is the fixed word «manifest»: its own id is inside it, and every chunk is bound to that id by `chunkAad`.
const MANIFEST_AAD = 'manifest'

/** MAGIC | salt | iv | tag | ciphertext(JSON) */
export function sealManifest(m: AnyManifest, salt: Buffer, key: Buffer): Buffer {
  return Buffer.concat([MAGIC, salt, seal(key, Buffer.from(JSON.stringify(m)), MANIFEST_AAD)])
}

/** a manifest of the same chain (same salt): opened with the key already derived, no second scrypt */
export function openManifestWithKey(key: Buffer, blob: Uint8Array): AnyManifest | null {
  const b = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength)
  if (b.length < MAGIC.length + SALT + IV + TAG || !b.subarray(0, MAGIC.length).equals(MAGIC)) return null
  try {
    return JSON.parse(open(key, b.subarray(MAGIC.length + SALT), MANIFEST_AAD).toString('utf8')) as AnyManifest
  } catch {
    return null
  }
}

export type OpenedManifest = { ok: true; manifest: AnyManifest; key: Buffer; salt: Buffer } | { ok: false; error: 'not_backup' | 'wrong_passphrase' }

export function openManifest(passphrase: string, blob: Uint8Array): OpenedManifest {
  const b = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength)
  if (b.length < MAGIC.length + SALT + IV + TAG || !b.subarray(0, MAGIC.length).equals(MAGIC)) return { ok: false, error: 'not_backup' }
  const salt = Buffer.from(b.subarray(MAGIC.length, MAGIC.length + SALT))
  const key = deriveKey(passphrase, salt)
  try {
    const plain = open(key, b.subarray(MAGIC.length + SALT), MANIFEST_AAD)
    return { ok: true, manifest: JSON.parse(plain.toString('utf8')) as AnyManifest, key, salt }
  } catch {
    return { ok: false, error: 'wrong_passphrase' }
  }
}

export const newSalt = (): Buffer => crypto.randomBytes(SALT)
export const sha256 = (b: Uint8Array): string => crypto.createHash('sha256').update(b).digest('hex')
