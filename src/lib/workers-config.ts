/**
 * v158: File-based CF Worker URL persistence.
 *
 * Workers are stored in /workers.json at the project root. This lets users
 * add/remove worker URLs via the Settings UI without editing .env or
 * redeploying. The file is hot-read (5s cache) so changes take effect on
 * the next request — no restart needed.
 *
 * Precedence in getCfWorkerUrls():
 *   1. workers.json (if exists and has ≥1 worker)
 *   2. CF_WORKER_URLS env (comma-separated)
 *   3. CF_WORKER_URL env (single, backward compat)
 *   4. FALLBACK_WORKERS (hardcoded)
 */

import fs from 'fs'
import path from 'path'

export interface WorkerEntry {
  url: string
  addedAt: string
  lastTestedAt: string | null
  lastTestResult: 'ok' | 'fail' | null
  lastTestDetail?: string
}

interface WorkersFile {
  version: number
  updatedAt: string
  workers: WorkerEntry[]
}

const WORKERS_FILE = path.resolve(process.cwd(), 'workers.json')
const CACHE_TTL_MS = 5000 // 5 seconds

let _cachedFile: WorkersFile | null = null
let _cachedAt = 0
let _cachedMtime = 0

/**
 * Normalize a worker URL: trim, ensure https://, ensure trailing /.
 * Returns null if the URL is invalid.
 */
export function normalizeWorkerUrl(url: string): string | null {
  let u = url.trim()
  if (!u) return null
  if (!u.startsWith('https://')) return null
  // Reject URLs with paths (worker must be root-mounted)
  try {
    const parsed = new URL(u)
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null
    // Ensure trailing slash
    u = parsed.origin + '/'
  } catch {
    return null
  }
  // Collapse double slashes
  u = u.replace(/\/+$/, '/') 
  return u
}

/**
 * Read workers.json from disk (with 5s in-memory cache).
 * Returns null if the file doesn't exist or is invalid.
 */
function readWorkersFile(): WorkersFile | null {
  try {
    const stats = fs.statSync(WORKERS_FILE)
    const now = Date.now()

    // Check cache freshness (TTL + mtime)
    if (_cachedFile && (now - _cachedAt < CACHE_TTL_MS) && stats.mtimeMs === _cachedMtime) {
      return _cachedFile
    }

    const raw = fs.readFileSync(WORKERS_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as WorkersFile
    if (!parsed.workers || !Array.isArray(parsed.workers)) return null

    _cachedFile = parsed
    _cachedAt = now
    _cachedMtime = stats.mtimeMs
    return parsed
  } catch {
    _cachedFile = null
    return null
  }
}

/**
 * Write workers.json atomically (temp file + rename).
 */
function writeWorkersFile(workers: WorkerEntry[]): void {
  const data: WorkersFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    workers,
  }
  const tmp = WORKERS_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, WORKERS_FILE)
  // Invalidate cache
  _cachedFile = null
  _cachedAt = 0
}

/**
 * Get the list of worker URLs from workers.json.
 * Returns empty array if file doesn't exist.
 */
export function getWorkerUrls(): string[] {
  const file = readWorkersFile()
  if (!file || file.workers.length === 0) return []
  return file.workers.map(w => w.url)
}

/**
 * Get the source of worker URLs ('file' | 'env' | 'fallback').
 */
export function getWorkerSource(): 'file' | 'env' | 'fallback' {
  const file = readWorkersFile()
  if (file && file.workers.length > 0) return 'file'
  if (process.env.CF_WORKER_URLS || process.env.CF_WORKER_URL) return 'env'
  return 'fallback'
}

/**
 * Get full worker entries (with metadata) from workers.json.
 */
export function getWorkerEntries(): WorkerEntry[] {
  const file = readWorkersFile()
  if (!file) return []
  return file.workers
}

/**
 * Add a worker URL to workers.json.
 * v164: If workers.json doesn't exist yet, seed it with the current fallback/env
 * workers FIRST, then add the new one. This prevents pre-set workers from
 * disappearing when a user adds their first custom worker.
 * Returns the added entry, or null if duplicate/invalid.
 */
export function addWorker(url: string): WorkerEntry | null {
  const normalized = normalizeWorkerUrl(url)
  if (!normalized) return null

  let file = readWorkersFile()
  let workers = file?.workers || []

  // v164: If workers.json doesn't exist or is empty, seed with current
  // fallback/env workers so they're not lost when the first custom worker
  // is added.
  if (workers.length === 0) {
    // Inline the fallback worker list to avoid circular dependency
    const FALLBACK = [
      'https://broad-field-f2b0.uzwebfox.workers.dev/',
      'https://wild-hall-04ae.uzwebfox.workers.dev/',
      'https://orange-darkness-8843.najimsheikh071.workers.dev/',
      'https://wandering-wind-1d3d.najimsheikh071.workers.dev/',
    ]
    // Also check env for custom workers
    const envWorkers: string[] = []
    const multi = process.env.CF_WORKER_URLS
    if (multi) {
      for (const u of multi.split(',').map(s => s.trim()).filter(Boolean)) {
        envWorkers.push(u.endsWith('/') ? u : u + '/')
      }
    }
    const single = process.env.CF_WORKER_URL
    if (single) {
      const normalized = single.endsWith('/') ? single : single + '/'
      if (!envWorkers.includes(normalized)) envWorkers.push(normalized)
    }
    const currentWorkers = envWorkers.length > 0 ? envWorkers : FALLBACK
    const now = new Date().toISOString()
    workers = currentWorkers.map(w => ({
      url: w,
      addedAt: now,
      lastTestedAt: null,
      lastTestResult: null,
    }))
    console.log(`[workers-config] Seeded workers.json with ${workers.length} existing workers`)
  }

  // Check for duplicates
  if (workers.some(w => w.url === normalized)) return null

  const entry: WorkerEntry = {
    url: normalized,
    addedAt: new Date().toISOString(),
    lastTestedAt: null,
    lastTestResult: null,
  }

  workers.push(entry)
  writeWorkersFile(workers)
  return entry
}

/**
 * Remove a worker URL from workers.json.
 * Returns true if removed, false if not found.
 */
export function removeWorker(url: string): boolean {
  const normalized = normalizeWorkerUrl(url) || url
  const file = readWorkersFile()
  if (!file) return false

  const initialLen = file.workers.length
  file.workers = file.workers.filter(w => w.url !== normalized)
  if (file.workers.length === initialLen) return false

  writeWorkersFile(file.workers)
  return true
}

/**
 * Update the test result for a worker URL.
 */
export function updateWorkerTestResult(
  url: string,
  result: 'ok' | 'fail',
  detail?: string,
): void {
  const normalized = normalizeWorkerUrl(url) || url
  const file = readWorkersFile()
  if (!file) return

  const worker = file.workers.find(w => w.url === normalized)
  if (!worker) return

  worker.lastTestedAt = new Date().toISOString()
  worker.lastTestResult = result
  worker.lastTestDetail = detail
  writeWorkersFile(file.workers)
}
