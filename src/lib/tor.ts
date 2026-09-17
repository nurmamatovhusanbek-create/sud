import * as https from 'https'
import * as http from 'http'
import * as net from 'net'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import * as path from 'path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SocksProxyAgent } = require('socks-proxy-agent') as typeof import('socks-proxy-agent')

/**
 * Tor SOCKS proxy manager.
 *
 * billing.sud.uz may block direct connections from certain IPs. This module
 * manages a Tor SOCKS5 proxy on 127.0.0.1:9050 to bypass such blocks.
 *
 * Lookup order for the tor binary:
 *   1. If a SOCKS proxy is already listening on port 9050, use it (tor already
 *      running externally).
 *   2. Otherwise, look for the tor binary in these locations and spawn it:
 *        - ./tor/tor.exe   (Windows — downloaded by the user)
 *        - ./tor/tor       (Linux/macOS)
 *        - /tmp/tor/tor    (Linux sandbox)
 *   3. If no binary is found, requests fall back to a direct connection.
 */

const SOCKS_PORT = 9050
const TOR_DATA_DIR = path.join(process.cwd(), '.tor-data')
const TOR_LOG_DIR = path.join(process.cwd(), '.tor-log')
const NOTICE_LOG = path.join(TOR_LOG_DIR, 'notice.log')

// Candidate locations for the tor binary (checked in order).
const TOR_BINARY_CANDIDATES = [
  path.join(process.cwd(), 'tor', 'tor.exe'), // Windows local
  path.join(process.cwd(), 'tor', 'tor'), // Linux/macOS local
  '/tmp/tor/tor', // Linux sandbox
]

let proxyAgent: InstanceType<typeof SocksProxyAgent> | null = null
let torProcess: ChildProcess | null = null
let availabilityChecked = false

/** Check if a TCP port is listening (used to detect an already-running tor). */
export function isSocksPortOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(1500)
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => {
      socket.destroy()
      resolve(false)
    })
    socket.connect(SOCKS_PORT, '127.0.0.1')
  })
}

