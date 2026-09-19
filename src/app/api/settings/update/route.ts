/**
 * v209: POST /api/settings/update
 *
 * Runs `git pull origin main`, then actually applies the update to the
 * RUNNING app: this process exits (after the response flushes), and the
 * supervisor wrapping it (scripts/supervisor.mjs — see package.json's
 * dev/start scripts) notices the exit, reinstalls deps, rebuilds when
 * running in production mode, and starts a fresh process. Before this, the
 * route only ran `git pull` — new files sat on disk with nothing ever
 * reloading or rebuilding to actually serve them (fatal in production mode,
 * where the running server is a frozen prebuilt bundle unrelated to the
 * source tree; unreliable in dev mode too after a large diff, since Fast
 * Refresh's module cache can end up with stale entries for moved/deleted
 * files).
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
import { getLocalGitSha, getLocalGitBranch, isWorkingTreeClean } from '@/lib/version-server'
import { guard } from '@/server/middleware'

const execFileAsync = promisify(execFile)

/**
 * Kill this process after `delayMs` so the HTTP response has time to flush
 * to the client first. SIGTERM gives Next's own shutdown handling (if any) a
 * chance to run; a hard process.exit() fallback covers the case where
 * something swallows the signal, so the supervisor's respawn is never stuck
 * waiting on a process that won't die.
 */
function scheduleRestart(delayMs = 300) {
  setTimeout(() => {
    console.log('[update] restarting — exiting for the supervisor to respawn')
    process.kill(process.pid, 'SIGTERM')
    setTimeout(() => process.exit(0), 5000)
  }, delayMs)
}

async function POST_impl() {
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
      await execFileAsync('git', ['stash', 'push', '-m', 'auto-stash before update'], { timeout: 10000 })
      stashed = true
      console.log('[update] Auto-stashed local changes before git pull')
    } catch {
      // Stash failed — try pull anyway, it might work if changes don't conflict
      console.log('[update] Stash failed, trying pull anyway')
    }
  }

  // Run git pull
  try {
    const { stdout, stderr } = await execFileAsync('git', ['pull', 'origin', 'main'], {
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    })

    // v165: Pop stash if we stashed earlier
    if (stashed) {
      try {
        await execFileAsync('git', ['stash', 'pop'], { timeout: 10000 })
        console.log('[update] Auto-popped stash after git pull')
      } catch {
        console.log('[update] Stash pop failed — changes remain in stash')
      }
    }

    const newSha = getLocalGitSha()
    const output = (stdout + (stderr ? '\n' + stderr : '')).trim()
    const changed = newSha !== currentSha
    // Only restart when the pull actually moved HEAD — an already-up-to-date
    // click shouldn't bounce the server for nothing.
    if (changed) scheduleRestart()

    return NextResponse.json({
      ok: true,
      output,
      restarting: changed,
      newSha,
      oldSha: currentSha,
      stashed,
    })
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: 'pull_failed',
        detail: e.message || 'git pull failed',
        stderr: e.stderr || '',
        stdout: e.stdout || '',
      },
      { status: 500 },
    )
  }
}

export const POST = guard(POST_impl)
