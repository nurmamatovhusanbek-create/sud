/**
 * GET /api/settings/version
 *
 *   (no query)   what is running: { local } only. Instant, touches no network. The restart poll uses this.
 *   ?check=1     the same plus the update check: `git fetch origin main`, then ahead/behind against HEAD
 *                (lib/update-check). Never cached: a commit pushed a second ago is seen. If git cannot reach the remote
 *                the GitHub API is asked (no-cache); if neither answers, `check.error` says why.
 *
 * Response:
 *   { local: { version, sha, branch, dirty, gitAvailable }, check?: UpdateCheck }
 */

import { NextResponse } from 'next/server'
import { APP_VERSION } from '@/lib/version'
import { getLocalGitSha, getLocalGitBranch, isWorkingTreeClean } from '@/lib/version-server'
import { githubFetcher, gitRunner, runUpdateCheckShared } from '@/lib/update-check'
import { guard } from '@/server/middleware'

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
    },
  }
  if (wantsCheck) {
    body.check = await runUpdateCheckShared({ run: gitRunner(), fetchGithub: githubFetcher, localSha, cwd: process.cwd() })
  }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

export const GET = guard(GET_impl, { rateLimit: false }) // cheap read of the running version: never the budget of the scraping routes
