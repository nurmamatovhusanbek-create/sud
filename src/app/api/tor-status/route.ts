import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import * as path from 'path'
import { isSocksPortOpen, ensureTor, findTorBinaryPath } from '@/lib/tor'
import { guard } from '@/server/middleware'
import { jsonOk } from '@/server/envelope'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 10

/**
 * GET /api/tor-status
 *   -> { available, binaryFound, socksPort, spawning? }
 *
 * `available` = true if the SOCKS proxy is already listening (Tor is running).
 * `binaryFound` = true if a tor binary exists at ./tor/tor.exe (or ./tor/tor).
 *
 * POST /api/tor-status
 *   Triggers `ensureTor()` which spawns the tor binary if it's found but not
 *   yet running. This is called right after installation so Tor starts
 *   immediately without waiting for a search request.
 */
async function GET_impl() {
  const binaryFound = !!findTorBinaryPath()
  const available = await isSocksPortOpen()
  // v208: getTorStatus() (api-client.ts) reads the {ok,data} envelope via the
  // shared request() helper — this used to return a bare object with no `ok`
  // field, so request() always fell through to its "unknown response shape"
  // failure branch and the topbar Tor badge never left its initial
  // 'checking' state, no matter Tor's real status.
  return jsonOk({
    running: available,
    installed: binaryFound,
    port: 9050,
  })
}

async function POST_impl() {
  try {
    const ok = await ensureTor()
    const binaryFound = !!findTorBinaryPath()
    const available = await isSocksPortOpen()
    return NextResponse.json({
      ok,
      available,
      binaryFound,
      message: ok ? 'Tor muvaffaqiyatli ishga tushdi' : 'Tor ishga tushmadi',
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Tor ishga tushmadi' },
      { status: 500 },
    )
  }
}

export const GET = guard(GET_impl)
export const POST = guard(POST_impl)
