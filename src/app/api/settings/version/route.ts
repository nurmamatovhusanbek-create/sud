/**
 * v158: GET /api/settings/version
 *
 * Checks the local git commit SHA against the latest GitHub commit on main.
 * Caches the GitHub API response for 5 minutes (60 req/hr unauth rate limit).
 *
 * Response:
 *   {
 *     local:  { version, sha, branch, dirty, gitAvailable },
 *     remote: { sha, message, author, date, commitUrl } | null,
 *     updateAvailable: boolean,
 *     rateLimited: boolean,
 *     cachedAt: ISO string,
 *     cacheTtlMs: number
 *   }
 */

import { NextResponse } from 'next/server'
import { APP_VERSION } from '@/lib/version'
import { getLocalGitSha, getLocalGitBranch, isWorkingTreeClean } from '@/lib/version-server'
import { guard } from '@/server/middleware'

const GITHUB_REPO = 'nurmamatovhusanbek-create/sud-billing-lookup'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CachedRemote {
  sha: string
  message: string
  author: string
  date: string
  commitUrl: string
  fetchedAt: string
}

let _cachedRemote: CachedRemote | null = null
let _cachedAt = 0

async function fetchLatestCommit(force = false): Promise<{ data: CachedRemote | null; rateLimited: boolean; retryAfterSec?: number }> {
  const now = Date.now()
  if (!force && _cachedRemote && now - _cachedAt < CACHE_TTL_MS) {
    return { data: _cachedRemote, rateLimited: false }
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'sud-billing-lookup',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining')
      const reset = res.headers.get('x-ratelimit-reset')
      if (remaining === '0' && reset) {
        const retryAfterSec = Math.max(0, parseInt(reset) - Math.floor(now / 1000))
        return { data: null, rateLimited: true, retryAfterSec }
      }
    }

    if (!res.ok) {
      return { data: null, rateLimited: false }
    }

    const commit = await res.json()
    const data: CachedRemote = {
      sha: commit.sha?.slice(0, 7) || '',
      message: commit.commit?.message?.split('\n')[0] || '',
      author: commit.commit?.author?.name || '',
      date: commit.commit?.author?.date || '',
      commitUrl: commit.html_url || '',
      fetchedAt: new Date().toISOString(),
    }

    _cachedRemote = data
    _cachedAt = now
    return { data, rateLimited: false }
  } catch {
    return { data: null, rateLimited: false }
  }
}

async function GET_impl(request: Request) {
  // v166: Support ?force=1 to bypass server-side cache
  const { searchParams } = new URL(request.url)
  const force = searchParams.get('force') === '1'

  const localSha = getLocalGitSha()
  const branch = getLocalGitBranch()
  const clean = isWorkingTreeClean()
  const gitAvailable = localSha !== null

  const { data: remote, rateLimited, retryAfterSec } = await fetchLatestCommit(force)

  const updateAvailable = !!(localSha && remote?.sha && localSha !== remote.sha)

  return NextResponse.json({
    local: {
      version: APP_VERSION,
      sha: localSha,
      branch,
      dirty: clean === false,
      gitAvailable,
    },
    remote: remote
      ? {
          sha: remote.sha,
          message: remote.message,
          author: remote.author,
          date: remote.date,
          commitUrl: remote.commitUrl,
        }
      : null,
    updateAvailable,
    rateLimited,
    retryAfterSec: retryAfterSec || null,
    cachedAt: _cachedAt > 0 ? new Date(_cachedAt).toISOString() : null,
    cacheTtlMs: CACHE_TTL_MS,
  })
}

export const GET = guard(GET_impl)
