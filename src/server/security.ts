/**
 * Request-origin security — the checks that make a LOCALHOST tool safe to run with background jobs.
 *
 * The app has no login (single operator, localhost) and some routes now do real work when called: start / pause /
 * cancel scraping, `git pull` + restart (settings/update), change the worker list. A private tool on localhost is still
 * reachable by (1) any web page the operator has open (cross-site requests to http://localhost:3000), (2) DNS
 * rebinding (a hostile domain that resolves to 127.0.0.1 and then talks to the app as «same origin»), and (3) other
 * machines on the LAN if the server listens on every interface. These pure functions are the fix for (1) and (2);
 * (3) is the loopback bind in scripts/supervisor.mjs and package.json.
 *
 * Pure and dependency-free so it is unit-tested (src/server/__tests__/security.test.ts). Wired into `guard()` in
 * middleware.ts — every /api route goes through it.
 */

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1']

/** The hostname of a Host header, lower-case, without the port. */
export function hostnameOf(hostHeader: string | null | undefined): string {
  const h = (hostHeader ?? '').trim().toLowerCase()
  if (!h) return ''
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1) // [::1]:3000
  return h.split(':')[0]
}

/**
 * DNS-rebinding guard: the Host header must name this machine. Anything else (an attacker's domain pointed at
 * 127.0.0.1) is refused. `extra` = APP_ALLOWED_HOSTS for a deliberate LAN / reverse-proxy setup.
 */
export function hostAllowed(hostHeader: string | null | undefined, extra: string[] = []): boolean {
  const name = hostnameOf(hostHeader)
  if (!name) return false
  return LOOPBACK_HOSTS.includes(name) || extra.map((e) => e.trim().toLowerCase()).includes(name)
}

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

/**
 * CSRF guard for state-changing requests: a browser tells us where the request came from (`Sec-Fetch-Site`, `Origin`),
 * and it must be this same site. Requests with neither header (curl, scripts) are not browser-driven, so they cannot be
 * cross-site request forgeries; the token (when configured) is what protects those.
 * Returns the reason a request is refused, or null when it is fine.
 */
export function crossSiteReason(method: string, headers: { get(name: string): string | null }): string | null {
  if (SAFE_METHODS.includes(method.toUpperCase())) return null
  const site = headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return `Sec-Fetch-Site: ${site}`
  const origin = headers.get('origin')
  if (origin) {
    let originHost = ''
    try {
      originHost = new URL(origin).host.toLowerCase()
    } catch {
      return 'Origin: unparseable'
    }
    const host = (headers.get('host') ?? '').trim().toLowerCase()
    if (!host || originHost !== host) return `Origin: ${origin}`
  }
  return null
}

/**
 * Routes that change the machine or the app (git pull + restart, worker list, Tor) also need this header. A custom
 * header cannot be sent cross-site without a CORS preflight the app never grants, so a forged form or `fetch` from
 * another page cannot carry it — a second, independent lock on the dangerous doors.
 */
export const PRIVILEGED_HEADER = 'x-sud-action'
export const PRIVILEGED_VALUE = '1'

export function privilegedHeaderOk(headers: { get(name: string): string | null }): boolean {
  return headers.get(PRIVILEGED_HEADER) === PRIVILEGED_VALUE
}

/** Largest request body any route accepts (the biggest legitimate payload is a few hundred KB of JSON). */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

/** True when the declared body size is over the limit (a chunked body has no declared size; JSON parse limits cover that). */
export function bodyTooLarge(headers: { get(name: string): string | null }, max = MAX_BODY_BYTES): boolean {
  const n = Number(headers.get('content-length'))
  return Number.isFinite(n) && n > max
}
