import { describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { proxy } from '../../proxy'

const req = (path: string, host: string | null) => new NextRequest(`http://localhost:3000${path}`, { headers: host === null ? {} : { host } })

describe('proxy (the gate in front of every path Next serves)', () => {
  test('this machine passes, on pages, bundles and files alike', () => {
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST']) {
      for (const p of ['/', '/_next/static/chunks/a.js', '/favicon.ico', '/api/stats']) {
        expect(proxy(req(p, host)).status).toBe(200) // NextResponse.next()
      }
    }
  })
  test('DNS rebinding: any other Host is refused everywhere, not just on /api', () => {
    for (const host of ['evil.example', 'evil.example:3000', 'localhost.evil.example', '127.0.0.1.nip.io', '192.168.1.5:3000', 'xlocalhost', '']) {
      for (const p of ['/', '/_next/static/chunks/a.js', '/_next/image?url=%2Fx', '/api/settings/update']) {
        expect(proxy(req(p, host)).status).toBe(403)
      }
    }
    expect(proxy(req('/', null)).status).toBe(403) // no Host at all
  })
  test('the image optimizer is shut even for a good Host (the app has no images; it had RCE advisories)', () => {
    expect(proxy(req('/_next/image?url=%2Fa.svg&w=64&q=75', 'localhost:3000')).status).toBe(404)
    expect(proxy(req('/_next/image/', 'localhost:3000')).status).toBe(404)
    expect(proxy(req('/_next/imagery', 'localhost:3000')).status).toBe(200) // only that endpoint
  })
})
