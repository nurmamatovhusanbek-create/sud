/**
 * «Is there a newer version?» — answered the way the update itself works.
 *
 * The Yangilash button runs `git pull origin main`, so the check asks the same place: `git fetch origin main`, then
 * compares the local HEAD with what came back. That is exact, immediate (no cache: a push made a second ago is seen), has
 * no API rate limit and also works for a private repository. The GitHub web API is only the fallback when git itself
 * cannot reach the remote; it is edge-cached and limited to 60 requests an hour per address, which is why it alone
 * «sometimes» missed a push.
 *
 * Two rules the old check broke:
 *   - a check that could not run is reported as «could not check», never as «up to date»;
 *   - «newer» means the remote has commits the local code lacks (behind > 0), not merely «the SHAs differ»: a local
 *     checkout that is AHEAD of GitHub has nothing to update, and a diverged one cannot be fast-forwarded.
 *
 * Pure orchestration over two injected functions (`run` for git, `fetchGithub`), so every outcome is tested without a
 * network; `gitRunner` is the real one (async, never blocks the server).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { classifyGitFailure } from './git-failure'

const execFileAsync = promisify(execFile)

export const GITHUB_REPO = 'nurmamatovhusanbek-create/sud'
export const BRANCH = 'main'

export type Relation = 'same' | 'behind' | 'ahead' | 'diverged' | 'unknown'

export interface RemoteHead {
  /** 7 characters */
  sha: string
  message: string
  author: string
  date: string
  commitUrl: string
}

export interface UpdateCheck {
  /** where the answer came from: git (authoritative) or the GitHub API (fallback), null when neither answered */
  source: 'git' | 'github' | null
  remote: RemoteHead | null
  relation: Relation
  /** commits the local code has that the remote lacks / the remote has that the local code lacks (git source only) */
  ahead: number
  behind: number
  updateAvailable: boolean
  /** why the check could not be made (shown instead of any «up to date») */
  error: { code: string; detail: string } | null
  rateLimited: boolean
  retryAfterSec: number | null
  checkedAt: string
}

export type GitRun = (args: string[]) => Promise<string>

/** What the GitHub fallback returns: a head, or why there is none. */
export type GithubResult = { head: RemoteHead } | { head: null; rateLimited: boolean; retryAfterSec?: number; status?: number }
export type GithubFetch = () => Promise<GithubResult>

// ---- git ------------------------------------------------------------------------------------------------------------

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }

/** The real runner: async, in the project folder, never waiting for a credential prompt. */
export function gitRunner(cwd: string = process.cwd(), timeoutMs = 25_000): GitRun {
  return async (args) => (await execFileAsync('git', args, { cwd, timeout: timeoutMs, env: GIT_ENV, maxBuffer: 1024 * 1024 })).stdout.trim()
}

export function relationOf(ahead: number, behind: number): Relation {
  if (ahead === 0 && behind === 0) return 'same'
  if (behind > 0 && ahead === 0) return 'behind'
  if (ahead > 0 && behind === 0) return 'ahead'
  return 'diverged'
}

/** `git rev-list --left-right --count HEAD...FETCH_HEAD` prints «<only in HEAD>\t<only in FETCH_HEAD>». */
export function parseCounts(out: string): { ahead: number; behind: number } | null {
  const m = /^(\d+)\s+(\d+)$/.exec(out.trim())
  return m ? { ahead: +m[1], behind: +m[2] } : null
}

/** `git log -1 --format=%H%x1f%s%x1f%an%x1f%aI` */
export function parseHead(out: string, repo: string = GITHUB_REPO): RemoteHead | null {
  const [full, message = '', author = '', date = ''] = out.trim().split('\x1f')
  if (!/^[0-9a-f]{40}$/.test(full ?? '')) return null
  return { sha: full.slice(0, 7), message, author, date, commitUrl: `https://github.com/${repo}/commit/${full}` }
}

