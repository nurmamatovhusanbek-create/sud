import { describe, expect, test } from 'bun:test'
import { isTrustedWorker, trustedAccounts, workerAccount } from '../worker-trust'

const DEFAULTS = [
  'https://broad-field-f2b0.uzwebfox.workers.dev/',
  'https://orange-darkness-8843.najimsheikh071.workers.dev/',
  'https://blue-haze-3834.nurmamatovhusanbek.workers.dev/',
]

describe('worker trust (whose worker is it?)', () => {
  test('the account is read from the *.workers.dev name; a custom domain has none', () => {
    expect(workerAccount('https://blue-haze-3834.nurmamatovhusanbek.workers.dev/')).toBe('nurmamatovhusanbek')
    expect(workerAccount('https://x.UZWEBFOX.workers.dev')).toBe('uzwebfox')
    for (const u of ['https://proxy.example.com', 'https://workers.dev', 'https://a.b.c.workers.dev', 'not a url', '']) expect(workerAccount(u)).toBeNull()
  })
  test('the trusted set is the default pool\'s accounts plus the env list (garbage entries ignored)', () => {
    const t = trustedAccounts(DEFAULTS, [' friend ', 'BAD ACCOUNT!', '', 'ok-one'])
    expect([...t].sort()).toEqual(['friend', 'najimsheikh071', 'nurmamatovhusanbek', 'ok-one', 'uzwebfox'])
  })
  test('a worker on a named account is trusted; any other account, and any custom domain, is not', () => {
    const t = trustedAccounts(DEFAULTS)
    expect(isTrustedWorker('https://wild-hall-04ae.uzwebfox.workers.dev/', t)).toBe(true)
    expect(isTrustedWorker('https://someone-else.stranger.workers.dev/', t)).toBe(false)
    expect(isTrustedWorker('https://proxy.example.com/', t)).toBe(false)
    expect(isTrustedWorker('https://a.nurmamatovhusanbek.workers.dev.evil.com/', t)).toBe(false) // a look-alike host
  })
})
