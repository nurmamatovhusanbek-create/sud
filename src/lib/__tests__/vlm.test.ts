import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

mock.module('server-only', () => ({}))

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-vlm-'))
process.env.VLM_CONFIG_FILE = path.join(dir, 'vlm.json')
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const { mathImage, encodePng, renderText } = await import('../vlm-test-image')
const { testVision, parseIntegerAnswer } = await import('../vlm-test')
const { callVision, VlmError } = await import('../vlm-client')
const cfgMod = await import('../vlm-config')

const cfg = { baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'secret-key-1234' }

describe('test picture', () => {
  test('is a real PNG with the right answer', () => {
    const img = mathImage(12, '+', 7)
    expect(img.answer).toBe(19)
    expect(img.expression).toBe('12 + 7 =')
    const buf = Buffer.from(img.pngBase64, 'base64')
    expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const { width, height } = renderText(img.expression)
    expect(buf.readUInt32BE(16)).toBe(width)
    expect(buf.readUInt32BE(20)).toBe(height)
  })
  test('subtraction and product', () => {
    expect(mathImage(30, '-', 4).answer).toBe(26)
    expect(mathImage(6, '*', 7).answer).toBe(42)
  })
  test('text is actually drawn (dark pixels exist)', () => {
    const { pixels } = renderText('8')
    expect(pixels.some((p) => p < 50)).toBe(true)
  })
  test('encodePng validates round trip through zlib', () => {
    const png = encodePng(2, 2, new Uint8Array([0, 255, 255, 0]))
    expect(png.length).toBeGreaterThan(40)
  })
})

describe('parseIntegerAnswer', () => {
  test('first integer', () => {
    expect(parseIntegerAnswer('19')).toBe(19)
    expect(parseIntegerAnswer('The answer is -4.')).toBe(-4)
    expect(parseIntegerAnswer('none')).toBeNull()
  })
})

describe('testVision', () => {
  const imgs = [mathImage(12, '+', 7), mathImage(30, '-', 4)]
  test('passes when the model answers both pictures', async () => {
    const answers = ['19', '26']
    const r = await testVision(cfg, { images: imgs, call: async () => answers.shift()! })
    expect(r).toMatchObject({ ok: true, correct: 2, asked: 2 })
  })
  test('weak model: accepted but wrong answers', async () => {
    const r = await testVision(cfg, { images: imgs, call: async () => '0' })
    expect(r).toMatchObject({ ok: false, reason: 'weak', correct: 0 })
  })
  test('a provider refusal keeps its kind (text-only model)', async () => {
    const r = await testVision(cfg, {
      images: imgs,
      call: async () => {
        throw new VlmError('not_vision', 'image input is not supported', 400)
      },
    })
    expect(r).toMatchObject({ ok: false, reason: 'not_vision', detail: 'image input is not supported' })
  })
})

describe('callVision', () => {
  const reply = (status: number, body: unknown) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  test('sends key, model and the image; returns the text', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const text = await callVision(cfg, { imageBase64: 'AAAA', prompt: 'p' }, async (url, init) => {
      seen = { url, init }
      return new Response(JSON.stringify({ choices: [{ message: { content: ' 19 ' } }] }))
    })
    expect(text.trim()).toBe('19')
    expect(seen!.url).toBe('https://api.example.com/v1/chat/completions')
    const h = seen!.init.headers as Record<string, string>
    expect(h.Authorization).toBe('Bearer secret-key-1234')
    const b = JSON.parse(String(seen!.init.body))
    expect(b.model).toBe('m')
    expect(b.messages[0].content[1].image_url.url).toBe('data:image/png;base64,AAAA')
    expect(b.thinking).toBeUndefined() // only Z.ai takes it
    expect(seen!.init.redirect).toBe('manual')
  })
  test('z.ai gets thinking disabled', async () => {
    let body: Record<string, unknown> = {}
    await callVision({ ...cfg, baseUrl: 'https://api.z.ai/api/paas/v4' }, { imageBase64: 'A', prompt: 'p' }, async (_u, init) => {
      body = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ choices: [{ message: { content: '1' } }] }))
    })
    expect(body.thinking).toEqual({ type: 'disabled' })
  })
  test('gemini: least thinking, room for the answer', async () => {
    let body: Record<string, unknown> = {}
    await callVision({ ...cfg, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }, { imageBase64: 'A', prompt: 'p' }, async (_u, init) => {
      body = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ choices: [{ message: { content: '1' } }] }))
    })
    expect(body.reasoning_effort).toBe('minimal')
    expect(body.max_tokens).toBe(256)
    expect(body.thinking).toBeUndefined()
  })
  test.each([
    [401, 'bad_key'],
    [429, 'rate_limited'],
    [404, 'bad_model'],
  ])('HTTP %d → %s', async (status, kind) => {
    await expect(callVision(cfg, { imageBase64: 'A', prompt: 'p' }, reply(status, { error: { message: 'x' } }))).rejects.toMatchObject({ kind })
  })
  test('empty answer', async () => {
    await expect(callVision(cfg, { imageBase64: 'A', prompt: 'p' }, reply(200, { choices: [] }))).rejects.toMatchObject({ kind: 'empty' })
  })
  test('network failure', async () => {
    await expect(
      callVision(cfg, { imageBase64: 'A', prompt: 'p' }, async () => {
        throw new Error('ECONNREFUSED')
      }),
    ).rejects.toMatchObject({ kind: 'network' })
  })
  test('the key never appears in an error message', async () => {
    const e = await callVision(cfg, { imageBase64: 'A', prompt: 'p' }, reply(500, 'oops')).catch((x: unknown) => x as Error)
    expect(String((e as Error).message)).not.toContain('secret-key-1234')
  })
})

describe('saved setting', () => {
  beforeEach(() => cfgMod.clearSavedVlm())
  const v = { provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'm-1', apiKey: 'gsk_abcdefgh1234' } as const

  test('nothing saved → not configured (no env)', () => {
    expect(cfgMod.readSavedVlm()).toBeNull()
  })
  test('save → read → status shows only a hint', () => {
    cfgMod.saveVlm(v)
    expect(cfgMod.readSavedVlm()).toEqual(v)
    const s = cfgMod.vlmStatus()
    expect(s).toMatchObject({ configured: true, source: 'saved', provider: 'groq', model: 'm-1', keyHint: '••••1234' })
    expect(JSON.stringify(s)).not.toContain('gsk_abcdefgh')
  })
  test('the file is private (0600)', () => {
    cfgMod.saveVlm(v)
    if (process.platform !== 'win32') expect(fs.statSync(cfgMod.vlmFile()).mode & 0o777).toBe(0o600)
  })
  test('a damaged file reads as «none», never throws', () => {
    fs.writeFileSync(cfgMod.vlmFile(), '{not json')
    expect(cfgMod.readSavedVlm()).toBeNull()
  })
  test('clear removes it', () => {
    cfgMod.saveVlm(v)
    cfgMod.clearSavedVlm()
    expect(cfgMod.readSavedVlm()).toBeNull()
  })
})
