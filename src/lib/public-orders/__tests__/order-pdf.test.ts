import { afterAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createOrderPdfLoader, NotPdfError, type OrderPdfDeps } from '../order-pdf'

const enc = (s: string) => new TextEncoder().encode(s)
const PDF = enc('%PDF-1.4 hello')
const wrap = (pdf: Uint8Array, name = 'qaror.pdf') => {
  const head = `--B\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\nContent-Length: ${pdf.length}\r\n\r\n`
  return Buffer.concat([Buffer.from(head), Buffer.from(pdf), Buffer.from('\r\n--B--')])
}

function harness(fetchImpl?: (id: string) => Promise<Uint8Array>) {
  const disk = new Map<string, Uint8Array>()
  const log = { fetches: [] as string[], sleeps: [] as number[] }
  let t = 1_000_000
  const deps: OrderPdfDeps = {
    read: async (id) => disk.get(id) ?? null,
    write: async (id, b) => void disk.set(id, b),
    fetch: fetchImpl ? async (id) => (log.fetches.push(id), fetchImpl(id)) : async (id) => (log.fetches.push(id), wrap(PDF)),
    sleep: async (ms) => {
      log.sleeps.push(ms)
      t += ms
    },
    now: () => t,
  }
  return { deps, disk, log, tick: (ms: number) => (t += ms) }
}

describe('order PDF loader', () => {
  test('first open downloads and stores; the second never touches the network', async () => {
    const h = harness()
    const load = createOrderPdfLoader(h.deps)
    const a = await load('a')
    expect(a.cached).toBe(false)
    expect(a.filename).toBe('qaror.pdf')
    expect(Buffer.from(a.bytes).toString()).toBe('%PDF-1.4 hello')
    const b = await load('a')
    expect(b.cached).toBe(true)
    expect(h.log.fetches).toEqual(['a'])
  })
  test('two requests for the same order at once spend ONE captcha', async () => {
    const h = harness()
    const load = createOrderPdfLoader(h.deps)
    await Promise.all([load('a'), load('a'), load('a')])
    expect(h.log.fetches).toEqual(['a'])
  })
  test('different orders go one at a time with a gap between them', async () => {
    let running = 0
    let max = 0
    const h = harness(async () => {
      running++
      max = Math.max(max, running)
      await Promise.resolve()
      running--
      return wrap(PDF)
    })
    const load = createOrderPdfLoader(h.deps, 2000)
    await Promise.all([load('a'), load('b'), load('c')])
    expect(max).toBe(1)
    expect(h.log.fetches).toEqual(['a', 'b', 'c'])
    expect(h.log.sleeps).toEqual([2000, 2000]) // first starts at once; the next two wait the gap
  })
  test('no wait when the last download was long ago', async () => {
    const h = harness()
    const load = createOrderPdfLoader(h.deps, 2000)
    await load('a')
    h.tick(10_000)
    await load('b')
    expect(h.log.sleeps).toEqual([])
  })
  test('a failure does not block the queue and is not stored', async () => {
    let n = 0
    const h = harness(async () => {
      if (n++ === 0) throw new Error('boom')
      return wrap(PDF)
    })
    const load = createOrderPdfLoader(h.deps, 0)
    const [a, b] = await Promise.allSettled([load('a'), load('b')])
    expect(a.status).toBe('rejected')
    expect(b.status).toBe('fulfilled')
    expect(h.disk.has('a')).toBe(false)
    expect(h.disk.has('b')).toBe(true)
    await expect(load('a')).resolves.toBeTruthy() // and the failed one can be tried again
  })
  test('an error page is never stored', async () => {
    const h = harness(async () => enc('<html>nope</html>'))
    const load = createOrderPdfLoader(h.deps, 0)
    await expect(load('a')).rejects.toBeInstanceOf(NotPdfError)
    expect(h.disk.size).toBe(0)
  })
  test('a plain (unwrapped) PDF works too', async () => {
    const h = harness(async () => PDF)
    const r = await createOrderPdfLoader(h.deps, 0)('a')
    expect(r.filename).toBeNull()
    expect(h.disk.has('a')).toBe(true)
  })
  test('a failing disk write still returns the file', async () => {
    const h = harness()
    h.deps.write = async () => {
      throw new Error('ENOSPC')
    }
    const r = await createOrderPdfLoader(h.deps, 0)('a')
    expect(Buffer.from(r.bytes).subarray(0, 5).toString()).toBe('%PDF-')
  })
})

describe('pdf-store (real disk)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-pdf-'))
  process.env.PUBLIC_ORDERS_DIR = dir
  mock.module('server-only', () => ({}))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
  const ID = '32dea92e-cab2-4b4f-a6b3-0f4366ac2caa'

  test('write → read round trip, private file, nothing left over', async () => {
    const { readPdf, writePdf } = await import('../pdf-store')
    expect(await readPdf(ID)).toBeNull()
    await writePdf(ID, PDF)
    expect(Buffer.from((await readPdf(ID))!).toString()).toBe('%PDF-1.4 hello')
    expect(fs.readdirSync(path.join(dir, 'files'))).toEqual([`${ID}.pdf`])
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, 'files', `${ID}.pdf`)).mode & 0o777).toBe(0o600)
  })
  test('only a uuid becomes a file name', async () => {
    const { readPdf, writePdf } = await import('../pdf-store')
    await expect(writePdf('../../etc/passwd', PDF)).rejects.toThrow()
    expect(await readPdf('../../etc/passwd')).toBeNull()
  })
  test('a damaged file reads as «not stored»', async () => {
    const { readPdf } = await import('../pdf-store')
    const bad = '11111111-1111-1111-1111-111111111111'
    fs.writeFileSync(path.join(dir, 'files', `${bad}.pdf`), 'garbage')
    expect(await readPdf(bad)).toBeNull()
  })
})
