import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { legacyDataDir, migrateLegacy, resolveDataDir } from '../data-dir'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-dir-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('orders cache location', () => {
  test('lives in the home folder, outside the project; the env var overrides', () => {
    expect(resolveDataDir({}, '/home/u')).toBe(path.join('/home/u', '.sud-tizimi', 'public-orders'))
    expect(resolveDataDir({ PUBLIC_ORDERS_DIR: '/x/y' }, '/home/u')).toBe('/x/y')
    expect(legacyDataDir('/proj')).toBe(path.join('/proj', 'data', 'public-orders'))
  })

  test('an old in-project cache is COPIED over once: nothing overwritten, nothing deleted', () => {
    const from = path.join(root, 'old')
    const to = path.join(root, 'new')
    fs.mkdirSync(path.join(from, 'shards'), { recursive: true })
    fs.writeFileSync(path.join(from, 'shards', '001.jsonl'), '{"id":"a"}\n')
    fs.writeFileSync(path.join(from, 'checked.jsonl'), '{"caseNumber":"x"}\n')
    expect(migrateLegacy(from, to)).toBe(true)
    expect(fs.readFileSync(path.join(to, 'shards', '001.jsonl'), 'utf8')).toBe('{"id":"a"}\n')
    expect(fs.existsSync(path.join(from, 'checked.jsonl'))).toBe(true) // the old one is left alone

    // a cache that already exists at the target is never touched again
    fs.appendFileSync(path.join(to, 'checked.jsonl'), '{"caseNumber":"y"}\n')
    fs.writeFileSync(path.join(from, 'checked.jsonl'), 'CHANGED\n')
    expect(migrateLegacy(from, to)).toBe(false)
    expect(fs.readFileSync(path.join(to, 'checked.jsonl'), 'utf8')).toBe('{"caseNumber":"x"}\n{"caseNumber":"y"}\n')
  })

  test('nothing to migrate, or the same folder: no-op', () => {
    expect(migrateLegacy(path.join(root, 'missing'), path.join(root, 'n2'))).toBe(false)
    expect(migrateLegacy(path.join(root, 'new'), path.join(root, 'new'))).toBe(false)
  })
})
