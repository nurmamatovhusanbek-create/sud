import { describe, expect, test } from 'bun:test'
import { createRouteHealth, DIRECT, fetchOrderFileWith, isCaptchaRefusal, RoutesFailedError, type OrderFileDeps } from '../order-file'

const enc = (s: string) => new TextEncoder().encode(s)
const PDF = enc('%PDF-1.4 ok')
const REFUSED = enc('{"message":"Каптча тасдиқланмади"}')
type Reply = { status: number; body: Uint8Array } | Error

function deps(replies: Reply[], tokenFails: string[] = []) {
  const calls = { tokens: [] as string[], downloads: [] as { token: string; route: string }[] }
  let minted = 0
  const d: OrderFileDeps = {
    pick: (ex) => ['https://w1.example', 'https://w2.example', 'https://w3.example'].find((w) => !ex.includes(w)),
    getToken: async (route) => {
      calls.tokens.push(route)
      if (tokenFails.includes(route)) throw new Error('no token')
      return `tok${++minted}`
    },
    download: async (_id, token, route) => {
      calls.downloads.push({ token, route })
      const r = replies.shift()!
      if (r instanceof Error) throw r
      return r
    },
  }
  return { d, calls }
}

describe('fetchOrderFileWith (captcha-gated download)', () => {
  test('first try is THIS machine: token and download on the same route', async () => {
    const { d, calls } = deps([{ status: 200, body: PDF }])
    expect(await fetchOrderFileWith('id', d)).toBe(PDF)
    expect(calls.tokens).toEqual([DIRECT])
    expect(calls.downloads).toEqual([{ token: 'tok1', route: DIRECT }])
  })
  test('a refused token moves to a worker, which mints its own token and downloads itself', async () => {
    const { d, calls } = deps([{ status: 403, body: REFUSED }, { status: 200, body: PDF }])
    expect(await fetchOrderFileWith('id', d)).toBe(PDF)
    expect(calls.tokens).toEqual([DIRECT, 'https://w1.example'])
    expect(calls.downloads.map((x) => [x.token, x.route])).toEqual([['tok1', DIRECT], ['tok2', 'https://w1.example']])
  })
  test('refused on every route → one error that names each route; never more than 3 captchas', async () => {
    const { d, calls } = deps([{ status: 403, body: REFUSED }, { status: 403, body: REFUSED }, { status: 403, body: REFUSED }])
    const e = await fetchOrderFileWith('id', d).catch((x: Error) => x)
    expect((e as Error).message).toContain('bu kompyuter: token qabul qilinmadi')
    expect((e as Error).message).toContain('w1.example: token qabul qilinmadi')
    expect(calls.downloads.length).toBe(3)
  })
  test('this machine cannot reach the captcha (blocked) → workers are tried', async () => {
    const { d, calls } = deps([{ status: 200, body: PDF }], [DIRECT])
    expect(await fetchOrderFileWith('id', d)).toBe(PDF)
    expect(calls.tokens).toEqual([DIRECT, 'https://w1.example'])
  })
  test('a network error on the download moves on too', async () => {
    const { d } = deps([new Error('ECONNRESET'), { status: 200, body: PDF }])
    expect(await fetchOrderFileWith('id', d)).toBe(PDF)
  })
  test('no token on any route → the error points at Settings › Captcha', async () => {
    const { d } = deps([], [DIRECT, 'https://w1.example', 'https://w2.example'])
    await expect(fetchOrderFileWith('id', d)).rejects.toThrow('token olinmadi')
  })
  test('another HTTP error is not retried (no captcha spent twice) and shows what the site said', async () => {
    const { d, calls } = deps([{ status: 500, body: enc('boom') }])
    await expect(fetchOrderFileWith('id', d)).rejects.toThrow('HTTP 500 (bu kompyuter) boom')
    expect(calls.downloads.length).toBe(1)
  })
  test('a worker that does not allow the host (an old deployment) rests for an hour; the order is served by the next route, and later orders skip it without a captcha', async () => {
    let t = 1_000
    const health = createRouteHealth(() => t)
    const NOT_ALLOWED = enc('{"error":"Host adolatapi1.sud.uz not allowed. Permitted: billing.sud.uz"}')
    const { d, calls } = deps([{ status: 403, body: NOT_ALLOWED }, { status: 200, body: PDF }, { status: 200, body: PDF }], [])
    d.health = health
    d.rotate = () => 1 // start on the first worker
    expect(await fetchOrderFileWith('id', d)).toBe(PDF)
    expect(calls.tokens).toEqual(['https://w1.example', 'https://w2.example'])
    expect(health.resting('https://w1.example')).toContain('Cloudflare')
    // the next order: w1 rests, so it is not even asked for a token
    d.rotate = () => 1
    expect(await fetchOrderFileWith('id2', d)).toBe(PDF)
    expect(calls.tokens.slice(2)).toEqual(['https://w2.example'])
    t += 61 * 60_000
    expect(health.resting('https://w1.example')).toBeNull() // an hour later it is tried again
  })
  test('this machine cannot mint a token: it rests, so the next orders do not wait 30 s for it again', async () => {
    const health = createRouteHealth(() => 5)
    const { d, calls } = deps([{ status: 200, body: PDF }, { status: 200, body: PDF }], [DIRECT])
    d.health = health
    await fetchOrderFileWith('a', d)
    await fetchOrderFileWith('b', d)
    expect(calls.tokens).toEqual([DIRECT, 'https://w1.example', 'https://w1.example']) // DIRECT asked once, then rested
    expect(health.resting(DIRECT)).toContain('token olinmadi')
  })
  test('round robin: each download starts one route later; a refusal is still the site\'s, a broken setup is said as it is', async () => {
    const { d, calls } = deps([{ status: 200, body: PDF }, { status: 200, body: PDF }, { status: 200, body: PDF }, { status: 200, body: PDF }])
    let n = 0
    d.rotate = () => n++
    for (const id of ['a', 'b', 'c', 'd']) await fetchOrderFileWith(id, d)
    expect(calls.downloads.map((x) => x.route)).toEqual([DIRECT, 'https://w1.example', 'https://w2.example', DIRECT])
    const broken = deps([], [DIRECT, 'https://w1.example', 'https://w2.example'])
    const e = await fetchOrderFileWith('x', broken.d).catch((x: Error) => x)
    expect(e).toBeInstanceOf(RoutesFailedError)
    expect((e as Error).message).toContain('hech bir yoʻl ishlamadi')
  })
  test('isCaptchaRefusal', () => {
    expect(isCaptchaRefusal(403, '{"message":"Каптча тасдиқланмади"}')).toBe(true)
    expect(isCaptchaRefusal(403, 'captcha failed')).toBe(true)
    expect(isCaptchaRefusal(403, 'forbidden')).toBe(false)
    expect(isCaptchaRefusal(500, 'captcha')).toBe(false)
  })
})