/** Find the tor binary at one of the candidate paths. */
export function findTorBinaryPath(): string | null {
  for (const candidate of TOR_BINARY_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Write a torrc config file and return its path. */
function writeTorrc(binaryPath: string): string {
  const torDir = path.dirname(binaryPath)
  const torrcPath = path.join(torDir, 'torrc')
  mkdirSync(TOR_DATA_DIR, { recursive: true })
  mkdirSync(TOR_LOG_DIR, { recursive: true })
  writeFileSync(
    torrcPath,
    [
      `SOCKSPort 127.0.0.1:${SOCKS_PORT}`,
      `DataDirectory ${TOR_DATA_DIR}`,
      `Log notice file ${NOTICE_LOG}`,
      `AvoidDiskWrites 1`,
      `ExitPolicy accept *:*`,
      '',
    ].join('\n'),
  )
  return torrcPath
}

/** Wait for tor to bootstrap by polling the notice log. */
function waitForBootstrap(timeoutMs = 120000): Promise<boolean> {
  const start = Date.now()
  try {
    writeFileSync(NOTICE_LOG, '')
  } catch {
    // ignore
  }
  return new Promise((resolve) => {
    const check = () => {
      try {
        const content = readFileSync(NOTICE_LOG, 'utf-8')
        if (content.includes('Bootstrapped 100%')) {
          resolve(true)
          return
        }
      } catch {
        // file might not exist yet
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false)
        return
      }
      setTimeout(check, 1000)
    }
    check()
  })
}

/** Spawn the tor binary and wait for it to bootstrap. */
async function spawnTor(): Promise<boolean> {
  const binary = findTorBinaryPath()
  if (!binary) {
    console.error('[tor] no tor binary found — searched:', TOR_BINARY_CANDIDATES)
    return false
  }
  const torrc = writeTorrc(binary)
  const torDir = path.dirname(binary)

  // Kill any previous tor process first.
  if (torProcess) {
    try { torProcess.kill() } catch { /* ignore */ }
    torProcess = null
  }

  console.log('[tor] starting tor from', binary)
  // On Windows the tor.exe needs its DLLs from the same folder; setting cwd
  // ensures it can find them. LD_LIBRARY_PATH is for Linux (harmless on Windows).
  torProcess = spawn(binary, ['-f', torrc], {
    env: { ...process.env, LD_LIBRARY_PATH: torDir },
    cwd: torDir,
    stdio: 'ignore',
    windowsHide: true,
  })

  torProcess.on('error', (err) => {
    console.error('[tor] spawn error:', err.message)
    torProcess = null
  })

  torProcess.on('exit', (code, signal) => {
    console.log(`[tor] exited (code=${code} signal=${signal})`)
    torProcess = null
    proxyAgent = null
    availabilityChecked = false
  })

  const ok = await waitForBootstrap()
  if (ok) {
    console.log('[tor] bootstrapped ✓ — SOCKS proxy on 127.0.0.1:' + SOCKS_PORT)
  } else {
    console.error('[tor] bootstrap timed out')
  }
  return ok
}

/**
 * Ensure tor is running and the SOCKS proxy is available.
 * - If port 9050 is already open, uses the existing proxy.
 * - Otherwise spawns tor from a local binary if found.
 * - If tor died, restarts it.
 * - Returns false if tor isn't available (caller should fall back to direct).
 */
export async function ensureTor(): Promise<boolean> {
  // If we have a working proxy, verify tor is still alive.
  if (proxyAgent && availabilityChecked) {
    const alive = await isSocksPortOpen()
    if (alive) return true
    // Tor died — reset and respawn.
    console.log('[tor] proxy lost, restarting...')
    proxyAgent = null
    availabilityChecked = false
  }

  // 1. Check if tor is already running externally.
  const alreadyRunning = await isSocksPortOpen()
  if (alreadyRunning) {
    proxyAgent = new SocksProxyAgent(`socks5://127.0.0.1:${SOCKS_PORT}`)
    availabilityChecked = true
    console.log('[tor] detected existing SOCKS proxy on 127.0.0.1:' + SOCKS_PORT)
    return true
  }

  // 2. Try to spawn tor from a local binary.
  const spawned = await spawnTor()
  if (!spawned) return false

  proxyAgent = new SocksProxyAgent(`socks5://127.0.0.1:${SOCKS_PORT}`)
  availabilityChecked = true
  return true
}

/** Get the SOCKS proxy agent (or null if tor isn't available). */
export function getTorProxyAgent() {
  return proxyAgent
}

/**
 * Rotate the Tor circuit by killing and restarting the tor process.
 * This forces Tor to build a new circuit with a DIFFERENT exit node —
 * useful when billing.sud.uz blocks the current exit node (ECONNREFUSED).
 *
 * Returns true if the new circuit is ready, false if rotation failed.
 */
export async function rotateTorCircuit(): Promise<boolean> {
  console.log('[tor] rotating circuit (killing and restarting tor for a new exit node)...')

  // Kill the existing tor process.
  if (torProcess) {
    try {
      torProcess.kill('SIGTERM')
    } catch {
      // ignore
    }
    torProcess = null
  }
  proxyAgent = null
  availabilityChecked = false

  // Wait a moment for the port to be released.
  await new Promise((r) => setTimeout(r, 1500))

  // Spawn a fresh tor process — it will build a new circuit.
  const ok = await spawnTor()
  if (ok) {
    proxyAgent = new SocksProxyAgent(`socks5://127.0.0.1:${SOCKS_PORT}`)
    availabilityChecked = true
    console.log('[tor] circuit rotated — new exit node active ✓')
  } else {
    console.error('[tor] circuit rotation failed')
  }
  return ok
}

// ---- fetch-compatible wrapper that routes through the Tor SOCKS proxy ----

export interface TorFetchResponse {
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  text: () => Promise<string>
}

/**
 * Make an HTTPS request through the Tor SOCKS5 proxy. Returns a fetch-like
 * response object so it's a drop-in replacement for `fetch` in billing.ts.
 */
export async function fetchViaTor(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<TorFetchResponse> {
  const ok = await ensureTor()
  if (!ok || !proxyAgent) {
    throw new Error('Tor SOCKS proxy is not available on 127.0.0.1:' + SOCKS_PORT)
  }

  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const options: https.RequestOptions = {
      method: init.method || 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: init.headers || {},
      agent: proxyAgent ?? undefined,
    }

    const req = parsed.protocol === 'https:' ? https.request(options) : http.request(options)

    const timeout = setTimeout(() => {
      req.destroy(new Error('Request timed out (60s via tor)'))
    }, 60000)

    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        clearTimeout(timeout)
        const body = Buffer.concat(chunks).toString('utf-8')
        resolve({
          ok: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          statusText: res.statusMessage || '',
          json: async () => JSON.parse(body),
          text: async () => body,
        })
      })
      res.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    req.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    if (init.body) {
      req.write(init.body)
    }
    req.end()
  })
}
