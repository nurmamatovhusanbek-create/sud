/**
 * `fetch` that survives a server which does not send its intermediate certificate.
 *
 *   TypeError: fetch failed — cause: Error: unable to verify the first certificate (UNABLE_TO_VERIFY_LEAF_CERT)
 *
 * Some sud.uz hosts send only their own (leaf) certificate. Browsers do not mind: they download the missing issuer from
 * the certificate's «Authority Information Access» (AIA) URL and carry on. Node does not, so every DIRECT request to such
 * a host (orders list, order PDF, captcha) fails while the same page works in Chrome.
 *
 * What this does, ONLY after a plain fetch failed with exactly that kind of error:
 *   1. read the leaf the server presents (a handshake that is not trusted for anything — nothing is sent over it),
 *   2. download its issuer(s) from the AIA «CA Issuers» URL (public hosts only, size and time capped),
 *   3. accept an issuer only if it really signed the certificate below it,
 *   4. retry the request with Node's bundled trusted roots PLUS those intermediates.
 * Trust is never widened: the chain must still end in a root Node already trusts, and the host name is still checked.
 * Server-only (node:tls / node:https); the result of step 1-3 is cached per host.
 */

import { X509Certificate } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import zlib from 'node:zlib'
import { checkPublicHost, isPrivateAddress } from '@/lib/net/public-host'
import net from 'node:net'

const CHAIN_CODES = new Set(['UNABLE_TO_VERIFY_LEAF_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'])
const MAX_DEPTH = 4
const MAX_CERT_BYTES = 64 * 1024
const AIA_TIMEOUT_MS = 8_000
const CACHE_MS = 6 * 3_600_000

/** Is this (possibly wrapped) error «the server did not give us the chain»? */
export function isChainError(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 5; i++, e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && CHAIN_CODES.has(code)) return true
    const msg = (e as { message?: unknown }).message
    if (typeof msg === 'string' && /unable to verify the first certificate|unable to get local issuer certificate/i.test(msg)) return true
  }
  return false
}

export interface ChainOptions {
  /** trusted root certificates (PEM). Default: Node's bundled list. Tests pass their own root. */
  roots?: () => readonly string[]
  /** tests only: let the AIA download reach a loopback server */
  allowPrivateAia?: boolean
  fetchImpl?: typeof fetch
}

/** Parse the «CA Issuers - URI:…» entries out of `X509Certificate.infoAccess`. */
export function caIssuerUrls(infoAccess: string | undefined): string[] {
  if (!infoAccess) return []
  const out: string[] = []
  for (const line of infoAccess.split('\n')) {
    const m = /^CA Issuers - URI:(\S+)$/.exec(line.trim())
    if (m) out.push(m[1])
  }
  return out
}

function parseCert(buf: Buffer): X509Certificate | null {
  try {
    return new X509Certificate(buf) // DER or PEM
  } catch {
    return null
  }
}

function issuedBy(child: X509Certificate, parent: X509Certificate): boolean {
  try {
    return child.checkIssued(parent) && child.verify(parent.publicKey)
  } catch {
    return false
  }
}

async function downloadCert(rawUrl: string, allowPrivate: boolean): Promise<Buffer | null> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  // the URL comes out of a certificate presented by a remote host: never let it point at this machine or its network
  if (!allowPrivate) {
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (net.isIP(host) ? isPrivateAddress(host) : !(await checkPublicHost(host)).ok) return null
  }
  return new Promise((resolve) => {
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.get(u, { timeout: AIA_TIMEOUT_MS, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        resolve(null)
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_CERT_BYTES) {
          req.destroy()
          resolve(null)
        } else chunks.push(c)
      })
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', () => resolve(null))
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
  })
}

/** The leaf certificate the host presents. The connection is not trusted and carries no data. */
function peekLeaf(host: string, port: number): Promise<X509Certificate | null> {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false, timeout: AIA_TIMEOUT_MS }, () => {
      const leaf = sock.getPeerX509Certificate() ?? null
      sock.destroy()
      resolve(leaf)
    })
    sock.on('timeout', () => {
      sock.destroy()
      resolve(null)
    })
    sock.on('error', () => resolve(null))
  })
}

/** The missing intermediates (PEM) for `host`, leaf-to-root order, or [] when they cannot be found and verified. */
export async function findIntermediates(host: string, port: number, opts: ChainOptions = {}): Promise<string[]> {
  const rootPems = (opts.roots ?? (() => tls.rootCertificates))()
  const roots = rootPems.map((p) => parseCert(Buffer.from(p))).filter((c): c is X509Certificate => !!c)
  let cur = await peekLeaf(host, port)
  const found: string[] = []
  for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
    const child: X509Certificate = cur
    if (roots.some((r) => issuedBy(child, r))) return found // reaches a trusted root: done
    let next: X509Certificate | null = null
    for (const url of caIssuerUrls(child.infoAccess)) {
      const cert = parseCert((await downloadCert(url, !!opts.allowPrivateAia)) ?? Buffer.alloc(0))
      if (cert && issuedBy(child, cert)) {
        next = cert
        break
      }
    }
    if (!next) return [] // chain cannot be completed: do not pretend
    found.push(next.toString())
    cur = next
  }
  return []
}