/** Ask git. Throws whatever git threw (the caller classifies it). */
export async function checkViaGit(run: GitRun, branch: string = BRANCH): Promise<{ remote: RemoteHead; ahead: number; behind: number }> {
  await run(['fetch', '--quiet', 'origin', branch])
  const remote = parseHead(await run(['log', '-1', '--format=%H%x1f%s%x1f%an%x1f%aI', 'FETCH_HEAD']))
  if (!remote) throw new Error('git javobini oʻqib boʻlmadi (log)')
  const counts = parseCounts(await run(['rev-list', '--left-right', '--count', 'HEAD...FETCH_HEAD']))
  if (!counts) throw new Error('git javobini oʻqib boʻlmadi (rev-list)')
  return { remote, ...counts }
}

// ---- the GitHub fallback ----------------------------------------------------------------------------------------------

/** GitHub's API, asked not to serve a cached copy. Only used when git itself cannot reach the remote. */
export const githubFetcher: GithubFetch = async () => {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/${BRANCH}?_=${Date.now()}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'sud-tizimi', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10)
      return { head: null, rateLimited: true, retryAfterSec: Math.max(0, reset - Math.floor(Date.now() / 1000)) }
    }
    if (!res.ok) return { head: null, rateLimited: false, status: res.status }
    const c = await res.json()
    const full: string = c.sha || ''
    if (!/^[0-9a-f]{40}$/.test(full)) return { head: null, rateLimited: false }
    return { head: { sha: full.slice(0, 7), message: c.commit?.message?.split('\n')[0] || '', author: c.commit?.author?.name || '', date: c.commit?.author?.date || '', commitUrl: c.html_url || `https://github.com/${GITHUB_REPO}/commit/${full}` } }
  } catch {
    return { head: null, rateLimited: false }
  }
}

// ---- the whole check ----------------------------------------------------------------------------------------------------

const base = (): UpdateCheck => ({ source: null, remote: null, relation: 'unknown', ahead: 0, behind: 0, updateAvailable: false, error: null, rateLimited: false, retryAfterSec: null, checkedAt: new Date().toISOString() })

/**
 * One check, never cached. git first; if git cannot reach the remote, the GitHub API; if neither answers, an `error`
 * that says why (and `updateAvailable` stays false, but the screen must show the error, not «up to date»).
 */
export async function runUpdateCheck(deps: { run: GitRun; fetchGithub: GithubFetch; localSha: string | null; cwd?: string }): Promise<UpdateCheck> {
  const out = base()
  let gitWhy = { code: 'other', detail: 'Git javob bermadi' }
  try {
    const g = await checkViaGit(deps.run)
    return { ...out, source: 'git', remote: g.remote, ahead: g.ahead, behind: g.behind, relation: relationOf(g.ahead, g.behind), updateAvailable: g.behind > 0 }
  } catch (e) {
    const f = classifyGitFailure(e, deps.cwd)
    gitWhy = { code: f.kind, detail: f.detail }
  }

  const gh = await deps.fetchGithub()
  if (gh.head) {
    const differs = !!deps.localSha && gh.head.sha !== deps.localSha.slice(0, 7)
    return { ...out, source: 'github', remote: gh.head, relation: !deps.localSha ? 'unknown' : differs ? 'unknown' : 'same', updateAvailable: differs }
  }
  const ghWhy = gh.rateLimited ? `GitHub soʻrovlar chegarasi tugadi${gh.retryAfterSec ? ` (${Math.ceil(gh.retryAfterSec / 60)} daqiqadan keyin qayta urinib koʻring)` : ''}` : gh.status === 404 ? 'GitHub repozitoriyni topa olmadi (yopiq repozitoriy boʻlsa, git kirishi kerak)' : 'GitHubʼga ulanib boʻlmadi'
  return { ...out, error: { code: gitWhy.code, detail: `${gitWhy.detail} · ${ghWhy}` }, rateLimited: gh.rateLimited, retryAfterSec: gh.rateLimited ? gh.retryAfterSec ?? null : null }
}

// two requests at the same moment (the tab opening twice, a double click) share ONE check; nothing is remembered after it
let inflight: Promise<UpdateCheck> | null = null
export function runUpdateCheckShared(deps: Parameters<typeof runUpdateCheck>[0]): Promise<UpdateCheck> {
  inflight ??= runUpdateCheck(deps).finally(() => { inflight = null })
  return inflight
}
