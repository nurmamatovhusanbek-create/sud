import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import * as path from 'path'
import { isSocksPortOpen, ensureTor, findTorBinaryPath } from '@/lib/tor'
import { guard } from '@/server/middleware'

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
  return NextResponse.json({
    available,
    binaryFound,
    socksPort: 9050,
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
      message: ok ? 'Tor started successfully' : 'Tor could not start',
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed to start Tor' },
      { status: 500 },
    )
  }
}

export const GET = guard(GET_impl)
export const POST = guard(POST_impl)
