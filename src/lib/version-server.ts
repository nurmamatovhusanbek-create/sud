/**
 * v158: Server-only git utilities for the update checker.
 * This file MUST NOT be imported by client components — it uses child_process.
 */

import { execSync } from 'child_process'
import { classifyGitFailure, type GitFailure } from './git-failure'

// a slow disk (OneDrive, antivirus scanning .git) can take seconds for a call that normally takes milliseconds
const GIT_TIMEOUT_MS = 15_000

/**
 * Get the current local git commit SHA (short, 7 chars).
 * In production (no .git dir), falls back to the build-time embedded SHA.
 * Returns null if git is not available and no SHA was embedded.
 */
export function getLocalGitSha(): string | null {
  if (process.env.APP_GIT_SHA) {
    return process.env.APP_GIT_SHA.slice(0, 7)
  }

  try {
    const sha = execSync('git rev-parse HEAD', {
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return sha.slice(0, 7)
  } catch {
    return null
  }
}

/**
 * WHY git is unusable here, or null when it works. The probes above return null for every failure (the callers only
 * need «is there a value»); the update route calls this once to tell the operator what is actually wrong.
 */
export function diagnoseGit(): GitFailure | null {
  try {
    execSync('git rev-parse HEAD', { encoding: 'utf-8', timeout: GIT_TIMEOUT_MS, stdio: ['pipe', 'pipe', 'pipe'] })
    return null
  } catch (err) {
    return classifyGitFailure(err, process.cwd())
  }
}

/**
 * Get the current git branch name.
 * Returns null if git is not available.
 */
export function getLocalGitBranch(): string | null {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return branch
  } catch {
    return null
  }
}

/**
 * Check if the working tree is clean (no uncommitted changes).
 * v163: Ignores auto-generated files (bun.lock, .next/, workers.json) that
 * change during normal dev but don't block git pull.
 * Returns true if clean, false if dirty, null if git unavailable.
 */
export function isWorkingTreeClean(): boolean | null {
  try {
    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (status.length === 0) return true
    // Filter out auto-generated files that don't block git pull
    const ignorePatterns = [
      'bun.lock',
      '.next/',
      'workers.json',
      'dev.log',
    ]
    const realChanges = status
      .split('\n')
      .filter(line => line.trim().length > 0)
      .filter(line => !ignorePatterns.some(p => line.includes(p)))
    return realChanges.length === 0
  } catch {
    return null
  }
}
