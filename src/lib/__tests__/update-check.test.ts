import { describe, expect, test } from 'bun:test'
import {
  checkViaGit,
  parseCounts,
  parseHead,
  relationOf,
  runUpdateCheck,
  runUpdateCheckShared,
  type GithubFetch,
  type GitRun,
  type RemoteHead,
} from '../update-check'

const FULL = 'a'.repeat(40)
const HEAD_LINE = `${FULL}\x1fFix the thing\x1fAnna\x1f2026-11-17T10:00:00+05:00`

/** A fake git: answers by subcommand; `fetchFails` makes `fetch` throw like execFile does. */
function fakeGit(o: { counts?: string; head?: string; fetchFails?: unknown }): { run: GitRun; calls: string[][] } {
  const calls: string[][] = []
  const run: GitRun = async (args) => {
    calls.push(args)
    if (args[0] === 'fetch') {
      if (o.fetchFails) throw o.fetchFails
      return ''
    }
    if (args[0] === 'log') return o.head ?? HEAD_LINE
    if (args[0] === 'rev-list') return o.counts ?? '0\t0'
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
  return { run, calls }
}

const ghHead: RemoteHead = { sha: 'bbbbbbb', message: 'm', author: 'a', date: 'd', commitUrl: 'u' }
const gh = (r: Awaited<ReturnType<GithubFetch>>): GithubFetch => async () => r

describe('relationOf / parsers', () => {
  test('ahead/behind → relation', () => {
    expect(relationOf(0, 0)).toBe('same')
    expect(relationOf(0, 3)).toBe('behind')
    expect(relationOf(2, 0)).toBe('ahead')
    expect(relationOf(2, 3)).toBe('diverged')
  })
  test('parseCounts reads the tab-separated pair and rejects noise', () => {
    expect(parseCounts('2\t5\n')).toEqual({ ahead: 2, behind: 5 })
    expect(parseCounts('0 0')).toEqual({ ahead: 0, behind: 0 })
    expect(parseCounts('')).toBeNull()
    expect(parseCounts('fatal: bad revision')).toBeNull()
  })
  test('parseHead needs a full sha and keeps the message with its own spaces', () => {
    expect(parseHead(HEAD_LINE)).toMatchObject({ sha: 'aaaaaaa', message: 'Fix the thing', author: 'Anna' })
    expect(parseHead(HEAD_LINE)?.commitUrl).toContain(FULL)
    expect(parseHead('not a sha\x1fx')).toBeNull()
    expect(parseHead('')).toBeNull()
  })
})

describe('checkViaGit', () => {
  test('fetches origin main FIRST, then reads FETCH_HEAD (so a push a second ago is seen)', async () => {
    const g = fakeGit({ counts: '0\t2' })
    const r = await checkViaGit(g.run)
    expect(g.calls[0]).toEqual(['fetch', '--quiet', 'origin', 'main'])
    expect(g.calls[1].at(-1)).toBe('FETCH_HEAD')
    expect(g.calls[2]).toEqual(['rev-list', '--left-right', '--count', 'HEAD...FETCH_HEAD'])
    expect(r.behind).toBe(2)
  })
  test('garbage from git is an error, not a silent «up to date»', async () => {
    await expect(checkViaGit(fakeGit({ counts: 'oops' }).run)).rejects.toThrow()
    await expect(checkViaGit(fakeGit({ head: 'oops' }).run)).rejects.toThrow()
  })
})

describe('runUpdateCheck', () => {
  const never: GithubFetch = async () => {
    throw new Error('GitHub must not be asked when git answered')
  }

  test('behind → update available, from git, no GitHub call', async () => {
    const r = await runUpdateCheck({ run: fakeGit({ counts: '0\t3' }).run, fetchGithub: never, localSha: FULL })
    expect(r).toMatchObject({ source: 'git', relation: 'behind', behind: 3, ahead: 0, updateAvailable: true, error: null })
    expect(r.remote?.sha).toBe('aaaaaaa')
  })
  test('same → no update', async () => {
    const r = await runUpdateCheck({ run: fakeGit({ counts: '0\t0' }).run, fetchGithub: never, localSha: FULL })
    expect(r).toMatchObject({ relation: 'same', updateAvailable: false, error: null })
  })
  test('local AHEAD of GitHub is NOT an update (the old sha-inequality said it was)', async () => {
    const r = await runUpdateCheck({ run: fakeGit({ counts: '4\t0' }).run, fetchGithub: never, localSha: FULL })
    expect(r).toMatchObject({ relation: 'ahead', ahead: 4, updateAvailable: false })
  })
  test('diverged: reported as such; the fast-forward button is not offered by the screen (updateAvailable only when behind)', async () => {
    const r = await runUpdateCheck({ run: fakeGit({ counts: '1\t2' }).run, fetchGithub: never, localSha: FULL })
    expect(r).toMatchObject({ relation: 'diverged', ahead: 1, behind: 2 })
  })

  test('git cannot reach the remote → the GitHub API answers, flagged as such', async () => {
    const r = await runUpdateCheck({
      run: fakeGit({ fetchFails: Object.assign(new Error('x'), { stderr: 'fatal: unable to access', code: 128 }) }).run,
      fetchGithub: gh({ head: ghHead }),
      localSha: 'c'.repeat(40),
    })
    expect(r).toMatchObject({ source: 'github', updateAvailable: true, error: null })
  })
  test('GitHub fallback: same sha → not available', async () => {
    const r = await runUpdateCheck({
      run: fakeGit({ fetchFails: new Error('offline') }).run,
      fetchGithub: gh({ head: { ...ghHead, sha: 'ccccccc' } }),
      localSha: 'c'.repeat(40),
    })
    expect(r).toMatchObject({ source: 'github', relation: 'same', updateAvailable: false })
  })

  test('NOTHING answers → an error with the reason, never a quiet «up to date»', async () => {
    const r = await runUpdateCheck({
      run: fakeGit({ fetchFails: Object.assign(new Error('boom'), { code: 'ENOENT' }) }).run,
      fetchGithub: gh({ head: null, rateLimited: false }),
      localSha: FULL,
    })
    expect(r.error).not.toBeNull()
    expect(r.error?.detail.length).toBeGreaterThan(10)
    expect(r.updateAvailable).toBe(false)
    expect(r.remote).toBeNull()
    expect(r.relation).toBe('unknown') // not «same»
  })
  test('rate-limited GitHub is named, with the wait', async () => {
    const r = await runUpdateCheck({
      run: fakeGit({ fetchFails: new Error('offline') }).run,
      fetchGithub: gh({ head: null, rateLimited: true, retryAfterSec: 600 }),
      localSha: FULL,
    })
    expect(r.rateLimited).toBe(true)
    expect(r.retryAfterSec).toBe(600)
    expect(r.error?.detail).toContain('10 daqiqa')
  })
  test('404 from GitHub hints at a private repository', async () => {
    const r = await runUpdateCheck({ run: fakeGit({ fetchFails: new Error('x') }).run, fetchGithub: gh({ head: null, rateLimited: false, status: 404 }), localSha: FULL })
    expect(r.error?.detail).toContain('yopiq')
  })
})

describe('runUpdateCheckShared', () => {
  test('two simultaneous checks share one git run; the next one runs again (nothing is cached)', async () => {
    let fetches = 0
    const run: GitRun = async (args) => {
      if (args[0] === 'fetch') {
        fetches++
        await new Promise((r) => setTimeout(r, 20))
        return ''
      }
      return args[0] === 'log' ? HEAD_LINE : '0\t0'
    }
    const deps = { run, fetchGithub: gh({ head: null, rateLimited: false }), localSha: FULL }
    const [a, b] = await Promise.all([runUpdateCheckShared(deps), runUpdateCheckShared(deps)])
    expect(a).toBe(b)
    expect(fetches).toBe(1)
    await runUpdateCheckShared(deps)
    expect(fetches).toBe(2)
  })
})

// ---- the real thing: two throw-away repositories and the real git ---------------------------------------------------
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitRunner } from '../update-check'