const cache = new Map<string, { at: number; pems: string[] }>()
export function clearChainCache(): void {
  cache.clear()
}

function toBuffer(body: unknown): Buffer | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof URLSearchParams) return Buffer.from(body.toString())
  if (body instanceof Uint8Array) return Buffer.from(body)
  throw new Error('chain-fetch: unsupported request body')
}

/** The same request over node:https with the repaired trust list; answers like fetch (the body is buffered). */
async function httpsRequest(url: URL, init: RequestInit, ca: string[], hops = 0): Promise<Response> {
  // the SAME header set Node's own fetch sends (plus whatever the caller gave): a firewall in front of the site judges the
  // request by it, and a bare https.request lacks accept-encoding / accept-language / sec-fetch-mode, which looks like a bot
  const headers: Record<string, string> = { 'accept-encoding': 'gzip, deflate', 'accept-language': '*', 'sec-fetch-mode': 'cors', connection: 'keep-alive' }
  new Headers(init.headers).forEach((v, k) => (headers[k] = v))
  const body = toBuffer(init.body)
  if (body && !headers['content-length']) headers['content-length'] = String(body.length)
  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = https.request(url, { method: init.method ?? 'GET', headers, ca, servername: net.isIP(url.hostname) ? undefined : url.hostname, signal: init.signal ?? undefined }, resolve)
    req.on('error', reject)
    req.end(body)
  })
  const status = res.statusCode ?? 0
  const chunks: Buffer[] = []
  for await (const c of res) chunks.push(c as Buffer)
  const outHeaders = new Headers()
  for (const [k, v] of Object.entries(res.headers)) {
    if (Array.isArray(v)) v.forEach((x) => outHeaders.append(k, x))
    else if (v !== undefined) outHeaders.set(k, v)
  }
  const loc = outHeaders.get('location')
  if (init.redirect !== 'manual' && status >= 300 && status < 400 && loc && hops < 5) {
    return httpsRequest(new URL(loc, url), status === 303 ? { ...init, method: 'GET', body: undefined } : init, ca, hops + 1)
  }
  const noBody = status === 204 || status === 205 || status === 304 || (status >= 100 && status < 200)
  let payload = Buffer.concat(chunks)
  const enc = (outHeaders.get('content-encoding') ?? '').toLowerCase().trim()
  if (!noBody && payload.length && enc) {
    const limit = { maxOutputLength: 64 * 1024 * 1024 }
    try {
      if (enc === 'gzip' || enc === 'x-gzip') payload = zlib.gunzipSync(payload, limit)
      else if (enc === 'br') payload = zlib.brotliDecompressSync(payload, limit)
      else if (enc === 'deflate') {
        try {
          payload = zlib.inflateSync(payload, limit)
        } catch {
          payload = zlib.inflateRawSync(payload, limit)
        }
      }
      outHeaders.delete('content-encoding') // the body below is already decoded, like fetch's
      outHeaders.delete('content-length')
    } catch {
      /* not actually compressed (a lying header): hand the bytes over untouched */
    }
  }
  return new Response(noBody ? null : payload, { status, statusText: res.statusMessage ?? '', headers: outHeaders })
}

/** Drop-in for `fetch(url, init)` for DIRECT requests to a host that may not send its intermediate certificate. */
export async function chainFetch(input: string | URL, init: RequestInit = {}, opts: ChainOptions = {}): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch
  const url = new URL(input)
  const key = `${url.hostname}:${url.port || 443}`
  const fresh = (): string[] | null => {
    const hit = cache.get(key)
    return hit && Date.now() - hit.at < CACHE_MS ? hit.pems : null
  }
  const rootPems = (): readonly string[] => (opts.roots ?? (() => tls.rootCertificates))()

  // a host already known to need its intermediates goes straight to the repaired request
  const known = url.protocol === 'https:' ? fresh() : null
  if (known) {
    try {
      return await httpsRequest(url, init, [...rootPems(), ...known])
    } catch (e) {
      if (!isChainError(e)) throw e
      cache.delete(key) // the host changed its certificate: repair again below
    }
  }

  try {
    return await doFetch(url, init)
  } catch (e) {
    if (url.protocol !== 'https:' || !isChainError(e)) throw e
    const pems = await findIntermediates(url.hostname, Number(url.port) || 443, opts)
    if (pems.length === 0) throw e // could not complete the chain: report the ORIGINAL error
    cache.set(key, { at: Date.now(), pems })
    console.warn(`[tls] ${url.hostname} does not send its intermediate certificate; fetched it from the certificate's own AIA URL (${pems.length})`)
    return httpsRequest(url, init, [...rootPems(), ...pems])
  }
}
