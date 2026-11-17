import { afterEach, describe, expect, test } from 'bun:test'
import { assertNotWafBlocked, clearWafBlock, noteWafBlock, parseWafBlock, throwUpstreamFailure, WAF_COOLDOWN_MS, wafMessage } from '../waf'

const PAGE =
  '{"page_title":"Web Page Blocked!","display_message":"The page cannot be displayed. Please contact the administrator for additional information.","client_IP":"90.156.160.24","URL":"adolatapi1.sud.uz/publications/list","attack_ID":"20000050",'

afterEach(clearWafBlock)

describe('WAF block page', () => {
  test('is recognised and its id and IP read, even from a cut-off body', () => {
    expect(parseWafBlock(PAGE)).toEqual({ attackId: '20000050', clientIp: '90.156.160.24' })
  })
  test('an ordinary error body or a result list is not a block', () => {
    expect(parseWafBlock('{"timestamp":"x","status":500,"error":"Internal Server Error"}')).toBeNull()
    expect(parseWafBlock('{"content":[],"totalElements":0}')).toBeNull()
    expect(parseWafBlock('')).toBeNull()
  })
  test('the message says what it is, not «HTTP 500»', () => {
    const m = wafMessage({ attackId: '20000050', clientIp: '1.2.3.4' }, 12)
    expect(m).toContain('WAF')
    expect(m).toContain('20000050')
    expect(m).toContain('1.2.3.4')
    expect(m).toContain('12 daqiqa')
    expect(m).not.toContain('HTTP 500')
  })
})

describe('circuit breaker', () => {
  test('after a block every direct request fails fast until the cool-down ends', () => {
    const t0 = 1_000_000
    expect(() => assertNotWafBlocked(t0)).not.toThrow()
    noteWafBlock({ attackId: '20000050', clientIp: '9.9.9.9' }, t0)
    expect(() => assertNotWafBlocked(t0 + 1_000)).toThrow(/WAF/)
    expect(() => assertNotWafBlocked(t0 + WAF_COOLDOWN_MS - 1)).toThrow(/WAF/)
    expect(() => assertNotWafBlocked(t0 + WAF_COOLDOWN_MS + 1)).not.toThrow()
  })
  test('clearing the block lets requests through at once', () => {
    noteWafBlock({ attackId: 'x', clientIp: '' }, 5)
    clearWafBlock()
    expect(() => assertNotWafBlocked(6)).not.toThrow()
  })
})

describe('throwUpstreamFailure (what a failed search turns into)', () => {
  const resp = (body: string, status = 500) => new Response(body, { status })
  test('the firewall page: a WAF error, and the cool-down starts for a direct request', async () => {
    await expect(throwUpstreamFailure(resp(PAGE), 'search (FIRST)', 'c', true)).rejects.toThrow(/WAF.*20000050/)
    expect(() => assertNotWafBlocked()).toThrow(/WAF/) // nothing more is sent
  })
  test('through a worker the block is reported but does not pause anything (another IP)', async () => {
    await expect(throwUpstreamFailure(resp(PAGE), 'search (FIRST)', 'c', false)).rejects.toThrow(/WAF/)
    expect(() => assertNotWafBlocked()).not.toThrow()
  })
  test('an ordinary 500 keeps what the site said and starts no cool-down', async () => {
    await expect(throwUpstreamFailure(resp('{"status":500,"error":"Internal Server Error"}'), 'search (APPEAL)', 'c', true)).rejects.toThrow(
      /search \(APPEAL\): HTTP 500 \u2014 .*Internal Server Error/,
    )
    expect(() => assertNotWafBlocked()).not.toThrow()
  })
})
