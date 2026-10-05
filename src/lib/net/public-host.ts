/**
 * «Is this host really a public one?» for worker URLs.
 *
 * `workers-config.normalizeWorkerUrl` only looks at the NAME (https, no IP literal, no `localhost`, no internal suffix).
 * A name can still point inside: `127.0.0.1.nip.io`, `localtest.me`, or any domain whose owner sets an A record to
 * 10.x / 127.x / 169.254.169.254 (cloud metadata). A worker URL is fetched FROM this machine («test worker») and every
 * scrape is routed through it, so the address it resolves to is checked too, before it is accepted. Server-only.
 */

import dns from 'node:dns/promises'
import net from 'node:net'

/** Loopback, private, link-local, CGNAT, unspecified, multicast, reserved, and the IPv6 equivalents (incl. IPv4-mapped). */
export function isPrivateAddress(ip: string): boolean {
  const kind = net.isIP(ip)
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 || // «this network»
      a === 10 || // private
      a === 127 || // loopback
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 192 && b === 0) || // IETF protocol assignments, TEST-NET-1
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 // multicast, reserved, broadcast
    )
  }
  if (kind === 6) {
    const h = ip.toLowerCase()
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h) // IPv4-mapped: judge the embedded v4
    if (mapped) return isPrivateAddress(mapped[1])
    return (
      h === '::' ||
      h === '::1' ||
      /^f[cd]/.test(h) || // fc00::/7 unique local
      /^fe[89ab]/.test(h) || // fe80::/10 link-local
      /^ff/.test(h) || // multicast
      h.startsWith('2001:db8') // documentation
    )
  }
  return true // not an address at all: never treat as public
}

export type Lookup = (hostname: string) => Promise<{ address: string }[]>

const systemLookup: Lookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true })

export type HostCheck = { ok: true } | { ok: false; reason: 'unresolved' | 'private'; detail: string }

/** Resolve `hostname` and refuse it when ANY of its addresses is not public. */
export async function checkPublicHost(hostname: string, lookup: Lookup = systemLookup): Promise<HostCheck> {
  let addrs: { address: string }[]
  try {
    addrs = await lookup(hostname)
  } catch (e) {
    return { ok: false, reason: 'unresolved', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!addrs.length) return { ok: false, reason: 'unresolved', detail: 'no address' }
  const bad = addrs.find((a) => isPrivateAddress(a.address))
  if (bad) return { ok: false, reason: 'private', detail: bad.address }
  return { ok: true }
}
