#!/usr/bin/env node
/**
 * Supervisor — what actually makes Settings › Yangilanishlar › "Yangilash"
 * apply an update to a RUNNING app.
 *
 * `git pull` alone only changes files on disk:
 *   - in dev mode, a big diff can leave Next's Fast Refresh module cache in
 *     a broken state (stale entries for deleted/moved files) until the
 *     process restarts;
 *   - in production mode, `bun run start` serves the pre-built standalone
 *     bundle in .next/standalone — that's a frozen snapshot, completely
 *     disconnected from the source tree, until something reruns `next
 *     build` and restarts the server process.
 * Neither case fixes itself without a restart, and nothing in the app was
 * doing that restart.
 *
 * This script is the long-lived parent process (what `bun run dev` / `bun
 * run start` now launch). It spawns the real Next.js server as a child and
 * restarts it — reinstalling deps and, in start mode, rebuilding — whenever
 * the child exits. /api/settings/update triggers a restart by simply
 * killing its own process after pulling; this supervisor is what notices
 * and brings a fresh one back up.
 *
 * Usage: node scripts/supervisor.mjs dev|start
 */

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { platform } from 'node:os'

const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'start') {
  console.error('Usage: node scripts/supervisor.mjs dev|start')
  process.exit(1)
}

const bunCmd = platform() === 'win32' ? 'bun.exe' : 'bun'
const logFile = mode === 'dev' ? 'dev.log' : 'server.log'
const logStream = createWriteStream(logFile, { flags: 'w' })

let current = null
let sinceLastStart = 0
let attempt = 0

function pipe(child) {
  child.stdout?.on('data', (d) => { process.stdout.write(d); logStream.write(d) })
  child.stderr?.on('data', (d) => { process.stderr.write(d); logStream.write(d) })
}

/** Run a one-shot command to completion (bun install / bun run build). */
function runStep(label, cmd, args) {
  console.log(`[supervisor] ${label}…`)
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'] })
    pipe(child)
    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`[supervisor] ${label} done`)
      } else {
        // Don't strand the app with no server at all over a failed
        // preparation step (e.g. a transient network blip on install) —
        // log it and still try to start whatever is on disk.
        console.error(`[supervisor] ${label} failed (exit ${code}) — starting anyway`)
      }
      resolve()
    })
    child.on('error', (e) => {
      console.error(`[supervisor] ${label} failed to start: ${e.message}`)
      resolve()
    })
  })
}

async function cycle() {
  attempt++
  await runStep('bun install', bunCmd, ['install'])
  if (mode === 'start') {
    await runStep('bun run build', bunCmd, ['run', 'build'])
  }

  const args = mode === 'dev' ? ['x', 'next', 'dev', '-p', '3000'] : ['.next/standalone/server.js']
  const env = { ...process.env, SUD_SUPERVISED: '1', ...(mode === 'start' ? { NODE_ENV: 'production' } : {}) }
  console.log(`[supervisor] starting: ${bunCmd} ${args.join(' ')}`)
  sinceLastStart = Date.now()
  const child = spawn(bunCmd, args, { stdio: ['inherit', 'pipe', 'pipe'], env })
  pipe(child)
  current = child

  child.on('exit', (code, signal) => {
    current = null
    console.log(`[supervisor] server exited (code=${code} signal=${signal})`)
    // Reset the backoff once a run has stayed up a reasonable while — this
    // only kicks in for genuine crash loops, not the deliberate one-shot
    // restart /api/settings/update triggers.
    if (Date.now() - sinceLastStart > 15_000) attempt = 1
    const delay = Math.min(500 * attempt, 8_000)
    setTimeout(cycle, delay)
  })
}

// Forward Ctrl+C / termination to the supervised child instead of leaving it
// orphaned holding the port.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    current?.kill(sig)
    process.exit(0)
  })
}

void cycle()
