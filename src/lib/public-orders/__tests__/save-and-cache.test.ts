import { afterAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createOrderPdfLoader, type OrderPdfDeps } from '../order-pdf'

mock.module('server-only', () => ({}))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-save-'))
process.env.PUBLIC_ORDERS_DIR = dir
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const enc = (s: string) => new TextEncoder().encode(s)
const PDF = enc('%PDF-1.4 hello')
const err = (code: string) => Object.assign(new Error(code), { code })

describe('renameWithRetry (Windows holds a fresh file for a moment)', () => {
  test('a transient EPERM / EBUSY / EACCES is retried and then succeeds', async () => {
    const { renameWithRetry } = await import('../pdf-store')
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
      let calls = 0
      const slept: number[] = []
      await renameWithRetry('a', 'b', { rename: async () => { if (++calls < 3) throw err(code) }, sleep: async (ms) => void slept.push(ms) })
      expect(calls).toBe(3)
      expect(slept).toEqual([80, 160]) // backs off
    }
  })
  test('anything else fails at once (a missing folder, a full disk are not «try again»)', async () => {
    const { renameWithRetry } = await import('../pdf-store')
    for (const code of ['ENOENT', 'ENOSPC', 'EXDEV']) {
      let calls = 0
      await expect(renameWithRetry('a', 'b', { rename: async () => { calls++; throw err(code) }, sleep: async () => {} })).rejects.toThrow(code)
      expect(calls).toBe(1)
    }
  })
  test('it gives up after the last try, with the real error', async () => {
    const { renameWithRetry } = await import('../pdf-store')
    let calls = 0
    await expect(renameWithRetry('a', 'b', { rename: async () => { calls++; throw err('EPERM') }, sleep: async () => {} }, 4)).rejects.toThrow('EPERM')
    expect(calls).toBe(4)
  })
})

describe('writePdf keeps the file whole, or says it could not', () => {
  test('a normal save leaves exactly the PDF (no temp file behind) and is verified', async () => {
    const { writePdf, readPdf } = await import('../pdf-store')
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await writePdf(id, PDF)
    expect(Buffer.from((await readPdf(id))!).toString()).toBe('%PDF-1.4 hello')
    expect(fs.readdirSync(path.join(dir, 'files')).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
  test('when the target cannot be replaced at all, it throws and leaves no temp file', async () => {
    const { writePdf } = await import('../pdf-store')
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    fs.mkdirSync(path.join(dir, 'files', `${id}.pdf`)) // a DIRECTORY where the file must go: rename and copy both fail
    await expect(writePdf(id, PDF)).rejects.toThrow()
    expect(fs.readdirSync(path.join(dir, 'files')).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})

describe('the loader says whether the PDF was KEPT', () => {
  const deps = (write: OrderPdfDeps['write']): OrderPdfDeps => ({
    read: async () => null,
    write,
    fetch: async () => PDF,
    sleep: async () => {},
    now: () => 1,
  })
  test('saved: true when the write worked', async () => {
    const r = await createOrderPdfLoader(deps(async () => {}))('a')
    expect(r).toMatchObject({ saved: true, cached: false })
    expect(r.saveError).toBeUndefined()
  })
  test('a failed write still returns the PDF (the person waited for it) but says saved: false and why', async () => {
    const r = await createOrderPdfLoader(deps(async () => { throw err('EPERM') }))('a')
    expect(Buffer.from(r.bytes).toString()).toBe('%PDF-1.4 hello')
    expect(r).toMatchObject({ saved: false, saveError: 'EPERM' })
  })
  test('a file already on disk is saved: true', async () => {
    const r = await createOrderPdfLoader({ ...deps(async () => {}), read: async () => PDF })('a')
    expect(r).toMatchObject({ saved: true, cached: true })
  })
})

describe('GET /api/public-orders/file: never cached by the browser, says whether it was kept', () => {
  test('headers: no-store (a cached answer would never make the server re-save the file) and X-Order-Saved', async () => {
    const { writePdf } = await import('../pdf-store')
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    await writePdf(id, PDF)
    const { GET } = await import('@/app/api/public-orders/file/route')
    const res = await (GET as unknown as (r: Request) => Promise<Response>)(new Request(`http://localhost:3000/api/public-orders/file?id=${id}`, { headers: { host: 'localhost:3000' } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    expect(res.headers.get('Cache-Control')).not.toContain('max-age')
    expect(res.headers.get('X-Order-Saved')).toBe('1')
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })
})
