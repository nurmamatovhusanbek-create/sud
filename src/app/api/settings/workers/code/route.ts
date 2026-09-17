/**
 * v163: GET /api/settings/workers/code
 *
 * Returns the Cloudflare Worker source code (from cloudflare-worker/proxy.js)
 * so users can copy and deploy their own worker.
 */

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { guard } from '@/server/middleware'

async function GET_impl() {
  try {
    const workerPath = path.resolve(process.cwd(), 'cloudflare-worker', 'proxy.js')
    const code = fs.readFileSync(workerPath, 'utf-8')
    return NextResponse.json({
      ok: true,
      code,
      filename: 'proxy.js',
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'could_not_read', detail: e.message },
      { status: 500 },
    )
  }
}

export const GET = guard(GET_impl)
