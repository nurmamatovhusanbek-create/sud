import { describe, expect, test } from 'bun:test'
import { classifyVlmHttp, keyHint, normalizeBaseUrl, presetOf, validateVlmInput, VLM_PRESETS } from '../vlm'

describe('vlm presets', () => {
  test('every preset with a URL is a valid base URL', () => {
    for (const p of VLM_PRESETS.filter((x) => x.baseUrl)) expect(normalizeBaseUrl(p.baseUrl)).toBe(p.baseUrl)
  })
  test('unknown provider falls back to custom', () => {
    expect(presetOf('custom').baseUrl).toBe('')
  })
})

describe('normalizeBaseUrl', () => {
  test('strips trailing slash', () => expect(normalizeBaseUrl('https://api.groq.com/openai/v1/')).toBe('https://api.groq.com/openai/v1'))
  test.each(['http://api.x.com/v1', 'https://127.0.0.1/v1', 'https://localhost/v1', 'https://u:p@api.x.com/v1', 'https://api.x.com/v1?a=1', 'https://api.x.internal/v1', 'ftp://a.b', 'nope'])('refuses %s', (u) => {
    expect(normalizeBaseUrl(u)).toBeNull()
  })
})

describe('validateVlmInput', () => {
  const good = { provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'm-1', apiKey: 'gsk_abcdefgh' } as const
  test('accepts a good setting and trims the key', () => {
    const r = validateVlmInput({ ...good, apiKey: ' gsk_abcdefgh ' })
    expect(r.ok && r.value.apiKey).toBe('gsk_abcdefgh')
  })
  test.each([
    [{ provider: 'x' }, 'bad_provider'],
    [{ baseUrl: 'http://a.b' }, 'bad_url'],
    [{ model: '' }, 'no_model'],
    [{ model: 'a b' }, 'no_model'],
    [{ apiKey: '' }, 'no_key'],
    [{ apiKey: 'short' }, 'bad_key'],
    [{ apiKey: 'has space inside' }, 'bad_key'],
    [{ apiKey: 'line\nbreak1234' }, 'bad_key'],
  ] as [object, string][])('refuses %j', (patch, error) => {
    const r = validateVlmInput({ ...good, ...patch } as never)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(String(r.error)).toBe(error)
  })
})

test('keyHint never shows more than the last four characters', () => {
  expect(keyHint('gsk_abcdefgh1234')).toBe('••••1234')
  expect(keyHint('short')).toBe('••••')
})

describe('classifyVlmHttp', () => {
  test('keys, limits', () => {
    expect(classifyVlmHttp(401, '')).toBe('bad_key')
    expect(classifyVlmHttp(403, '')).toBe('bad_key')
    expect(classifyVlmHttp(429, '')).toBe('rate_limited')
  })
  test('model not found', () => {
    expect(classifyVlmHttp(404, '')).toBe('bad_model')
    expect(classifyVlmHttp(400, '{"error":{"message":"The model `x` does not exist"}}')).toBe('bad_model')
  })
  test('a text-only model refusing an image', () => {
    expect(classifyVlmHttp(400, '{"error":{"message":"image input is not supported by this model"}}')).toBe('not_vision')
    expect(classifyVlmHttp(400, 'messages[0].content: unsupported content type image_url')).toBe('not_vision')
  })
  test('anything else', () => {
    expect(classifyVlmHttp(500, 'boom')).toBe('http_error')
  })
})
