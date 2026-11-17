import { describe, expect, mock, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { presenceSnapshot, recordBeat, recordBye, TAB_STALE_MS } from '../presence'

mock.module('server-only', () => ({}))
const { GET, POST } = await import('@/app/api/presence/route')

const fresh = (t0 = 1_000_000) => ({ startedAt: t0, tabs: new Map<string, number>(), everSeen: false, lastActivity: t0 })

describe('presence', () => {
  test('a ping opens a window, a bye closes it, and idle time counts from the bye', () => {
    const s = fresh()
    recordBeat('tab-aaaaaaaa', 1_010_000, s)
    expect(presenceSnapshot(1_020_000, s)).toMatchObject({ openTabs: 1, idleMs: 0, everSeen: true })
    recordBye('tab-aaaaaaaa', 1_030_000, s)
    expect(presenceSnapshot(1_100_000, s)).toMatchObject({ openTabs: 0, idleMs: 70_000 })
  })
  test('two windows: closing one keeps the app «open»', () => {
    const s = fresh()
    recordBeat('tab-aaaaaaaa', 1_010_000, s)
    recordBeat('tab-bbbbbbbb', 1_011_000, s)
    recordBye('tab-aaaaaaaa', 1_020_000, s)
    expect(presenceSnapshot(1_025_000, s).openTabs).toBe(1)
  })
  test('a window that vanished without a bye is forgotten after the stale time', () => {
    const s = fresh()
    recordBeat('tab-aaaaaaaa', 1_010_000, s)
    expect(presenceSnapshot(1_010_000 + TAB_STALE_MS - 1, s).openTabs).toBe(1)
    const later = presenceSnapshot(1_010_000 + TAB_STALE_MS + 1, s)
    expect(later.openTabs).toBe(0)
    expect(later.idleMs).toBeGreaterThan(TAB_STALE_MS)
  })
  test('a server nobody opened reports everSeen=false and its uptime', () => {
    const snap = presenceSnapshot(1_500_000, fresh())
    expect(snap).toMatchObject({ everSeen: false, openTabs: 0, uptimeMs: 500_000 })
  })
  test('the id list cannot grow without bound', () => {
    const s = fresh()
    for (let i = 0; i < 500; i++) recordBeat(`tab-${String(i).padStart(8, '0')}`, 1_000_000 + i, s)
    expect(s.tabs.size).toBeLessThanOrEqual(50)
  })
})

describe('/api/presence route', () => {
  const req = (method: string, body?: unknown, host = 'localhost:3000') =>
    new NextRequest('http://localhost:3000/api/presence', { method, headers: { host, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

  test('a ping is accepted; a malformed id or body is refused', async () => {
    expect((await POST(req('POST', { id: 'route-test-0001' }))).status).toBe(200)
    expect((await POST(req('POST', { id: 'short' }))).status).toBe(400)
    expect((await POST(req('POST', { id: '../../etc/passwd-xx' }))).status).toBe(400)
    expect((await POST(req('POST', 'not an object'))).status).toBe(400)
  })
  test('GET answers what the supervisor needs', async () => {
    await POST(req('POST', { id: 'route-test-0002' }))
    const j = await (await GET(req('GET'))).json()
    expect(j.ok).toBe(true)
    expect(j.data.openTabs).toBeGreaterThanOrEqual(1)
    expect(typeof j.data.busy).toBe('boolean')
    expect(j.data).toHaveProperty('idleMs')
    await POST(req('POST', { id: 'route-test-0002', bye: true }))
  })
  test('a foreign Host is refused like every other route', async () => {
    expect((await GET(req('GET', undefined, 'evil.example'))).status).toBe(403)
  })
})
