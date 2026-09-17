/**
 * v158: Server-only git utilities for the update checker.
 * This file MUST NOT be imported by client components — it uses child_process.
 */

import { execSync } from 'child_process'

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
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return sha.slice(0, 7)
  } catch {
    return null
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
      timeout: 3000,
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
      timeout: 3000,
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
