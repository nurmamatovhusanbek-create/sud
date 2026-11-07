import { beforeAll, describe, expect, mock, test } from 'bun:test'

let src: typeof import('../order-file')
beforeAll(async () => {
  src = await import('../order-file')
})

const enc = (s: string) => new TextEncoder().encode(s)
const PDF = enc('%PDF-1.4 ok')
const REFUSED = enc('{"message":"Каптча тасдиқланмади"}')

function deps(replies: { status: number; body: Uint8Array }[], tokenFails = 0) {
  const calls = { tokens: [] as (string | undefined)[], downloads: [] as { token: string; worker?: string }[] }
  let minted = 0
  const d: import('../order-file').OrderFileDeps = {
    pick: (ex) => ['w1', 'w2', 'w3'].find((w) => !ex.includes(w)),
    getToken: async (w) => {
      calls.tokens.push(w)
      if (minted++ < tokenFails) throw new Error('no token')
      return `tok${minted}`
    },
    download: async (_id, token, worker) => {
      calls.downloads.push({ token, worker })
      return replies.shift()!
    },
  }
  return { d, calls }
}

describe('fetchOrderFile (captcha-gated download)', () => {
  test('mints a token, sends it from the SAME worker, returns the bytes', async () => {
    const { d, calls } = deps([{ status: 200, body: PDF }])
    expect(await src.fetchOrderFileWith('id', d)).toBe(PDF)
    expect(calls.tokens).toEqual(['w1'])
    expect(calls.downloads).toEqual([{ token: 'tok1', worker: 'w1' }])
  })
  test('a refused token is retried once, from a different worker, with a fresh token', async () => {
    const { d, calls } = deps([{ status: 403, body: REFUSED }, { status: 200, body: PDF }])
    expect(await src.fetchOrderFileWith('id', d)).toBe(PDF)
    expect(calls.tokens).toEqual(['w1', 'w2'])
    expect(calls.downloads.map((x) => x.token)).toEqual(['tok1', 'tok2'])
  })
  test('refused twice → a clear error, no third try', async () => {
    const { d, calls } = deps([{ status: 403, body: REFUSED }, { status: 403, body: REFUSED }])
    await expect(src.fetchOrderFileWith('id', d)).rejects.toThrow('captcha tokeni qabul qilinmadi')
    expect(calls.downloads.length).toBe(2)
  })
  test('a failed token mint moves on to the next worker', async () => {
    const { d, calls } = deps([{ status: 200, body: PDF }], 1)
    expect(await src.fetchOrderFileWith('id', d)).toBe(PDF)
    expect(calls.tokens).toEqual(['w1', 'w2'])
  })
  test('no token at all → the error points at Settings › Captcha', async () => {
    const { d } = deps([], 5)
    await expect(src.fetchOrderFileWith('id', d)).rejects.toThrow('Sozlamalar › Captcha')
  })
  test('another HTTP error is not retried (no captcha spent twice)', async () => {
    const { d, calls } = deps([{ status: 500, body: enc('boom') }])
    await expect(src.fetchOrderFileWith('id', d)).rejects.toThrow('HTTP 500')
    expect(calls.downloads.length).toBe(1)
  })
  test('isCaptchaRefusal', () => {
    expect(src.isCaptchaRefusal(403, '{"message":"Каптча тасдиқланмади"}')).toBe(true)
    expect(src.isCaptchaRefusal(403, 'captcha failed')).toBe(true)
    expect(src.isCaptchaRefusal(403, 'forbidden')).toBe(false)
    expect(src.isCaptchaRefusal(500, 'captcha')).toBe(false)
  })
})
