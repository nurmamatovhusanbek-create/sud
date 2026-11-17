import { describe, expect, test } from 'bun:test'
import { normalizeWorkerUrl } from '../workers-config'

describe('normalizeWorkerUrl', () => {
  test('a worker is https on a public name, root path, no credentials, query or fragment', () => {
    expect(normalizeWorkerUrl('https://sud-proxy.me.workers.dev')).toBe('https://sud-proxy.me.workers.dev/')
    for (const bad of ['http://a.workers.dev', 'https://a.workers.dev/p', 'https://u@a.workers.dev', 'https://a.workers.dev/?x=1', 'https://a.workers.dev/#f', 'https://127.0.0.1', 'https://localhost', 'https://10.0.0.1', '']) {
      expect(normalizeWorkerUrl(bad)).toBeNull()
    }
  })
  test('a worker is always on port 443: another port would let the field probe any port of a public host', () => {
    expect(normalizeWorkerUrl('https://a.workers.dev:443')).toBe('https://a.workers.dev/')
    for (const port of [444, 8443, 22, 6379, 80]) expect(normalizeWorkerUrl(`https://a.workers.dev:${port}`)).toBeNull()
  })
})
