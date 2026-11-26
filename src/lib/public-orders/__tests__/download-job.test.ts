import { describe, expect, mock, test } from 'bun:test'
import { ManualDownloadRequired, NotPdfError, type OrderPdf } from '../order-pdf'

mock.module('server-only', () => ({}))
const { createDownloadJob } = await import('../download-job')

const ID = (n: number) => `0000000${n}-1111-2222-3333-444444444444`
const ok: OrderPdf = { saved: true, bytes: new Uint8Array(), filename: null, cached: false }

function rig(behaviour: (id: string, attempt: number) => Promise<OrderPdf> | OrderPdf) {
  const calls: string[] = []
  const attempts = new Map<string, number>()
  const purged: Array<[string, string]> = []
  const onDisk = new Set<string>()
  const job = createDownloadJob({
    load: async (id) => {
      calls.push(id)
      const n = (attempts.get(id) ?? 0) + 1
      attempts.set(id, n)
      return behaviour(id, n)
    },
    has: async (id) => onDisk.has(id),
    describe: async (id) => ({ caseNumber: `2-1-25/${id.slice(7, 8)}`, instance: 'Birinchi instansiya' }),
    purge: async (id, c) => void purged.push([id, c]),
  })
  return { job, calls, purged, onDisk, attempts }
}

