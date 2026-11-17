import { NextResponse, type NextRequest } from 'next/server'
import { hostAllowed } from '@/server/security'

/**
 * The gate in front of EVERYTHING Next serves, not only `/api` (whose handlers have `guard()`).
 *
 *  - DNS-rebinding guard for every path: a hostile domain pointed at 127.0.0.1 could otherwise read the pages, the JS
 *    bundles and Next's own endpoints as «same origin». The Host header must name this machine (APP_ALLOWED_HOSTS widens it
 *    for a deliberate LAN / reverse-proxy setup).
 *  - `/_next/image` is shut: the app uses no `next/image`, and that endpoint has had remote-code-execution advisories
 *    (SVG handling). Nothing legitimate calls it, so nothing may.
 *
 * Runs on every request (no matcher), including `_next/static` and `public/` files, because those are exactly what a
 * rebinding page would fetch. Pure checks only: no I/O, no secrets.
 */
const EXTRA_HOSTS = (process.env.APP_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)

export function proxy(request: NextRequest): NextResponse {
  if (!hostAllowed(request.headers.get('host'), EXTRA_HOSTS)) {
    return new NextResponse('Forbidden: this application is reachable only on this machine.', { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }
  if (request.nextUrl.pathname === '/_next/image' || request.nextUrl.pathname.startsWith('/_next/image/')) {
    return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  return NextResponse.next()
}
