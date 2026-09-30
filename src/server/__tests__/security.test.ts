import { describe, expect, test } from 'bun:test'
import { bodyTooLarge, crossSiteReason, hostAllowed, hostnameOf, privilegedHeaderOk } from '../security'
import { isPublicDnsName, normalizeWorkerUrl } from '@/lib/workers-config'

const H = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null })

describe('Host header (DNS-rebinding guard)', () => {
  test('loopback names are allowed, with or without a port', () => {
    for (const h of ['localhost:3000', 'LOCALHOST', '127.0.0.1:3000', '[::1]:3000']) expect(hostAllowed(h)).toBe(true)
  })
  test('anything else — an attacker domain resolving to 127.0.0.1, a LAN IP — is refused', () => {
    for (const h of ['evil.example', 'evil.example:3000', '192.168.1.5:3000', 'localhost.evil.example', '', null, undefined]) expect(hostAllowed(h as string)).toBe(false)
  })
  test('APP_ALLOWED_HOSTS opens exactly the listed names', () => {
    expect(hostAllowed('sud.lan:3000', ['sud.lan'])).toBe(true)
    expect(hostAllowed('other.lan', ['sud.lan'])).toBe(false)
  })
  test('hostnameOf strips ports and keeps IPv6 brackets', () => {
    expect(hostnameOf('Example.com:8080')).toBe('example.com')
    expect(hostnameOf('[::1]:3000')).toBe('[::1]')
  })
})

describe('cross-site (CSRF) guard for state-changing requests', () => {
  test('safe methods are never blocked here', () => {
    expect(crossSiteReason('GET', H({ 'sec-fetch-site': 'cross-site' }))).toBeNull()
  })
  test('a browser POST from another site is refused, from this site it passes', () => {
    expect(crossSiteReason('POST', H({ 'sec-fetch-site': 'cross-site', host: 'localhost:3000' }))).toContain('cross-site')
    expect(crossSiteReason('POST', H({ 'sec-fetch-site': 'same-site', host: 'localhost:3000' }))).not.toBeNull() // a sibling subdomain is not us
    expect(crossSiteReason('POST', H({ 'sec-fetch-site': 'same-origin', host: 'localhost:3000' }))).toBeNull()
    expect(crossSiteReason('POST', H({ 'sec-fetch-site': 'none', host: 'localhost:3000' }))).toBeNull()
  })
  test('Origin must match Host (older browsers, or no Sec-Fetch-Site)', () => {
    expect(crossSiteReason('DELETE', H({ origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBeNull()
    expect(crossSiteReason('POST', H({ origin: 'https://evil.example', host: 'localhost:3000' }))).toContain('Origin')
    expect(crossSiteReason('POST', H({ origin: 'null', host: 'localhost:3000' }))).not.toBeNull()
    expect(crossSiteReason('POST', H({ origin: 'http://localhost:4000', host: 'localhost:3000' }))).not.toBeNull() // another local app
  })
  test('a request with no browser headers (curl, a script) is not a forged browser request', () => {
    expect(crossSiteReason('POST', H({ host: 'localhost:3000' }))).toBeNull()
  })
})

describe('privileged header', () => {
  test('only the exact confirmation value passes', () => {
    expect(privilegedHeaderOk(H({ 'x-sud-action': '1' }))).toBe(true)
    expect(privilegedHeaderOk(H({ 'x-sud-action': 'true' }))).toBe(false)
    expect(privilegedHeaderOk(H({}))).toBe(false)
  })
})

describe('worker URLs (SSRF guard)', () => {
  test('public https DNS names are accepted', () => {
    expect(normalizeWorkerUrl('https://broad-field-f2b0.uzwebfox.workers.dev')).toBe('https://broad-field-f2b0.uzwebfox.workers.dev/')
    expect(isPublicDnsName('proxy.example.com')).toBe(true)
  })
  test('IP literals, localhost, internal names, credentials and query strings are refused', () => {
    for (const u of [
      'https://127.0.0.1', 'https://192.168.0.10', 'https://169.254.169.254', 'https://[::1]', 'https://localhost', 'https://intranet',
      'https://box.internal', 'https://printer.local', 'https://user:pw@x.example.com', 'https://x.example.com/?a=1', 'http://x.example.com',
    ]) expect(normalizeWorkerUrl(u)).toBeNull()
  })
})

describe('request size', () => {
  test('an oversized declared body is refused, normal / undeclared ones pass', () => {
    expect(bodyTooLarge(H({ 'content-length': String(9 * 1024 * 1024) }))).toBe(true)
    expect(bodyTooLarge(H({ 'content-length': '1200' }))).toBe(false)
    expect(bodyTooLarge(H({}))).toBe(false)
  })
})
