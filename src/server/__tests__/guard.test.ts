/**
 * guard() as a whole: what it refuses, and that every refusal and every privileged call leaves a trace.
 * (The pure checks are in security.test.ts; this drives the real wrapper with real requests.)
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { __resetRateLimitsForTests, guard } from '../middleware'
import { __resetSecurityForTests, RING_MAX, recordSecurityEvent, securitySnapshot } from '../audit'

const ok = async () => new Response('fine')
const open = guard(ok)
const door = guard(ok, { privileged: true })
const req = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  new NextRequest(`http://localhost:3000${path}`, { method, headers: { host: 'localhost:3000', ...headers } })

beforeEach(() => {
  __resetSecurityForTests()
  __resetRateLimitsForTests()
})
afterAll(() => __resetRateLimitsForTests())

describe('guard refusals are visible', () => {
  test('a cross-site GET (a hostile page firing a scrape) is refused and counted, without the query', async () => {
    const res = await open(req('/api/bills?inn=302121267', { 'sec-fetch-site': 'cross-site' }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('cross_site')
    const snap = securitySnapshot()
    expect(snap.counts.cross_site).toBe(1)
    expect(snap.recent[0]).toMatchObject({ kind: 'cross_site', method: 'GET', path: '/api/bills' })
    expect(JSON.stringify(snap)).not.toContain('302121267')
  })

  test('the app\'s own same-origin GET passes', async () => {
    expect((await open(req('/api/stats?tin=302121267', { 'sec-fetch-site': 'same-origin' }))).status).toBe(200)
    expect(securitySnapshot().counts.cross_site).toBe(0)
  })

  test('a rebinding Host is refused and counted', async () => {
    const res = await open(new NextRequest('http://evil.example/api/x', { headers: { host: 'evil.example' } }))
    expect(res.status).toBe(403)
    expect(securitySnapshot().recent[0]).toMatchObject({ kind: 'bad_host', detail: 'evil.example' })
  })

  test('a privileged route without the confirmation header is refused; with it, it runs and is logged', async () => {
    expect((await door(req('/api/settings/update', {}, 'POST'))).status).toBe(403)
    expect(securitySnapshot().counts.privileged_header).toBe(1)
    expect((await door(req('/api/settings/update', { 'x-sud-action': '1' }, 'POST'))).status).toBe(200)
    const snap = securitySnapshot()
    expect(snap.counts.privileged_call).toBe(1)
    expect(snap.recent[0]).toMatchObject({ kind: 'privileged_call', method: 'POST', path: '/api/settings/update' })
  })

  test('an oversized body is refused and counted', async () => {
    const res = await open(req('/api/x', { 'content-length': String(9 * 1024 * 1024) }, 'POST'))
    expect(res.status).toBe(413)
    expect(securitySnapshot().counts.too_large).toBe(1)
  })
})

describe('rate limit', () => {
  test('a rotating X-Forwarded-For does not buy a fresh budget (the header is whatever the caller typed)', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 40; i++) statuses.push((await open(req('/api/rl-test', { 'x-forwarded-for': `10.0.0.${i}` }))).status)
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(statuses).toContain(429)
    expect(securitySnapshot().counts.rate_limited).toBeGreaterThan(0)
  })
})

describe('the event ring', () => {
  test('keeps the newest RING_MAX events, newest first, counters keep counting', () => {
    for (let i = 0; i < RING_MAX + 25; i++) recordSecurityEvent('cross_site', 'GET', `http://localhost:3000/api/e${i}`)
    const snap = securitySnapshot()
    expect(snap.recent).toHaveLength(RING_MAX)
    expect(snap.recent[0].path).toBe(`/api/e${RING_MAX + 24}`)
    expect(snap.counts.cross_site).toBe(RING_MAX + 25)
  })

  test('an unparseable URL does not throw', () => {
    expect(() => recordSecurityEvent('bad_host', 'get', 'http://[bad')).not.toThrow()
  })
})
