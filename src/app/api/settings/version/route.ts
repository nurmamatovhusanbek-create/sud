/**
 * GET /api/settings/version
 *
 *   (no query)   what is running: { local } only. Instant, touches no network. The restart poll uses this.
 *   ?check=1     the same plus the update check: `git fetch origin main`, then ahead/behind against HEAD
 *                (lib/update-check). Never cached: a commit pushed a second ago is seen. If git cannot reach the remote
 *                the GitHub API is asked (no-cache); if neither answers, `check.error` says why.
 *
 * Response:
 *   { local: { version, sha, branch, dirty, gitAvailable, bootedAt }, check?: UpdateCheck }
 *   bootedAt = when THIS server process started (ms): the update screen waits for a new one (an update restarts the server,
 *   sometimes twice), see lib/update-wait.ts
 */

import { NextResponse } from 'next/server'
import { APP_VERSION } from '@/lib/version'
import { getLocalGitSha, getLocalGitBranch, isWorkingTreeClean } from '@/lib/version-server'
import { githubFetcher, gitRunner, runUpdateCheckShared } from '@/lib/update-check'
import { guard } from '@/server/middleware'

// when this server process started: a restarted server has a later one
const BOOTED_AT = Date.now() - Math.round(process.uptime() * 1000)

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function GET_impl(request: Request) {
  const wantsCheck = new URL(request.url).searchParams.get('check') === '1'

  const localSha = getLocalGitSha()
  const body: Record<string, unknown> = {
    local: {
      version: APP_VERSION,
      sha: localSha,
      branch: getLocalGitBranch(),
      dirty: isWorkingTreeClean() === false,
      gitAvailable: localSha !== null,
      bootedAt: BOOTED_AT,
    },
  }
  if (wantsCheck) {
    body.check = await runUpdateCheckShared({ run: gitRunner(), fetchGithub: githubFetcher, localSha, cwd: process.cwd() })
  }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

export const GET = guard(GET_impl, { rateLimit: false }) // cheap read of the running version: never the budget of the scraping routes
