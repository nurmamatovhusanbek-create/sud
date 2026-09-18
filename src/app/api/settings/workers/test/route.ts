/**
 * v204 (P-B): POST /api/settings/workers/test   Body: { url: string, timeoutMs?: number }
 *
 * Proves a CF Worker can reach a real sud-adjacent endpoint and returns a
 * classified result the Workers UI already labels (REASON_LABELS in
 * settings-view.tsx). On a known worker it also writes the result back to
 * workers.json so the row dot/subtext update.
 *
 * Probe target: jadvalapi.sud.uz ECONOMIC findByTin for a known-active STIR —
 * captcha-free, not rate-limited, and exactly the kind of subrequest the
 * workers perform for the court scraper. (v204 initially probed
 * admin.chamber.uz, but live testing on 2026-09 showed intermittent CF 525s
 * from the workers to chamber; jadvalapi stayed stable all session.)
 */

import { NextResponse } from 'next/server'
import { guard } from '@/server/middleware'
import {
  normalizeWorkerUrl,
  updateWorkerTestResult,
  getWorkerUrls,
} from '@/lib/workers-config'

const PROBE_TARGET =
  'https://jadvalapi.sud.uz/online-monitoring/ECONOMIC/findByTin/302678824'

type Reason =
  | 'not_https'
  | 'timeout'
  | 'network_error'
  | 'http_502'
  | 'http_5xx'
  | 'http_4xx'
  | 'html_response'
  | 'non_json'
  | 'wrong_shape'

async function POST_impl(request: Request) {
  let body: { url?: string; timeoutMs?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'non_json', detail: 'invalid body' },
      { status: 400 },
    )
  }

  const norm = normalizeWorkerUrl((body.url || '').trim())
  if (!norm) return finish(body.url || '', { ok: false, reason: 'not_https' })

  const timeoutMs = Math.min(Math.max(body.timeoutMs ?? 10000, 2000), 20000)
  const started = Date.now()

  try {
    const res = await fetch(norm + PROBE_TARGET, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        Origin: 'https://my.sud.uz',
        Referer: 'https://my.sud.uz/',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const responseMs = Date.now() - started

    if (!res.ok) {
      const reason: Reason =
        res.status === 502
          ? 'http_502'
          : res.status >= 500
            ? 'http_5xx'
            : 'http_4xx'
      return finish(norm, { ok: false, reason, status: res.status, responseMs })
    }

    const text = await res.text()
    const head = text.trimStart()[0]
    if (head === '<') {
      return finish(norm, {
        ok: false,
        reason: 'html_response',
        responseMs,
        detail: 'Worker returned HTML — proxy.js not forwarding.',
      })
    }

    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      return finish(norm, { ok: false, reason: 'non_json', responseMs })
    }
    // The court API answers with an ARRAY of cases (or { data: [...] }).
    const arr = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown>)?.data)
        ? ((data as Record<string, unknown>).data as unknown[])
        : null
    if (!arr) {
      return finish(norm, {
        ok: false,
        reason: 'wrong_shape',
        responseMs,
        detail: 'Expected a JSON array of cases.',
      })
    }

    return finish(norm, { ok: true, responseMs, caseCount: arr.length })
  } catch (e) {
    const responseMs = Date.now() - started
    const isTimeout = e instanceof DOMException && e.name === 'TimeoutError'
    return finish(norm, {
      ok: false,
      reason: isTimeout ? 'timeout' : 'network_error',
      responseMs,
      detail: e instanceof Error ? e.message : String(e),
    })
  }
}

/** Persist the result on known workers, then return it. */
function finish(
  url: string,
  result: {
    ok: boolean
    reason?: Reason
    status?: number
    responseMs?: number
    caseCount?: number
    detail?: string
  },
) {
  try {
    const known = new Set(getWorkerUrls())
    if (known.has(url)) {
      updateWorkerTestResult(
        url,
        result.ok ? 'ok' : 'fail',
        result.ok
          ? `${result.responseMs ?? '-'}ms`
          : (result.reason ?? 'fail'),
      )
    }
  } catch {
    /* best-effort */
  }
  return NextResponse.json(result, { status: 200 })
}

export const POST = guard(POST_impl)
