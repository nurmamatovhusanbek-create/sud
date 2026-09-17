/**
 * v158: POST /api/settings/update
 *
 * Runs `git pull origin main` to update the app to the latest commit.
 * Pre-checks: working tree must be clean, must be on main branch.
 * Uses execFile (async, non-blocking) — does NOT block the event loop.
 *
 * Response (success):
 *   { ok: true, output: string, needsRestart: true, newSha: string }
 *
 * Response (error):
 *   { ok: false, error: 'dirty_tree' | 'wrong_branch' | 'git_unavailable' | 'pull_failed', detail?: string }
 */

import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getLocalGitSha, getLocalGitBranch, isWorkingTreeClean } from '@/lib/version-server'
import { guard } from '@/server/middleware'

const execFileAsync = promisify(execFile)

async function POST_impl() {
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

    return NextResponse.json({
      ok: true,
      output,
      needsRestart: true,
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