describe('the download job', () => {
  test('saves every order in turn and reports the counts', async () => {
    const r = rig(() => ok)
    expect(r.job.start([ID(1), ID(2), ID(3)])).toEqual({ ok: true })
    await r.job.settled()
    expect(r.job.state()).toMatchObject({ phase: 'done', total: 3, done: 3, ok: 3, removed: 0, deferred: 0, problems: [] })
    expect(r.calls).toEqual([ID(1), ID(2), ID(3)])
  })
  test('a file already on disk is not downloaded again', async () => {
    const r = rig(() => ok)
    r.onDisk.add(ID(2))
    r.job.start([ID(1), ID(2)])
    await r.job.settled()
    expect(r.calls).toEqual([ID(1)])
    expect(r.job.state()).toMatchObject({ done: 2, ok: 1 })
  })
  test('«Fayl PDF emas»: asked once more; a second miss removes the order from the metadata and the rest goes on', async () => {
    const r = rig((id) => {
      if (id === ID(2)) throw new NotPdfError()
      return ok
    })
    r.job.start([ID(1), ID(2), ID(3)])
    await r.job.settled()
    const s = r.job.state()
    expect(r.attempts.get(ID(2))).toBe(2)
    expect(r.purged).toEqual([[ID(2), '2-1-25/2']])
    expect(s).toMatchObject({ phase: 'done', ok: 2, removed: 1, done: 3 })
    expect(s.problems).toEqual([expect.objectContaining({ pdfId: ID(2), kind: 'removed', caseNumber: '2-1-25/2' })])
  })
  test('a real file of another kind (Word, an image) is NEVER removed: listed with what it is, and the job goes on', async () => {
    const r = rig((id) => {
      if (id === ID(1)) throw new NotPdfError(Buffer.from('PK\x03\x04 word/document.xml', 'latin1'))
      return ok
    })
    r.job.start([ID(1), ID(2)])
    await r.job.settled()
    expect(r.purged).toEqual([])
    expect(r.job.state()).toMatchObject({ ok: 1, removed: 0 })
    expect(r.job.state().problems).toEqual([expect.objectContaining({ kind: 'other', message: expect.stringContaining('Word hujjati') })])
  })
  test('an error page twice: removed, and the report says what the site sent', async () => {
    const r = rig(() => {
      throw new NotPdfError(Buffer.from('{"message":"Fayl topilmadi"}'))
    })
    r.job.start([ID(1)])
    await r.job.settled()
    expect(r.purged).toHaveLength(1)
    expect(r.job.state().problems[0]!.message).toContain('JSON javob')
    expect(r.job.state().problems[0]!.message).toContain('Fayl topilmadi')
  })
  test('a second attempt that works is a plain success: nothing is removed', async () => {
    const r = rig((_id, n) => {
      if (n === 1) throw new NotPdfError()
      return ok
    })
    r.job.start([ID(1)])
    await r.job.settled()
    expect(r.job.state()).toMatchObject({ ok: 1, removed: 0, problems: [] })
    expect(r.purged).toEqual([])
  })
  test('one order refused: it is listed with the way out and skipped, the NEXT one is a probe (the loader\'s rest is reopened) and the job goes on', async () => {
    const probes: boolean[] = []
    const job = createDownloadJob({
      load: async (id, probe) => {
        probes.push(probe)
        if (id === ID(2)) throw new ManualDownloadRequired('captcha')
        return ok
      },
      has: async () => false,
      describe: async (id) => ({ caseNumber: `2-1-25/${id.slice(7, 8)}`, instance: '' }),
      purge: async () => {},
    })
    job.start([ID(1), ID(2), ID(3), ID(4)])
    await job.settled()
    const s = job.state()
    expect(probes).toEqual([false, false, true, false]) // only the order right after a refusal is a probe
    expect(s).toMatchObject({ phase: 'done', ok: 3, deferred: 0, done: 4 })
    expect(s.problems).toEqual([expect.objectContaining({ pdfId: ID(2), kind: 'manual' })])
    expect(s.problems[0]!.message).toContain('HAR')
  })
  test('refused three times in a row: the site is closed for now, the rest is deferred (no more captchas burnt) and the job ends', async () => {
    const r = rig((id) => {
      if (id !== ID(1)) throw new ManualDownloadRequired('captcha')
      return ok
    })
    r.job.start([ID(1), ID(2), ID(3), ID(4), ID(5), ID(6)])
    await r.job.settled()
    const s = r.job.state()
    expect(r.calls).toEqual([ID(1), ID(2), ID(3), ID(4)]) // 5 and 6 never asked
    expect(s).toMatchObject({ phase: 'done', ok: 1, deferred: 2 })
    expect(s.problems.map((p) => p.kind)).toEqual(['manual', 'manual', 'manual'])
  })
  test('a success in between resets the count: refused, fine, refused, fine never gives up', async () => {
    const r = rig((id) => {
      if (Number(id.slice(7, 8)) % 2 === 0) throw new ManualDownloadRequired('captcha')
      return ok
    })
    r.job.start([ID(1), ID(2), ID(3), ID(4), ID(5), ID(6), ID(7)])
    await r.job.settled()
    expect(r.job.state()).toMatchObject({ ok: 4, deferred: 0, done: 7 })
    expect(r.job.state().problems).toHaveLength(3)
  })
  test('any other failure is listed and skipped; the job goes on', async () => {
    const r = rig((id) => {
      if (id === ID(1)) throw new Error('HTTP 502')
      return ok
    })
    r.job.start([ID(1), ID(2)])
    await r.job.settled()
    expect(r.job.state()).toMatchObject({ ok: 1, done: 2, removed: 0 })
    expect(r.job.state().problems).toEqual([expect.objectContaining({ kind: 'other', message: 'HTTP 502' })])
    expect(r.purged).toEqual([])
  })
  test('the SAME failure three orders in a row is not about the orders: the rest is left, the reason is said once; a different one in between resets', async () => {
    const r = rig(() => {
      throw new Error('hech bir yoʻl ishlamadi · bu worker eski')
    })
    r.job.start([ID(1), ID(2), ID(3), ID(4), ID(5)])
    await r.job.settled()
    const s = r.job.state()
    expect(r.calls).toEqual([ID(1), ID(2), ID(3)])
    expect(s).toMatchObject({ phase: 'done', ok: 0, deferred: 2 })
    expect(s.note).toContain('bu worker eski')
    expect(s.problems).toHaveLength(3)
    const mixed = rig((id) => {
      throw new Error(Number(id.slice(7, 8)) % 2 ? 'A' : 'B')
    })
    mixed.job.start([ID(1), ID(2), ID(3), ID(4), ID(5)])
    await mixed.job.settled()
    expect(mixed.job.state()).toMatchObject({ deferred: 0, done: 5, note: '' })
  })
  test('a file that arrived but could not be kept stops the job and says why', async () => {
    const r = rig((id) => (id === ID(1) ? { ...ok, saved: false, saveError: 'disk toʻla' } : ok))
    r.job.start([ID(1), ID(2)])
    await r.job.settled()
    expect(r.calls).toEqual([ID(1)])
    expect(r.job.state().note).toContain('disk toʻla')
  })
  test('stop ends after the order in flight; a second start while running is refused; clear dismisses the report', async () => {
    let release!: () => void
    const gate = new Promise<void>((res) => (release = res))
    const r = rig(async (id) => {
      if (id === ID(1)) await gate
      return ok
    })
    expect(r.job.start([ID(1), ID(2), ID(3)])).toEqual({ ok: true })
    expect(r.job.start([ID(4)])).toEqual({ ok: false, error: 'Yuklash allaqachon ketmoqda' })
    r.job.stop()
    release()
    await r.job.settled()
    expect(r.job.state()).toMatchObject({ phase: 'stopped', ok: 1 })
    expect(r.calls).toEqual([ID(1)])
    r.job.clear()
    expect(r.job.state().phase).toBe('idle')
  })
  test('ids are checked: malformed ones are dropped, repeats counted once, an empty list is refused', async () => {
    const r = rig(() => ok)
    expect(r.job.start(['../x', 'nope'])).toEqual({ ok: false, error: 'Yuklanadigan qaror yoʻq' })
    expect(r.job.start([ID(1), ID(1).toUpperCase(), ID(2)])).toEqual({ ok: true })
    await r.job.settled()
    expect(r.job.state().total).toBe(2)
  })
})
