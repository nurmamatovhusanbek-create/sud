/**
 * POST /api/settings/update against real throw-away git repositories (a bare «remote» and a clone it pulls from).
 * The route runs git in process.cwd(), so each test chdir()s into its clone.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-update-'))
const ORIG_CWD = process.cwd()
process.env.SUD_SUPERVISED = '1'
const { POST } = await import('@/app/api/settings/update/route')
const { __resetRateLimitsForTests } = await import('../middleware')

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

let remote = ''
let clone = ''
let other = ''

function setup() {
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.mkdirSync(ROOT, { recursive: true })
  remote = path.join(ROOT, 'remote.git')
  clone = path.join(ROOT, 'clone')
  other = path.join(ROOT, 'other')
  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' })
  execFileSync('git', ['clone', remote, other], { stdio: 'ignore' })
  fs.writeFileSync(path.join(other, 'a.txt'), 'one\n')
  git(other, 'add', '.')
  git(other, 'commit', '-m', 'one')
  git(other, 'push', 'origin', 'HEAD:main')
  execFileSync('git', ['clone', '-b', 'main', remote, clone], { stdio: 'ignore' })
}
const pushUpstream = (file: string, text: string) => {
  fs.writeFileSync(path.join(other, file), text)
  git(other, 'add', '.')
  git(other, 'commit', '-m', `change ${file}`)
  git(other, 'push', 'origin', 'HEAD:main')
}
const call = async () => {
  const res = await POST(new NextRequest('http://localhost:3000/api/settings/update', { method: 'POST', headers: { host: 'localhost:3000', 'x-sud-action': '1' } }))
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  process.chdir(ORIG_CWD)
  __resetRateLimitsForTests()
  setup()
  process.chdir(clone)
  fs.rmSync(path.join(clone, '.sud-restart'), { force: true })
})
afterAll(() => {
  process.chdir(ORIG_CWD)
  fs.rmSync(ROOT, { recursive: true, force: true })
})

describe('update route', () => {
  test('a clean fast-forward pulls, asks for a restart, and reports the new sha', async () => {
    pushUpstream('b.txt', 'two\n')
    const before = git(clone, 'rev-parse', 'HEAD')
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, restarting: true })
    expect(before.startsWith(String(body.oldSha))).toBe(true) // the route reports a short sha
    expect(git(clone, 'rev-parse', 'HEAD')).not.toBe(before)
    expect(fs.existsSync(path.join(clone, 'b.txt'))).toBe(true)
    expect(fs.existsSync(path.join(clone, '.sud-restart'))).toBe(true)
  })

  test('already up to date: no restart', async () => {
    const { body } = await call()
    expect(body).toMatchObject({ ok: true, restarting: false })
    expect(fs.existsSync(path.join(clone, '.sud-restart'))).toBe(false)
  })

  test('local changes are stashed for the pull and given back afterwards', async () => {
    pushUpstream('b.txt', 'two\n')
    fs.writeFileSync(path.join(clone, 'a.txt'), 'one\nmy local edit\n')
    const { body } = await call()
    expect(body).toMatchObject({ ok: true, stashed: true })
    expect(fs.readFileSync(path.join(clone, 'a.txt'), 'utf8')).toContain('my local edit')
    expect(git(clone, 'stash', 'list')).toBe('')
  })

  test('a diverged main (local commit + new upstream commit) is NOT merged: the pull fails, the files stay as they were, local changes come back', async () => {
    fs.writeFileSync(path.join(clone, 'local.txt'), 'mine\n')
    git(clone, 'add', '.')
    git(clone, 'commit', '-m', 'local commit')
    pushUpstream('b.txt', 'two\n')
    fs.writeFileSync(path.join(clone, 'a.txt'), 'one\nuncommitted\n')
    const headBefore = git(clone, 'rev-parse', 'HEAD')
    const { status, body } = await call()
    expect(status).toBe(500)
    expect(body).toMatchObject({ ok: false, error: 'pull_failed', stashed: true })
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(headBefore) // no merge commit
    expect(fs.existsSync(path.join(clone, 'b.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(clone, 'a.txt'), 'utf8')).toContain('uncommitted') // NOT left hidden in the stash
    expect(git(clone, 'stash', 'list')).toBe('')
    expect(fs.existsSync(path.join(clone, '.sud-restart'))).toBe(false)
    expect(git(clone, 'status', '--porcelain')).not.toContain('UU')
  })

  test('a second update while one runs is refused', async () => {
    pushUpstream('b.txt', 'two\n')
    const [a, b] = await Promise.all([call(), call()])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect([a.body, b.body].find((x) => x.error)).toMatchObject({ error: 'busy' })
  })

  test('not on main: refused', async () => {
    git(clone, 'checkout', '-b', 'feature')
    const { status, body } = await call()
    expect(status).toBe(409)
    expect(body).toMatchObject({ error: 'wrong_branch' })
  })
})
