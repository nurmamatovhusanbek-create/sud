/**
 * Tor SOCKS proxy manager mini-service.
 *
 * Spawns the tor binary and keeps it alive as a child process. The tor SOCKS5
 * proxy listens on 127.0.0.1:9050. The main Next.js app connects to it to
 * route billing.sud.uz requests (which blocks direct connections from this IP).
 *
 * Started with `bun run dev` — same mechanism as the main Next.js dev server,
 * so it persists across shell invocations.
 */

import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { createServer } from 'http'

const TOR_DIR = '/tmp/tor'
const TOR_BINARY = `${TOR_DIR}/tor`
const TOR_DATA = `${TOR_DIR}/tor-data`
const TOR_LOG = `${TOR_DIR}/tor-log`
const TORRC_PATH = `${TOR_DIR}/torrc`
const NOTICE_LOG = `${TOR_LOG}/notice.log`
const SOCKS_PORT = 9050
const HEALTH_PORT = 9051

let torProcess: ChildProcess | null = null
let bootstrapped = false

function writeTorrc() {
  mkdirSync(TOR_DATA, { recursive: true })
  mkdirSync(TOR_LOG, { recursive: true })
  writeFileSync(
    TORRC_PATH,
    [
      `SOCKSPort 127.0.0.1:${SOCKS_PORT}`,
      `DataDirectory ${TOR_DATA}`,
      `Log notice file ${NOTICE_LOG}`,
      `AvoidDiskWrites 1`,
      `ExitPolicy accept *:*`,
      '',
    ].join('\n'),
  )
}

async function ensureTorBinary(): Promise<boolean> {
  if (existsSync(TOR_BINARY)) return true
  console.log('[tor-manager] downloading tor expert bundle...')
  const url =
    'https://archive.torproject.org/tor-package-archive/torbrowser/15.0.16/tor-expert-bundle-linux-x86_64-15.0.16.tar.gz'
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync('/tmp/tor-bundle.tar.gz', buf)
    const { execSync } = await import('child_process')
    mkdirSync(TOR_DIR, { recursive: true })
    execSync(`tar xzf /tmp/tor-bundle.tar.gz -C ${TOR_DIR}`)
    console.log('[tor-manager] tor binary downloaded ✓')
    return existsSync(TOR_BINARY)
  } catch (err) {
    console.error('[tor-manager] download failed:', err)
    return false
  }
}

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

async function startTor() {
  const hasBinary = await ensureTorBinary()
  if (!hasBinary) {
    console.error('[tor-manager] tor binary not available')
    return false
  }
  writeTorrc()

  console.log('[tor-manager] starting tor (SOCKS on 127.0.0.1:' + SOCKS_PORT + ')...')
  torProcess = spawn(TOR_BINARY, ['-f', TORRC_PATH], {
    env: { ...process.env, LD_LIBRARY_PATH: TOR_DIR },
    stdio: 'ignore',
  })

  torProcess.on('error', (err) => {
    console.error('[tor-manager] tor spawn error:', err.message)
    torProcess = null
  })

  torProcess.on('exit', (code, signal) => {
    console.log(`[tor-manager] tor exited (code=${code} signal=${signal}) — restarting in 3s`)
    torProcess = null
    bootstrapped = false
    setTimeout(() => startTor().then((ok) => { if (ok) bootstrapped = true }), 3000)
  })

  const ok = await waitForBootstrap()
  if (ok) {
    bootstrapped = true
    console.log('[tor-manager] tor bootstrapped ✓ — SOCKS proxy ready on 127.0.0.1:' + SOCKS_PORT)
  } else {
    console.error('[tor-manager] tor bootstrap timed out')
  }
  return ok
}

// Health-check HTTP server
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      healthy: bootstrapped && torProcess !== null,
      socksPort: SOCKS_PORT,
      pid: torProcess?.pid ?? null,
    }))
  } else {
    res.writeHead(404)
    res.end('not found')
  }
})

async function main() {
  console.log('[tor-manager] starting...')
  await startTor()
  server.listen(HEALTH_PORT, '127.0.0.1', () => {
    console.log('[tor-manager] health check on http://127.0.0.1:' + HEALTH_PORT + '/health')
  })
  console.log('[tor-manager] running.')
}

main()

process.on('unhandledRejection', (err) => {
  console.error('[tor-manager] unhandledRejection:', err)
})
