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
  test('the site wants a person: that order is listed with the way out, the rest is deferred (not tried: the loader now rests), the job ends', async () => {
    const r = rig((id) => {
      if (id === ID(2)) throw new ManualDownloadRequired('captcha')
      return ok
    })
    r.job.start([ID(1), ID(2), ID(3), ID(4)])
    await r.job.settled()
    const s = r.job.state()
    expect(r.calls).toEqual([ID(1), ID(2)]) // 3 and 4 never asked: no captcha burnt on a shut door
    expect(s).toMatchObject({ phase: 'done', ok: 1, deferred: 2 })
    expect(s.problems).toEqual([expect.objectContaining({ pdfId: ID(2), kind: 'manual' })])
    expect(s.problems[0]!.message).toContain('HAR')
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
