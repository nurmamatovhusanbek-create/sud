import { describe, expect, test } from 'bun:test'
import { checkPublicHost, isPrivateAddress } from '../net/public-host'

describe('isPrivateAddress', () => {
  test.each([
    '0.0.0.0', '10.1.2.3', '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '100.127.0.1',
    '224.0.0.1', '255.255.255.255', '198.18.0.1', '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1',
    'not-an-ip', '',
  ])('%s is not public', (ip) => expect(isPrivateAddress(ip)).toBe(true))

  test.each(['1.1.1.1', '8.8.8.8', '104.16.0.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])('%s is public', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  )
})

describe('checkPublicHost (a name that points inside)', () => {
  const to = (...addrs: string[]) => async () => addrs.map((address) => ({ address }))

  test('a name resolving to public addresses passes', async () => {
    expect(await checkPublicHost('x.workers.dev', to('104.21.5.5', '2606:4700::6810:1'))).toEqual({ ok: true })
  })
  test('a name resolving to loopback / private / metadata is refused (nip.io style)', async () => {
    for (const a of ['127.0.0.1', '10.0.0.7', '169.254.169.254', '::1']) {
      const r = await checkPublicHost('127.0.0.1.nip.io', to(a))
      expect(r).toMatchObject({ ok: false, reason: 'private', detail: a })
    }
  })
  test('ONE private address among public ones is enough to refuse (rebinding-style round robin)', async () => {
    expect(await checkPublicHost('mixed.example.com', to('104.21.5.5', '192.168.0.2'))).toMatchObject({ ok: false, reason: 'private' })
  })
  test('a name that does not resolve is refused as unresolved', async () => {
    expect(await checkPublicHost('nope.example.com', async () => { throw new Error('ENOTFOUND') })).toMatchObject({ ok: false, reason: 'unresolved' })
    expect(await checkPublicHost('empty.example.com', async () => [])).toMatchObject({ ok: false, reason: 'unresolved' })
  })
})
