/**
 * Two things that made the app slow or flaky to open (Windows, `bun run dev`):
 *
 *  1. `bun install` ran on EVERY start. Even «1 package installed» rewrites files in node_modules, and Turbopack then
 *     logs «has seen frequent file updates and is waiting for the filesystem to settle» and sits idle (on a synced or
 *     virus-scanned folder that can be tens of seconds). We now install only when package.json / bun.lock changed
 *     since the last successful install, or node_modules is missing.
 *  2. The FIRST request compiled the whole page while the browser sat on a spinner (35 s on the owner's machine, and a
 *     tab opened earlier could stay stuck). After the server says Ready we make that first request ourselves (plus the
 *     two local calls the page makes on load), so the browser opens onto an already compiled page.
 *
 * Pure helpers (no process state): tested in src/lib/__tests__/boot-helpers.test.ts.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'

const read = (p) => {
  try {
    return readFileSync(p)
  } catch {
    return null
  }
}

/** Hash of everything that decides what node_modules should contain. */
export function dependencyFingerprint(cwd) {
  const h = createHash('sha1')
  for (const f of ['package.json', 'bun.lock', 'bun.lockb']) {
    h.update(f)
    h.update(read(join(cwd, f)) ?? '')
  }
  return h.digest('hex')
}

const stampPath = (cwd) => join(cwd, 'node_modules', '.sud-install-stamp')

/** True when `bun install` has to run: no node_modules / Next, no stamp, or the dependency files changed. */
export function needsInstall(cwd) {
  if (!existsSync(join(cwd, 'node_modules', 'next', 'package.json'))) return true
  const stamp = read(stampPath(cwd))
  return !stamp || stamp.toString().trim() !== dependencyFingerprint(cwd)
}

/** Remember that node_modules matches the dependency files right now (call after a SUCCESSFUL install only). */
export function markInstalled(cwd) {
  try {
    mkdirSync(join(cwd, 'node_modules'), { recursive: true })
    writeFileSync(stampPath(cwd), dependencyFingerprint(cwd))
  } catch {
    /* best effort: without a stamp the next start just installs again */
  }
}

/** One GET; resolves with the HTTP status, or 0 when nothing answered. Never rejects. */
export function get(port, path, timeoutMs = 600_000) {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', timeout: timeoutMs }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
      res.on('error', () => resolve(0))
    })
    req.on('timeout', () => { req.destroy(); resolve(0) })
    req.on('error', () => resolve(0))
    req.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Compile the first page before a person asks for it. `alive()` says whether the server this warm-up belongs to is
 * still the current one (a restart makes the old warm-up stop). The server is not listening yet when this starts, so
 * the first request is retried (connection refused) until it answers or `maxWaitMs` passes. Resolves with the seconds
 * it took, or null when it was abandoned. Only LOCAL pages are requested: nothing here may reach a court site
 * (loading never scrapes).
 */
export async function warmUp({
  port,
  alive,
  paths = ['/', '/api/settings/health', '/api/public-orders/status'],
  get: fetcher = get,
  now = Date.now,
  wait = sleep,
  maxWaitMs = 10 * 60_000,
  retryMs = 500,
}) {
  const t0 = now()
  let status = 0
  while (alive() && status === 0) {
    status = await fetcher(port, paths[0])
    if (status === 0) {
      if (now() - t0 > maxWaitMs) return null
      await wait(retryMs)
    }
  }
  for (const p of paths.slice(1)) {
    if (!alive()) return null
    await fetcher(port, p)
  }
  return alive() ? Math.round((now() - t0) / 100) / 10 : null
}
