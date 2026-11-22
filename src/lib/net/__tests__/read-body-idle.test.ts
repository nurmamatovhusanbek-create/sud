import { describe, expect, test } from 'bun:test'
import { readBodyIdle } from '../worker-fetch'

const enc = new TextEncoder()
/** a PULL stream: each part is read before the next one is produced (like a socket), so an error does not discard what was already delivered */
const stream = (parts: (string | 'stall' | 'error')[]) => {
  let i = 0
  return new Response(
    new ReadableStream({
      async pull(c) {
        const p = parts[i++]
        if (p === undefined) return c.close()
        if (p === 'stall') return new Promise(() => {})
        if (p === 'error') return c.error(new Error('connection reset'))
        c.enqueue(enc.encode(p))
      },
    }),
  )
}

describe('readBodyIdle', () => {
  test('a complete body', async () => {
    expect(await readBodyIdle(stream(['[{"a":', '1}]']))).toEqual({ text: '[{"a":1}]', complete: true })
  })
  test('a stalled stream: what arrived is returned, complete=false, reason idle', async () => {
    const r = await readBodyIdle(stream(['[{"a":1},', '{"a":2}', 'stall']), { idleMs: 60 })
    expect(r).toMatchObject({ text: '[{"a":1},{"a":2}', complete: false, reason: 'idle' })
  })
  test('a broken connection keeps the part that arrived', async () => {
    const r = await readBodyIdle(stream(['[{"a":1},', 'error']))
    expect(r).toMatchObject({ text: '[{"a":1},', complete: false, reason: 'error' })
  })
  test('a size ceiling', async () => {
    const r = await readBodyIdle(stream(['x'.repeat(50), 'y'.repeat(50)]), { maxBytes: 60 })
    expect(r.complete).toBe(false)
    expect(r.reason).toBe('size')
  })
})
