/**
 * jadval2.sud.uz — Court hearing schedule API client.
 *
 * Fetches hearing data from jadvalapi.sud.uz for any court on any date.
 * Used to find hearings where a company appears as plaintiff or defendant,
 * even in courts that don't support TIN-based search.
 *
 * API: https://jadvalapi.sud.uz/vka/{TYPE}/{courtId}/{DDMMYYYY}
 * Returns JSON array of hearing objects.
 */

import 'server-only'

// ---- Types ---------------------------------------------------------------

export interface Jadval2Hearing {
  casenumber: string
  hearing_date: string    // DD.MM.YYYY
  hearing_time: string    // HH:MM
  responsible: string     // judge name
  instance: string        // "Birinchi instansiya" etc. (Cyrillic in API response)
  globalid: string        // court ID
  claimkind: string       // "SUIT" etc.
  claimtype: string       // "CIVIL", "ECONOMIC", etc.
  category: string        // case category
  case_id: string         // UUID
  claiment: string        // plaintiff (note: misspelled in API)
  defendant: string       // defendant
}

export interface Jadval2SearchResult {
  hearings: Jadval2Hearing[]
  courtId: string
  courtName: string
  datesScanned: number
  totalFound: number
}

// ---- Config --------------------------------------------------------------

const JADVALAPI_BASE = 'https://jadvalapi.sud.uz/vka'
const FETCH_TIMEOUT_MS = 6_000

// All court types to scan
const ALL_TYPES: ('CIVIL' | 'ECONOMIC' | 'CONFLICT')[] = ['CIVIL', 'ECONOMIC', 'CONFLICT']

// ---- CF Worker proxy helper (same as court-case.ts) ----------------------

// v150 P3: Uses shared cf-worker-pool.ts instead of duplicate logic
import { createWorkerPool } from './cf-worker-pool'
const _workerPool = createWorkerPool()
function getCfWorkerUrl(url: string): string {
  return _workerPool.nextProxyUrl(url)
}

// Known Uzbekistan court holidays (court offices closed — no hearings
// scheduled). Stored as MM-DD strings so we can compare against any year.
// Source: Uzbekistan Labor Code article 158 (official public holidays) plus
// the second-day observances courts typically follow (Jan 2, Navruz day 2).
const COURT_HOLIDAYS = new Set([
  '01-01', // New Year
  '01-02', // New Year (day 2)
  '03-08', // Women's Day
  '03-21', // Navruz
  '03-22', // Navruz (day 2)
  '05-09', // Victory Day
  '09-01', // Independence Day
  '10-01', // Teacher's Day
  '12-08', // Constitution Day
])

// ---- API -----------------------------------------------------------------

/**
 * Fetch hearings for a specific court on a specific date.
 *
 * @param courtId — court ID from the court map (e.g. "andtfsud")
 * @param dateStr — date in DDMMYYYY format (e.g. "09072026")
 * @param type — court type: "CIVIL", "ECONOMIC", "CONFLICT"
 */
export async function fetchHearingsForDate(
  courtId: string,
  dateStr: string,
  type: 'CIVIL' | 'ECONOMIC' | 'CONFLICT' = 'CIVIL',
): Promise<Jadval2Hearing[]> {
  const url = `${JADVALAPI_BASE}/${type}/${encodeURIComponent(courtId)}/${dateStr}`
  const proxiedUrl = getCfWorkerUrl(url)

  try {
    const res = await fetch(proxiedUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      console.log(`[jadval2] ${courtId} ${dateStr}: HTTP ${res.status}`)
      return []
    }
    const data = await res.json() as Jadval2Hearing[]
    if (!Array.isArray(data)) return []
    return data
  } catch (e) {
    console.log(`[jadval2] ${courtId} ${dateStr}: ${e instanceof Error ? e.message : 'error'}`)
    return []
  }
}

/**
 * Scan a date range for hearings matching a company name.
 *
 * Fetches hearings for each date in the range, filters by company name
 * appearing in claiment or defendant fields.
 *
 * @param courtId — court ID
 * @param courtName — court display name
 * @param companyName — company name to search for (case-insensitive)
 * @param startDate — Date object
 * @param endDate — Date object
 * @param type — court type
 * @param onProgress — callback for progress updates
 */
/**
 * Scan a date range for hearings matching a company name.
 * Scans ALL court types (CIVIL + ECONOMIC + CONFLICT) in parallel for each date.
 * Uses large batches for maximum speed.
 *
 * @param courtId — court ID
 * @param courtName — court display name
 * @param companyName — company name to search for (case-insensitive)
 * @param startDate — Date object
 * @param endDate — Date object
 * @param onProgress — callback for progress updates
 */
export async function scanDateRange(
  courtId: string,
  courtName: string,
  companyName: string,
  startDate: Date,
  endDate: Date,
  _type?: 'CIVIL' | 'ECONOMIC' | 'CONFLICT', // ignored — we always scan all types
  onProgress?: (scanned: number, total: number, found: number) => void,
): Promise<Jadval2SearchResult> {
  const nameLower = companyName.toLowerCase()
  const allHearings: Jadval2Hearing[] = []

  // Generate list of dates to scan (skip Sundays + known court holidays).
  // Sundays: courts are closed. Holidays: same — no hearings will be returned,
  // so we skip the request entirely and save a round-trip per date.
  const dates: Date[] = []
  const cur = new Date(startDate)
  while (cur <= endDate) {
    if (cur.getDay() !== 0) {
      const mmdd = `${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
      if (!COURT_HOLIDAYS.has(mmdd)) dates.push(new Date(cur))
    }
    cur.setDate(cur.getDate() + 1)
  }

  console.log(`[jadval2] scanning ${dates.length} dates × ${ALL_TYPES.length} types = ${dates.length * ALL_TYPES.length} requests for court ${courtId}`)

  // For each date, fetch all 3 court types in parallel.
  // Batch dates: 20 dates × 3 types = 60 parallel requests per batch.
  // With 4 CF workers round-robin, each worker handles ~15 requests per batch.
  const BATCH_SIZE = 30
  for (let i = 0; i < dates.length; i += BATCH_SIZE) {
    const batch = dates.slice(i, i + BATCH_SIZE)

    // For each date in batch, fetch all 3 types — all in parallel
    const promises: Promise<{ hearings: Jadval2Hearing[]; type: string }>[] = []
    for (const d of batch) {
      const dateStr = formatDate(d)
      for (const type of ALL_TYPES) {
        promises.push(
          fetchHearingsForDate(courtId, dateStr, type).then(hearings => ({ hearings, type }))
        )
      }
    }

    const results = await Promise.all(promises)

    for (const { hearings } of results) {
      const matched = hearings.filter(h =>
        h.claiment?.toLowerCase().includes(nameLower) ||
        h.defendant?.toLowerCase().includes(nameLower)
      )
      allHearings.push(...matched)
    }

    onProgress?.(Math.min(i + BATCH_SIZE, dates.length), dates.length, allHearings.length)
  }

  // Sort by date (newest first)
  allHearings.sort((a, b) => b.hearing_date.localeCompare(a.hearing_date))

  console.log(`[jadval2] done: ${allHearings.length} hearings found from ${dates.length} dates`)

  return {
    hearings: allHearings,
    courtId,
    courtName,
    datesScanned: dates.length,
    totalFound: allHearings.length,
  }
}

/** Format a Date as DDMMYYYY string for the API. */
function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}${month}${year}`
}
