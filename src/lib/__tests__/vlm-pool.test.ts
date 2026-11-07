import { describe, expect, test } from 'bun:test'
import { COOLDOWN_MS, createVlmPool, VlmPoolError } from '../vlm-pool'
import { VlmError } from '../vlm-client'
import type { VlmInput } from '@/core/vlm'

const G: VlmInput = { provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'gm', apiKey: 'gsk_aaaaaaaa' }
const M: VlmInput = { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'mm', apiKey: 'AQ.bbbbbbbb' }
const Z: VlmInput = { provider: 'zai', baseUrl: 'https://api.z.ai/api/paas/v4', model: 'zm', apiKey: 'zzzzzzzz' }
const REQ = { imageBase64: 'A', prompt: 'p' }

function make(list: VlmInput[], behave: (id: string, n: number) => string | VlmError) {
  const calls: string[] = []
  const logs: string[] = []
  let t = 1_000_000
  const counts: Record<string, number> = {}
  const pool = createVlmPool({
    list: () => list,
    call: async (cfg) => {
      calls.push(cfg.provider)
      counts[cfg.provider] = (counts[cfg.provider] ?? 0) + 1
      const r = behave(cfg.provider, counts[cfg.provider])
      if (r instanceof Error) throw r
      return r
    },
    now: () => t,
    log: (l) => logs.push(l),
  })
  return { pool, calls, logs, advance: (ms: number) => (t += ms) }
}

describe('round robin', () => {
  test('providers answer in turn', async () => {
    const h = make([G, M, Z], () => '7')
    for (let i = 0; i < 5; i++) await h.pool.ask(REQ)
    expect(h.calls).toEqual(['groq', 'gemini', 'zai', 'groq', 'gemini'])
  })
  test('the answer says who gave it', async () => {
    const h = make([G, M], () => '7')
    expect((await h.pool.ask(REQ)).via).toBe('groq · gm')
    expect((await h.pool.ask(REQ)).via).toBe('gemini · mm')
  })
  test('one provider: always that one', async () => {
    const h = make([G], () => '7')
    await h.pool.ask(REQ)
    await h.pool.ask(REQ)
    expect(h.calls).toEqual(['groq', 'groq'])
  })
})

describe('failover (before anything is retried)', () => {
  test('a failing provider → the next one is asked at once, in the same question', async () => {
    const h = make([G, M], (id) => (id === 'groq' ? new VlmError('rate_limited', '429 quota') : '19'))
    const a = await h.pool.ask(REQ)
    expect(a.via).toBe('gemini · mm')
    expect(h.calls).toEqual(['groq', 'gemini'])
    expect(h.logs[0]).toContain('groq · gm failed (rate_limited')
    expect(h.logs[0]).toContain('trying the next provider')
  })
  test('a provider that hit its limit is skipped for minutes, then asked again', async () => {
    const h = make([G, M], (id) => (id === 'groq' ? new VlmError('rate_limited', 'x') : '1'))
    await h.pool.ask(REQ) // groq fails, gemini answers
    await h.pool.ask(REQ) // groq is resting: only gemini
    await h.pool.ask(REQ)
    expect(h.calls).toEqual(['groq', 'gemini', 'gemini', 'gemini'])
    h.advance(COOLDOWN_MS.rate_limited + 1)
    h.calls.length = 0
    await h.pool.ask(REQ) // after the rest, groq gets another chance (fails again, gemini answers)
    expect(h.calls[0]).toBe('groq')
  })
  test('a transient error rests only briefly', async () => {
    let n = 0
    const h = make([G, M], (id) => (id === 'groq' && n++ === 0 ? new VlmError('timeout', 'slow') : '1'))
    await h.pool.ask(REQ)
    h.advance(COOLDOWN_MS.timeout + 1)
    h.calls.length = 0
    await h.pool.ask(REQ) // next in turn is groq again and it works now
    expect(h.calls.includes('groq')).toBe(true)
  })
  test('every provider fails → one error naming each reason', async () => {
    const h = make([G, M], (id) => new VlmError(id === 'groq' ? 'rate_limited' : 'bad_key', 'x'))
    const e = (await h.pool.ask(REQ).catch((x) => x)) as VlmPoolError
    expect(e).toBeInstanceOf(VlmPoolError)
    expect(e.message).toContain('groq (rate_limited)')
    expect(e.message).toContain('gemini (bad_key)')
    expect(e.failures.length).toBe(2)
  })
  test('everyone resting → still asks (better than giving up), and recovers', async () => {
    let fail = true
    const h = make([G, M], () => (fail ? new VlmError('rate_limited', 'x') : '3'))
    await h.pool.ask(REQ).catch(() => {})
    fail = false
    const a = await h.pool.ask(REQ)
    expect(a.text).toBe('3')
  })
  test('no providers → a clear error', async () => {
    const h = make([], () => '1')
    await expect(h.pool.ask(REQ)).rejects.toThrow('VLM sozlanmagan')
  })
  test('the list is re-read on every question (Settings changes apply at once)', async () => {
    const list: VlmInput[] = [G]
    const h = make(list, () => '1')
    await h.pool.ask(REQ)
    list.push(M)
    await h.pool.ask(REQ)
    expect(h.calls).toEqual(['groq', 'gemini'])
  })
})
