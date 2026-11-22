/**
 * Makes `bot/tests/fixtures/compat.json` with the APP's own crypto (src/lib/backup-crypto.ts), so the Rust bot is tested against the real format:
 *   bun bot/tests/make-fixture.ts
 * The passphrase is a made-up one; nothing here is real data.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { bucketAad, bucketId, deriveKey, newSalt, seal, sealManifest, sha256 } from '../../src/lib/backup-crypto'

const passphrase = 'fixture pass phrase 2026'
const salt = newSalt()
const key = deriveKey(passphrase, salt)
const plain = '["c","2-1004-2403/1","civil",24]\n["b","260880770031",2024,"2-1004-2403/1"]\n'
const id = bucketId(key, Buffer.from(plain))
const piece = seal(key, zlib.gzipSync(Buffer.from(plain)), bucketAad(id, 0))
const manifest = {
  v: 2 as const,
  id: 'fixture-id',
  created: '2026-01-01T00:00:00.000Z',
  app: 'sud-tizimi',
  prev: null,
  companies: { '207324986': { firstAt: 1, refreshedAt: 2 } },
  buckets: [{ name: 'index:207324986', id, rows: 2, bytes: plain.length, parts: [{ fileId: 'F1', messageId: 1, size: piece.length, sha256: sha256(piece) }] }],
}
const out = {
  passphrase,
  salt: salt.toString('hex'),
  plain,
  piece: piece.toString('base64'),
  manifest: sealManifest(manifest, salt, key).toString('base64'),
}
fs.writeFileSync(path.join(import.meta.dir, 'fixtures', 'compat.json'), JSON.stringify(out, null, 1) + '\n')
console.log('fixture written')
