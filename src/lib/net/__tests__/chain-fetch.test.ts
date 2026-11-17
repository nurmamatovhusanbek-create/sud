import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import zlib from 'node:zlib'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { caIssuerUrls, chainFetch, clearChainCache, findIntermediates, isChainError } from '../chain-fetch'

/**
 * The real failure: a server that sends ONLY its leaf certificate. We rebuild it with openssl: root → intermediate →
 * leaf (whose AIA «CA Issuers» URL points at a local file server), an HTTPS server that presents just the leaf, and a
 * root list that holds only our test root. Skipped where openssl is not installed.
 */
const hasOpenssl = spawnSync('openssl', ['version']).status === 0

describe.skipIf(!hasOpenssl)('chainFetch (server without its intermediate)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chain-'))
  const sh = (...a: string[]) => {
    const r = spawnSync('openssl', a, { cwd: dir })
    if (r.status !== 0) throw new Error(`openssl ${a.join(' ')}: ${r.stderr}`)
  }
  let aia: http.Server
  let srv: https.Server
  let port = 0
  let srv2: https.Server
  let port2 = 0
  let rootPem = ''
  let otherRootPem = ''
  const roots = () => [rootPem]
  const opts = () => ({ roots, allowPrivateAia: true })

  beforeAll(async () => {
    // serves the intermediate (DER) and an unrelated certificate (the other root) at a second path
    aia = http.createServer((req, res) => {
      const f = req.url === '/int.cer' ? 'int.der' : req.url === '/wrong.cer' ? 'other.der' : ''
      if (!f) return void res.writeHead(404).end()
      res.writeHead(200).end(readFileSync(join(dir, f)))
    })
    await new Promise<void>((r) => aia.listen(0, '127.0.0.1', r))
    const aiaPort = (aia.address() as AddressInfo).port

    sh('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-subj', '/CN=Test Root', '-days', '3', '-addext', 'basicConstraints=critical,CA:TRUE')
    sh('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'other.key', '-out', 'other.pem', '-subj', '/CN=Other Root', '-days', '3', '-addext', 'basicConstraints=critical,CA:TRUE')
    sh('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'int.key', '-out', 'int.csr', '-subj', '/CN=Test Intermediate')
    writeFileSync(join(dir, 'int.ext'), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n')
    sh('x509', '-req', '-in', 'int.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'int.pem', '-days', '3', '-extfile', 'int.ext')
    sh('x509', '-in', 'int.pem', '-outform', 'der', '-out', 'int.der')
    sh('x509', '-in', 'other.pem', '-outform', 'der', '-out', 'other.der')
    sh('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=127.0.0.1')
    writeFileSync(
      join(dir, 'leaf.ext'),
      `subjectAltName=IP:127.0.0.1\nbasicConstraints=CA:FALSE\nauthorityInfoAccess=caIssuers;URI:http://127.0.0.1:${aiaPort}/int.cer\n`,
    )
    sh('x509', '-req', '-in', 'leaf.csr', '-CA', 'int.pem', '-CAkey', 'int.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '3', '-extfile', 'leaf.ext')
    rootPem = readFileSync(join(dir, 'root.pem'), 'utf8')
    otherRootPem = readFileSync(join(dir, 'other.pem'), 'utf8')

    // the leaf ONLY: exactly what the broken host sends
    srv = https.createServer({ key: readFileSync(join(dir, 'leaf.key')), cert: readFileSync(join(dir, 'leaf.pem')) }, (req, res) => {
      if (req.url === '/redir') return void res.writeHead(302, { location: '/ok' }).end()
      if (req.url === '/headers') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(req.headers))
      if (req.url === '/gz') return void res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }).end(zlib.gzipSync('{"gz":true}'))
      res.writeHead(200, { 'content-type': 'text/plain', 'x-seen': req.headers['x-test'] ?? '' }).end(`ok ${req.method} ${req.url}`)
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    port = (srv.address() as AddressInfo).port

    // a second leaf signed by the real intermediate, but whose AIA URL hands out an UNRELATED certificate
    sh('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf2.key', '-out', 'leaf2.csr', '-subj', '/CN=127.0.0.1')
    writeFileSync(join(dir, 'leaf2.ext'), `subjectAltName=IP:127.0.0.1\nbasicConstraints=CA:FALSE\nauthorityInfoAccess=caIssuers;URI:http://127.0.0.1:${aiaPort}/wrong.cer\n`)
    sh('x509', '-req', '-in', 'leaf2.csr', '-CA', 'int.pem', '-CAkey', 'int.key', '-CAcreateserial', '-out', 'leaf2.pem', '-days', '3', '-extfile', 'leaf2.ext')
    srv2 = https.createServer({ key: readFileSync(join(dir, 'leaf2.key')), cert: readFileSync(join(dir, 'leaf2.pem')) }, (_q, res) => void res.writeHead(200).end('no'))
    await new Promise<void>((r) => srv2.listen(0, '127.0.0.1', r))
    port2 = (srv2.address() as AddressInfo).port
  })
  afterAll(() => {
    srv?.close()
    srv2?.close()
    aia?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const url = (p = '/ok') => `https://127.0.0.1:${port}${p}`

  test('a plain fetch fails with exactly the reported error', async () => {
    const err = await fetch(url()).then(() => null, (e) => e)
    expect(err).not.toBeNull()
    expect(isChainError(err)).toBe(true)
  })

  test('chainFetch fetches the missing intermediate and the request succeeds', async () => {
    clearChainCache()
    const res = await chainFetch(url(), { headers: { 'x-test': 'yes' } }, opts())
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok GET /ok')
    expect(res.headers.get('x-seen')).toBe('yes')
  })

  test('the second request goes straight through the repaired path (cached), also redirects', async () => {
    const manual = await chainFetch(url('/redir'), { redirect: 'manual' }, opts())
    expect(manual.status).toBe(302)
    const followed = await chainFetch(url('/redir'), {}, opts())
    expect(await followed.text()).toBe('ok GET /ok')
  })

  test('trust is not widened: a chain that does not end in a trusted root still fails', async () => {
    clearChainCache()
    await expect(chainFetch(url(), {}, { roots: () => [otherRootPem], allowPrivateAia: true })).rejects.toThrow()
  })

  test('an AIA download that is not the real issuer is rejected', async () => {
    clearChainCache()
    expect(await findIntermediates('127.0.0.1', port, opts())).toHaveLength(1) // sanity: the honest chain resolves
    expect(await findIntermediates('127.0.0.1', port2, opts())).toEqual([]) // the unrelated certificate did not sign the leaf
    await expect(chainFetch(`https://127.0.0.1:${port2}/`, {}, opts())).rejects.toThrow()
  })

  test('the AIA URL may not point at this machine unless explicitly allowed', async () => {
    clearChainCache()
    await expect(chainFetch(url(), {}, { roots })).rejects.toThrow() // loopback AIA refused → original error
  })

  test('the repaired request carries the header set Node fetch sends, and a caller header wins', async () => {
    clearChainCache()
    const h = await (await chainFetch(url('/headers'), { headers: { Accept: 'application/json', 'User-Agent': 'UA-test' } }, opts())).json()
    expect(h['accept-encoding']).toBe('gzip, deflate')
    expect(h['accept-language']).toBe('*')
    expect(h['sec-fetch-mode']).toBe('cors')
    expect(h['user-agent']).toBe('UA-test')
    expect(h.accept).toBe('application/json')
  })

  test('a gzip answer is decoded like fetch does', async () => {
    clearChainCache()
    const res = await chainFetch(url('/gz'), {}, opts())
    expect(await res.json()).toEqual({ gz: true })
    expect(res.headers.get('content-encoding')).toBeNull()
  })

  test('a POST body goes through the repaired request', async () => {
    clearChainCache()
    const res = await chainFetch(url('/post'), { method: 'POST', body: 'a=1' }, opts())
    expect(await res.text()).toBe('ok POST /post')
  })
})

describe('helpers', () => {
  test('caIssuerUrls reads only «CA Issuers» entries', () => {
    expect(caIssuerUrls('OCSP - URI:http://ocsp.example/\nCA Issuers - URI:http://ca.example/i.crt\n')).toEqual(['http://ca.example/i.crt'])
    expect(caIssuerUrls(undefined)).toEqual([])
  })
  test('isChainError recognises the code, the message and a wrapped cause, and nothing else', () => {
    expect(isChainError(Object.assign(new Error('x'), { code: 'UNABLE_TO_VERIFY_LEAF_CERT' }))).toBe(true)
    expect(isChainError(new Error('unable to verify the first certificate'))).toBe(true)
    expect(isChainError(new TypeError('fetch failed', { cause: new Error('unable to get local issuer certificate') }))).toBe(true)
    expect(isChainError(new Error('self-signed certificate'))).toBe(false)
    expect(isChainError(new Error('connect ECONNREFUSED'))).toBe(false)
    expect(isChainError(null)).toBe(false)
  })
})
