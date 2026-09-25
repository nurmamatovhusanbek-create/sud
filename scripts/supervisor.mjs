#!/usr/bin/env node
/**
 * Supervisor — makes Settings › Yangilanishlar › "Yangilash" apply an update to
 * a RUNNING app, cross-platform (Windows + Unix).
 *
 * `git pull` only changes files on disk; the running server must restart to
 * pick them up (dev: Fast Refresh's module cache goes stale after a big diff;
 * start: the .next/standalone bundle is a frozen snapshot until rebuilt). This
 * long-lived parent spawns the real Next server as a child and restarts it —
 * reinstalling deps and, in start mode, rebuilding — whenever either:
 *   (a) the child exits, or
 *   (b) /api/settings/update drops a `.sud-restart` sentinel file.
 *
 * Why a sentinel instead of the route killing its own process: under
 * `bun x next dev` the process that serves HTTP is often a GRANDCHILD of the
 * child this supervisor tracks, so a self-kill from the route never reaches the
 * tracked process — the supervisor never notices and never respawns (this is
 * why the in-app update silently did nothing, especially on Windows). Here the
 * supervisor kills the whole child TREE itself (`taskkill /T /F` on Windows, a
 * process-group signal on Unix), which reliably frees the port and respawns.
 *
 * Usage: node scripts/supervisor.mjs dev|start
 */

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, unlinkSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'

const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'start') {
  console.error('Usage: node scripts/supervisor.mjs dev|start')
  process.exit(1)
}

const isWin = platform() === 'win32'
const bunCmd = isWin ? 'bun.exe' : 'bun'
const logFile = mode === 'dev' ? 'dev.log' : 'server.log'
const logStream = createWriteStream(logFile, { flags: 'w' })
const RESTART_SENTINEL = join(process.cwd(), '.sud-restart')

let current = null
let sinceLastStart = 0
let attempt = 0
let restarting = false
let deliberate = false // true = a sentinel-driven update restart (force reinstall)
let portStreak = 0     // consecutive quick exits caused by port 3000 being busy

const PORT = process.env.PORT || '3000'

function portHelp() {
  console.error(
    `\n[supervisor] Port ${PORT} band — avvalgi «bun run dev» toʻliq yopilmagan boʻlishi mumkin.\n` +
    `  Windows:      netstat -ano | findstr :${PORT}   →  taskkill /PID <PID> /F\n` +
    `  macOS/Linux:  lsof -ti tcp:${PORT} | xargs kill -9\n` +
    `Soʻng qaytadan «bun run dev». (Yoki boshqa portda: PORT=3001 bun run dev)\n`,
  )
}

function pipe(child) {
  child.stdout?.on('data', (d) => { process.stdout.write(d); logStream.write(d) })
  child.stderr?.on('data', (d) => { process.stderr.write(d); logStream.write(d) })
}

/**
 * Kill the child AND its descendants. `next dev` spawns a server subprocess, so
 * killing just the tracked process would orphan it (holding port 3000). On
 * Windows taskkill /T walks the tree; on Unix we signal the process group the
 * child leads (it is spawned detached, so it is a group leader).
 */
function killTree(child) {
  if (!child || child.killed) return
  try {
    if (isWin) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
    }
  } catch (e) {
    console.error(`[supervisor] killTree failed: ${e.message}`)
  }
}

/** Run a one-shot command to completion (bun install / bun run build). */
function runStep(label, cmd, args) {
  console.log(`[supervisor] ${label}…`)
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'] })
    pipe(child)
    child.on('exit', (code) => {
      if (code === 0) console.log(`[supervisor] ${label} done`)
      // Don't strand the app with no server over a failed prep step (e.g. a
      // transient network blip on install) — log it and start what's on disk.
      else console.error(`[supervisor] ${label} failed (exit ${code}) — continuing`)
      resolve()
    })
    child.on('error', (e) => {
      console.error(`[supervisor] ${label} failed to start: ${e.message}`)
      resolve()
    })
  })
}

async function cycle(doInstall = true) {
  attempt++
  restarting = false
  // Only (re)install on the first boot, after a healthy run, or a deliberate
  // update — NOT on every rapid crash-restart (that just spammed `bun install`
  // while the real problem, e.g. a busy port, never got surfaced).
  if (doInstall) {
    await runStep('bun install', bunCmd, ['install'])
    if (mode === 'start') await runStep('bun run build', bunCmd, ['run', 'build'])
  }

  const args = mode === 'dev' ? ['x', 'next', 'dev', '-p', PORT] : ['.next/standalone/server.js']
  const env = { ...process.env, SUD_SUPERVISED: '1', ...(mode === 'start' ? { NODE_ENV: 'production' } : {}) }
  console.log(`[supervisor] starting: ${bunCmd} ${args.join(' ')}`)
  sinceLastStart = Date.now()
  // detached on Unix → the child leads its own process group so killTree can
  // signal the whole tree; harmless on Windows (taskkill /T handles the tree).
  const child = spawn(bunCmd, args, { stdio: ['inherit', 'pipe', 'pipe'], env, detached: !isWin })
  pipe(child)
  // Watch the child's output for a port-in-use failure so we can react to it
  // instead of blindly respawning into the same wall.
  let portConflict = false
  const portRe = new RegExp(`EADDRINUSE|port ${PORT} is in use|Is port ${PORT} in use`, 'i')
  const scan = (d) => { if (portRe.test(String(d))) portConflict = true }
  child.stdout?.on('data', scan)
  child.stderr?.on('data', scan)
  current = child

  child.on('exit', (code, signal) => {
    current = null
    console.log(`[supervisor] server exited (code=${code} signal=${signal})`)
    const shortLived = Date.now() - sinceLastStart < 15_000
    // Reset the backoff/streak once a run stayed up a while — this only guards
    // genuine crash loops, not the deliberate one-shot updater restart.
    if (!shortLived) { attempt = 1; portStreak = 0 }

    // Port 3000 held by another process (often an orphaned prior dev server).
    // Retry a couple of times to ride out a restart race, then stop looping and
    // print exactly how to free the port instead of reinstalling forever.
    if (portConflict && shortLived && !deliberate) {
      portStreak++
      if (portStreak >= 3) {
        portHelp()
        process.exit(1)
      }
      console.error(`[supervisor] port ${PORT} band — bir lahzada qayta urinamiz (${portStreak}/3)…`)
      setTimeout(() => cycle(false), 3_000)
      return
    }

    const nextInstall = deliberate || !shortLived
    deliberate = false
    const delay = Math.min(500 * attempt, 8_000)
    setTimeout(() => cycle(nextInstall), delay)
  })
}

// The in-app updater drops `.sud-restart` after a successful pull; poll for it
// and cycle the running server when it appears.
setInterval(() => {
  if (!restarting && current && existsSync(RESTART_SENTINEL)) {
    restarting = true
    deliberate = true // force a reinstall/rebuild on this respawn (code changed)
    try { unlinkSync(RESTART_SENTINEL) } catch { /* best effort */ }
    console.log('[supervisor] update requested — restarting the server')
    killTree(current) // → child 'exit' handler → cycle() respawns with new code
  }
}, 1000)

// Forward Ctrl+C / termination to the whole child tree instead of orphaning it.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    killTree(current)
    process.exit(0)
  })
}

void cycle()