describe('with real git', () => {
  const root = mkdtempSync(join(tmpdir(), 'sud-upd-'))
  const g = (cwd: string, ...a: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' }).trim()
  const origin = join(root, 'origin.git')
  const mine = join(root, 'mine')
  const other = join(root, 'other')
  const commit = (dir: string, name: string) => {
    writeFileSync(join(dir, name), name)
    g(dir, 'add', name)
    g(dir, 'commit', '-q', '-m', `add ${name}`)
  }

  test('a push made a moment ago is detected at once, and pulling clears it', async () => {
    g(root, 'init', '-q', '--bare', '-b', 'main', origin)
    g(root, 'clone', '-q', origin, mine)
    g(mine, 'checkout', '-q', '-B', 'main')
    commit(mine, 'a.txt')
    g(mine, 'push', '-q', 'origin', 'main')
    g(root, 'clone', '-q', origin, other)

    const run = gitRunner(mine)
    const local = () => g(mine, 'rev-parse', 'HEAD')
    const deps = () => ({ run, fetchGithub: gh({ head: null, rateLimited: false }), localSha: local(), cwd: mine })

    expect(await runUpdateCheck(deps())).toMatchObject({ relation: 'same', updateAvailable: false })

    commit(other, 'b.txt')
    g(other, 'push', '-q', 'origin', 'main') // «the push»
    const seen = await runUpdateCheck(deps())
    expect(seen).toMatchObject({ source: 'git', relation: 'behind', behind: 1, updateAvailable: true })
    expect(seen.remote?.message).toBe('add b.txt')

    g(mine, 'pull', '-q', '--ff-only', 'origin', 'main')
    expect(await runUpdateCheck(deps())).toMatchObject({ relation: 'same', updateAvailable: false })

    commit(mine, 'c.txt') // unpushed local work: nothing to update
    expect(await runUpdateCheck(deps())).toMatchObject({ relation: 'ahead', ahead: 1, updateAvailable: false })

    commit(other, 'd.txt')
    g(other, 'push', '-q', 'origin', 'main')
    expect(await runUpdateCheck(deps())).toMatchObject({ relation: 'diverged', ahead: 1, behind: 1 })
  })

  test('an unreachable remote is an error, not «up to date»', async () => {
    g(mine, 'remote', 'set-url', 'origin', join(root, 'missing.git'))
    const r = await runUpdateCheck({ run: gitRunner(mine), fetchGithub: gh({ head: null, rateLimited: false }), localSha: g(mine, 'rev-parse', 'HEAD'), cwd: mine })
    expect(r.error).not.toBeNull()
    expect(r.updateAvailable).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })
})
