/**
 * v210: POST /api/settings/update
 *
 * Runs `git pull origin main`, then actually applies the update to the
 * RUNNING app: it drops a `.sud-restart` sentinel file that the supervisor
 * (scripts/supervisor.mjs — see package.json's dev/start scripts) is polling
 * for. The supervisor then kills the whole server process TREE and respawns
 * it, reinstalling deps and rebuilding in production mode.
 *
 * Why a sentinel and not a self-kill: under `bun x next dev` the process that
 * serves this request is often a grandchild of the process the supervisor
 * tracks, so killing our own pid never reached the tracked process — the
 * supervisor never noticed and never respawned (the in-app update silently
 * did nothing, especially on Windows). Letting the supervisor kill its own
 * child tree is reliable across platforms. Before all this, the route only ran
 * `git pull` — new files sat on disk with nothing reloading or rebuilding to
 * serve them (fatal in production mode, where the running server is a frozen
 * prebuilt bundle; unreliable in dev too after a large diff, since Fast
 * Refresh's module cache can end up stale for moved/deleted files).
 *
 * The client is expected to poll GET /api/settings/version until it gets a
 * response again (the connection will genuinely refuse for a few seconds to
 * a minute or more in production mode, while the rebuild runs) and then
 * reload the page.
 *
 * Pre-checks: working tree must be clean (or auto-stashable), must be on
 * main branch, and — critically — must be running UNDER the supervisor
 * (scripts/supervisor.mjs sets SUD_SUPERVISED=1), or exiting this process
 * would just kill the app with nothing to bring it back.
 *
 * Response (success):
 *   { ok: true, output: string, restarting: true, newSha: string }
 *
 * Response (error):
 *   { ok: false, error: 'dirty_tree' | 'wrong_branch' | 'git_unavailable' | 'pull_failed' | 'not_supervised', detail?: string }
 */

import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { getLocalGitSha, getLocalGitBranch, isWorkingTreeClean } from '@/lib/version-server'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const execFileAsync = promisify(execFile)

// git must never wait for a credential prompt (the request would hang until the timeout), and the pull must never open an editor
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }

// one update at a time: two clicks (or a forged double fire) must not run two stash/pull/pop sequences on one working tree
const g = globalThis as unknown as { __sudUpdating?: boolean }

/**
 * Ask the supervisor to restart the server by dropping the sentinel file it
 * polls for. The supervisor kills the whole server process tree and respawns
 * it — reliable across platforms, unlike this process trying to kill itself
 * (see the route header). The current process keeps serving until the
 * supervisor cycles it (~1s), giving the HTTP response time to flush first.
 */
function requestRestart(newSha: string) {
  try {
    writeFileSync(join(process.cwd(), '.sud-restart'), `${newSha}\n${Date.now()}\n`)
    console.log('[update] restart sentinel written — supervisor will cycle the server')
  } catch (e) {
    console.error('[update] failed to write restart sentinel:', e)
  }
}

async function POST_impl() {
  if (g.__sudUpdating) {
    return NextResponse.json({ ok: false, error: 'busy', detail: 'Yangilash allaqachon davom etmoqda' }, { status: 409 })
  }
  g.__sudUpdating = true
  try {
    return await runUpdate()
  } finally {
    g.__sudUpdating = false
  }
}

async function runUpdate() {
  // Exiting only works if something is actually watching this process to
  // bring a new one back up — without it this would just kill the app.
  if (!process.env.SUD_SUPERVISED) {
    return NextResponse.json(
      {
        ok: false,
        error: 'not_supervised',
        detail: "Server 'bun run dev' / 'bun run start' orqali emas, boshqacha ishga tushirilgan — avtomatik qayta ishga tushirib bo'lmaydi. Terminalda to'xtatib, qaytadan ishga tushiring.",
      },
      { status: 409 },
    )
  }

  // Check git is available
  const currentSha = getLocalGitSha()
  if (!currentSha) {
    return NextResponse.json(
      { ok: false, error: 'git_unavailable', detail: 'Git is not available in this environment' },
      { status: 400 },
    )
  }

  // Check we're on main branch
  const branch = getLocalGitBranch()
  if (branch !== 'main') {
    return NextResponse.json(
      { ok: false, error: 'wrong_branch', currentBranch: branch },
      { status: 409 },
    )
  }

  // v165: If working tree is dirty, stash changes before pulling.
  // This makes the Yangilash button always work, even with uncommitted changes.
  const clean = isWorkingTreeClean()
  let stashed = false
  if (clean === false) {
    try {
      await execFileAsync('git', ['stash', 'push', '-m', 'auto-stash before update'], { timeout: 10000, env: GIT_ENV })
      stashed = true
      console.log('[update] Auto-stashed local changes before git pull')
    } catch {
      // Stash failed — try pull anyway, it might work if changes don't conflict
      console.log('[update] Stash failed, trying pull anyway')
    }
  }

  /** Give the operator's local changes back. Runs on EVERY path: a failed pull used to leave them hidden in the stash. */
  const restoreStash = async (): Promise<boolean> => {
    if (!stashed) return true
    try {
      await execFileAsync('git', ['stash', 'pop'], { timeout: 10000, env: GIT_ENV })
      console.log('[update] Auto-popped stash')
      return true
    } catch {
      console.log('[update] Stash pop failed — changes remain in the stash (git stash list)')
      return false
    }
  }

  // Run git pull — FAST-FORWARD ONLY: a pull that would need a merge (local commits on main, a rewritten remote) must stop
  // here, not leave conflict markers in files the server is about to rebuild from.
  try {
    const { stdout, stderr } = await execFileAsync('git', ['pull', '--ff-only', 'origin', 'main'], {
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      env: GIT_ENV,
    })

    const restored = await restoreStash()
    const newSha = getLocalGitSha()
    const output = (stdout + (stderr ? '\n' + stderr : '')).trim()
    const changed = !!newSha && newSha !== currentSha
    // Only restart when the pull actually moved HEAD — an already-up-to-date
    // click shouldn't bounce the server for nothing.
    if (changed) requestRestart(newSha)

    return NextResponse.json({
      ok: true,
      output,
      restarting: changed,
      newSha,
      oldSha: currentSha,
      stashed,
      ...(stashed && !restored ? { stashRestored: false } : {}),
    })
  } catch (e: any) {
    await restoreStash()
    return NextResponse.json(
      {
        ok: false,
        error: 'pull_failed',
        detail: e.message || 'git pull failed',
        stderr: e.stderr || '',
        stdout: e.stdout || '',
        stashed,
      },
      { status: 500 },
    )
  }
}

// git pull + restart: the most dangerous door in the app — privileged (server/security.ts)
export const POST = guard(POST_impl, { privileged: true })
