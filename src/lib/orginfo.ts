/**
 * orginfo.uz — Company information lookup service.
 *
 * orginfo.uz is a public directory of Uzbekistan organizations. Given a TIN/STIR
 * (9-digit tax ID), it returns the full company profile: official name, status,
 * registration date, legal form, activity code, contact info, director, founders,
 * etc.
 *
 * The site is server-rendered HTML — no API, no auth, no captcha needed.
 * We scrape the HTML directly with regex.
 */

const ORGINFO_BASE = 'https://orginfo.uz'

// ---- Server-side in-memory TIN -> company-name cache (24h TTL) ----------
// orginfo.uz is flaky and frequently times out. To avoid hammering it for the
// same TIN every time a stats / company-info / case-detail request comes in,
// we cache the company name (and minimal CompanyInfo) for 24 hours. The full
// CompanyInfo is still fetched on cache miss; subsequent hits return the cached
// minimal object so callers that only need the name (stats classification,
// upcoming-hearings matching) get an instant response.
interface TinCacheEntry {
  info: CompanyInfo
  ts: number
}
const tinCache = new Map<string, TinCacheEntry>()
const TIN_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

// ---- CF Worker proxy helper (same pattern as jadval2.ts / chamber.ts) ----
// orginfo.uz will block the server IP on sustained direct requests, so EVERY
// fetch is routed through the Cloudflare Worker pool (round-robin). We NEVER
// fetch orginfo.uz directly. Falls back to direct ONLY if no workers are
// configured (so the app still works in dev without .env, but production
// must always have CF_WORKER_URLS set).

// v150 P3: Uses shared cf-worker-pool.ts instead of duplicate logic
import { createWorkerPool } from './cf-worker-pool'
const _workerPool = createWorkerPool()
function getCfWorkerUrl(url: string): string {
  return _workerPool.nextProxyUrl(url)
}

export interface CompanyInfo {
  tin: string
  officialName: string
  shortName: string
  registeredDate: string
  status: string
  registeringAuthority: string
  thsht: string
  dbibt: string
  ifut: string
  charterCapital: string
  email: string
  phone: string
  address: string
  director: string
  founders: { name: string; share: string }[]
  sustainabilityRating: string
  largeTaxpayer: string
  orgInfoUrl: string
}

export interface CompanySearchResult {
  orgId: string
  name: string
  tin: string
  date: string
  region: string
  orgInfoUrl: string
}

/**
 * Search organizations on orginfo.uz by name or TIN.
 * Returns a list of matching companies with basic info.
 *
 * The search endpoint /uz/search/all/?q={query} returns server-rendered HTML
 * with org cards. Each card contains: name, STIR (TIN), date, region.
 */
export async function searchCompanies(query: string): Promise<CompanySearchResult[]> {
  console.log(`[orginfo] searching for "${query}"`)
  const searchUrl = `${ORGINFO_BASE}/uz/search/all/?q=${encodeURIComponent(query)}`
  const html = await fetchHtml(searchUrl)

  return parseSearchResults(html)
}

/**
 * Search for an organization by TIN/STIR and return its full profile.
 *
 * v116 optimization: the first 2 candidate org pages are fetched IN PARALLEL
 * (instead of sequentially). If a match is found in the first batch, we return
 * immediately. Only if neither of the first 2 matches do we fall through and
 * fetch the 3rd+ candidates sequentially. This cuts worst-case latency from
 * (N × 15s) to (15s + (N-2) × 15s) and common-case latency roughly in half.
 */
export async function getCompanyByTin(tin: string): Promise<CompanyInfo | null> {
  console.log(`[orginfo] searching for TIN ${tin}`)

  // 24h cache hit — return the cached CompanyInfo immediately. This makes
  // subsequent stats / company-info requests for the same TIN instant.
  const cached = tinCache.get(tin)
  if (cached && Date.now() - cached.ts < TIN_CACHE_TTL) {
    console.log(`[orginfo] TIN ${tin} served from cache (age ${Math.round((Date.now() - cached.ts) / 1000)}s)`)
    return cached.info
  }

  const searchUrl = `${ORGINFO_BASE}/uz/search/all/?q=${encodeURIComponent(tin)}`
  const searchHtml = await fetchHtml(searchUrl)
  const orgIds = extractOrgIds(searchHtml)

  if (orgIds.length === 0) {
    console.log(`[orginfo] no organizations found for TIN ${tin}`)
    return null
  }

  console.log(`[orginfo] found ${orgIds.length} candidates: ${orgIds.join(', ')}`)

  // Fetch the first 2 candidate org pages IN PARALLEL
  const firstBatch = orgIds.slice(0, 2)
  const rest = orgIds.slice(2)

  const firstResults = await Promise.all(
    firstBatch.map(async orgId => {
      const orgUrl = `${ORGINFO_BASE}/uz/organization/${orgId}/`
      const orgHtml = await fetchHtml(orgUrl)
      return { orgId, orgUrl, orgHtml }
    }),
  )

  // Check the first-batch results in original order — return the first match
  for (const { orgId, orgUrl, orgHtml } of firstResults) {
    const stir = extractField(orgHtml, 'STIR')
    if (stir === tin) {
      console.log(`[orginfo] found matching org: ${orgId}`)
      const info = parseCompanyPage(orgHtml, tin, orgUrl)
      // Cache the successful result for 24h.
      if (info && (info.shortName || info.officialName)) {
        tinCache.set(tin, { info, ts: Date.now() })
      }
      return info
    }
  }

  // First batch didn't match — fall through to remaining candidates sequentially
  for (const orgId of rest) {
    const orgUrl = `${ORGINFO_BASE}/uz/organization/${orgId}/`
    const orgHtml = await fetchHtml(orgUrl)
    const stir = extractField(orgHtml, 'STIR')

    if (stir === tin) {
      console.log(`[orginfo] found matching org: ${orgId}`)
      const info = parseCompanyPage(orgHtml, tin, orgUrl)
      if (info && (info.shortName || info.officialName)) {
        tinCache.set(tin, { info, ts: Date.now() })
      }
      return info
    }
  }

  console.log(`[orginfo] no match in search results`)
  return null
}

/**
 * Search for an organization by NAME and return just its TIN.
 * This is FAST (1 HTTP request) — it only fetches the search results page,
 * which already contains the TIN. It skips fetching the org detail page.
 *
 * Used by the court case detail view to auto-lookup plaintiff/defendant TINs
 * without the 5-10s delay of fetching the full org page.
 */
export async function lookupTinByName(name: string): Promise<string | null> {
  console.log(`[orginfo] TIN lookup for: ${name.substring(0, 50)}`)

  // Clean the name for better matching
  const cleanName = name
    .replace(/["«»"„"]/g, '')
    .replace(/MAS'ULIYATI CHEKLANGAN JAMIYAT/i, '')
    .replace(/MAS\x27ULIYATI CHEKLANGAN JAMIYAT/i, '')
    .replace(/AKSIYADORLIK JAMIYATI/i, '')
    .replace(/QOSHMA KORXONA/i, '')
    .replace(/QO`SHMA KORXONA/i, '')
    .replace(/MCHJ/i, '')
    .replace(/AJ/i, '')
    .replace(/OAO/i, '')
    .replace(/OOO/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const searchQuery = cleanName.length > 3 ? cleanName : name.replace(/["«»"„"]/g, '').trim()

  // Single HTTP request — the search page contains the TIN in the card HTML
  const results = await searchCompanies(searchQuery)
  if (results.length === 0) {
    // One retry with shorter name (first 3 words)
    const shortName = name.replace(/["«»"„"]/g, '').split(' ').slice(0, 3).join(' ').trim()
    if (shortName !== searchQuery) {
      console.log(`[orginfo] retrying with shorter name: ${shortName}`)
      const results2 = await searchCompanies(shortName)
      if (results2.length > 0) {
        return pickBestTin(results2, searchQuery)
      }
    }
    return null
  }

  return pickBestTin(results, searchQuery)
}

/** Pick the best TIN from search results by matching query words. */
function pickBestTin(results: CompanySearchResult[], searchQuery: string): string | null {
  const queryWords = searchQuery.toLowerCase().split(' ').filter(w => w.length > 2)
  let bestTin: string | null = null
  let bestScore = -1

  for (const result of results) {
    if (!result.tin || result.tin === '—' || !/^\d{9}$/.test(result.tin)) continue
    const resultName = result.name.replace(/["«»"„"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
    const matchWords = queryWords.filter(w => resultName.includes(w))
    const score = matchWords.length / Math.max(queryWords.length, 1)
    if (score > bestScore) {
      bestScore = score
      bestTin = result.tin
    }
  }

  // If no good word match, just use the first result with a valid TIN
  if (!bestTin) {
    const firstWithTin = results.find(r => r.tin && r.tin !== '—' && /^\d{9}$/.test(r.tin))
    bestTin = firstWithTin?.tin ?? null
  }

  console.log(`[orginfo] TIN found: ${bestTin} (score: ${bestScore.toFixed(2)})`)
  return bestTin
}

/**
 * Search for an organization by NAME and return its full profile.
 * Used to look up plaintiff/defendant company info from court cases.
 *
 * Returns the best match (first result) or null if no results.
 */
export async function getCompanyByName(name: string): Promise<CompanyInfo | null> {
  console.log(`[orginfo] searching by name: ${name}`)

  // Clean the name: remove quotes, extra spaces, legal suffixes for better matching
  const cleanName = name
    .replace(/["«»"„"]/g, '')
    .replace(/MAS'ULIYATI CHEKLANGAN JAMIYAT/i, '')
    .replace(/MAS\x27ULIYATI CHEKLANGAN JAMIYAT/i, '')
    .replace(/AKSIYADORLIK JAMIYATI/i, '')
    .replace(/QOSHMA KORXONA/i, '')
    .replace(/MCHJ/i, '')
    .replace(/AJ/i, '')
    .replace(/OAO/i, '')
    .replace(/OOO/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  // If the cleaned name is too short, try the original
  const searchQuery = cleanName.length > 3 ? cleanName : name.replace(/["«»"„"]/g, '').trim()

  const results = await searchCompanies(searchQuery)
  if (results.length === 0) {
    // Retry with just the first 3 words of the original name
    const shortName = name.replace(/["«»"„"]/g, '').split(' ').slice(0, 3).join(' ').trim()
    if (shortName !== searchQuery) {
      console.log(`[orginfo] retrying with shorter name: ${shortName}`)
      const results2 = await searchCompanies(shortName)
      if (results2.length > 0) {
        return pickBestMatch(results2, name, searchQuery)
      }
    }
    console.log(`[orginfo] no results for name "${searchQuery}"`)
    return null
  }

  return pickBestMatch(results, name, searchQuery)
}

function pickBestMatch(
  results: CompanySearchResult[],
  originalName: string,
  searchQuery: string,
): Promise<CompanyInfo | null> {
  // Score each result by how many query words appear in the result name
  const queryWords = searchQuery.toLowerCase().split(' ').filter(w => w.length > 2)
  let bestResult: CompanySearchResult | null = null
  let bestScore = -1

  for (const result of results) {
    const resultName = result.name
      .replace(/["«»"„"]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()

    const matchWords = queryWords.filter(w => resultName.includes(w))
    const score = matchWords.length / Math.max(queryWords.length, 1)

    // Bonus: if TIN is present and valid, it's likely a real company
    const tinBonus = result.tin && result.tin !== '—' && /^\d{9}$/.test(result.tin) ? 0.1 : 0

    const totalScore = score + tinBonus
    if (totalScore > bestScore) {
      bestScore = totalScore
      bestResult = result
    }
  }

  if (!bestResult) {
    bestResult = results[0]
  }

  console.log(
    `[orginfo] best match: ${bestResult.name} (TIN: ${bestResult.tin}, score: ${bestScore.toFixed(2)})`,
  )
  const orgUrl = `${ORGINFO_BASE}/uz/organization/${bestResult.orgId}/`
  const orgHtml = fetchHtml(orgUrl).then(html =>
    parseCompanyPage(html, bestResult!.tin, orgUrl),
  )
  return orgHtml
}

// ---- HTML fetching ----

async function fetchHtml(url: string, retries = 1): Promise<string> {
  const proxiedUrl = getCfWorkerUrl(url)
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(proxiedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html',
          'Accept-Language': 'uz,en;q=0.9',
        },
        signal: AbortSignal.timeout(6000),
        redirect: 'follow' as RequestRedirect,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      console.error(`[orginfo] fetch attempt ${attempt + 1} failed: ${e instanceof Error ? e.message : e}`)
      if (attempt < retries) await new Promise(r => setTimeout(r, 500))
    }
  }
  return ''
}

// ---- HTML parsing ----

function extractOrgIds(html: string): string[] {
  // Extract the org ID from URLs like /uz/organization/d18c10ce8727/
  // Use a capture group to get just the ID, not the full URL
  const matches = [...html.matchAll(/\/uz\/organization\/([a-f0-9]+)\//g)]
  const ids = [...new Set(matches.map(m => m[1]).filter(Boolean))]
  return ids
}

/**
 * Parse search results page HTML to extract company cards.
 * Each card has: org link (with ID), name, STIR, date, region.
 */
function parseSearchResults(html: string): CompanySearchResult[] {
  const clean = html.replace(/<script[^>]*>.*?<\/script>/gs, '').replace(/<style[^>]*>.*?<\/style>/gs, '')
  const results: CompanySearchResult[] = []
  const seen = new Set<string>()

  // Find all org links and extract surrounding context
  const linkPattern = /\/uz\/organization\/([a-f0-9]+)\//g
  let match: RegExpExecArray | null
  while ((match = linkPattern.exec(clean)) !== null) {
    const orgId = match[1]
    if (seen.has(orgId)) continue
    seen.add(orgId)

    // Get the surrounding HTML (500 chars after the link)
    const after = clean.substring(match.index, match.index + 800)

    // Extract name (first significant text after the link)
    const nameMatch = after.match(/(?:heading|h[1-6]|a)[^>]*>([^<]{5,150})</)
    const name = nameMatch
      ? nameMatch[1].replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim()
      : '—'

    // Extract STIR (9-digit number)
    const tinMatch = after.match(/(\d{9})/)
    const tin = tinMatch ? tinMatch[1] : '—'

    // Extract date (DD.MM.YYYY)
    const dateMatch = after.match(/(\d{2}\.\d{2}\.\d{4})/)
    const date = dateMatch ? dateMatch[1] : '—'

    // Extract region (text after "location" icon or in address-like text)
    const regionMatch = after.match(/location[^>]*>([^<]+)/i)
    const region = regionMatch ? regionMatch[1].trim() : '—'

    results.push({
      orgId,
      name,
      tin,
      date,
      region,
      orgInfoUrl: `${ORGINFO_BASE}/uz/organization/${orgId}/`,
    })
  }

  return results
}

function extractField(html: string, fieldName: string): string {
  // Remove scripts and styles
  const clean = html.replace(/<script[^>]*>.*?<\/script>/gs, '').replace(/<style[^>]*>.*?<\/style>/gs, '')
  // Find ALL occurrences of the field name — the first ones are in meta/title tags,
  // the actual data field is further down in the <body>.
  let searchFrom = 0
  while (true) {
    const idx = clean.indexOf(fieldName, searchFrom)
    if (idx < 0) return ''
    const after = clean.substring(idx + fieldName.length, idx + fieldName.length + 500)
    // Extract text between > and <
    const texts = after.match(/>([^<]+)</g) || []
    for (const t of texts) {
      const val = t.replace(/[><]/g, '').trim()
      if (val && val !== fieldName && !val.startsWith('Loading') && !val.startsWith('Parol') && !val.startsWith('-') && val.length > 0) {
        return val
          .replace(/&#x27;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim()
      }
    }
    searchFrom = idx + 1
  }
}

function extractPhone(html: string): string {
  // The phone appears in the contacts section. Search for "Telefon raqami"
  // (NOT "Telefon raqamini" which is the hide-phone service).
  const clean = html.replace(/<script[^>]*>.*?<\/script>/gs, '').replace(/<style[^>]*>.*?<\/style>/gs, '')
  let searchFrom = 0
  while (true) {
    const idx = clean.indexOf('Telefon raqami', searchFrom)
    if (idx < 0) return ''
    // Skip "Telefon raqamini" (hide phone service)
    const nextChar = clean[idx + 14]
    if (nextChar === 'n' || nextChar === 'N') {
      searchFrom = idx + 1
      continue
    }
    // Found the actual "Telefon raqami" label — extract phone number
    const after = clean.substring(idx + 14, idx + 500)
    // Look for a digit sequence (phone number) in the following HTML
    const phoneMatch = after.match(/(\+?\d[\d\s-]{5,14}\d)/)
    if (phoneMatch) return phoneMatch[1].trim()
    searchFrom = idx + 1
  }
}

function extractMultipleFields(html: string, fieldName: string): string[] {
  const clean = html.replace(/<script[^>]*>.*?<\/script>/gs, '').replace(/<style[^>]*>.*?<\/style>/gs, '')
  const results: string[] = []
  let searchFrom = 0
  while (true) {
    const idx = clean.indexOf(fieldName, searchFrom)
    if (idx < 0) break
    const after = clean.substring(idx + fieldName.length, idx + fieldName.length + 500)
    const texts = after.match(/>([^<]+)</g) || []
    for (const t of texts) {
      const val = t.replace(/[><]/g, '').trim()
      if (val && val !== fieldName && !val.startsWith('Loading') && !val.startsWith('Parol') && !val.startsWith('-')) {
        results.push(val.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
        break
      }
    }
    searchFrom = idx + 1
  }
  return results
}

function parseCompanyPage(html: string, tin: string, url: string): CompanyInfo {
  // Extract founders (they appear as links with percentage)
  const foundersHtml = html.match(/Ta'sischilar.*?(?=<region|<div class="col-12|<section)/s)?.[0] || ''
  const founderMatches = foundersHtml.matchAll(/>([A-Z][^<]{5,80}(?:OGLI|O'G'LI|QIZI)?)<.*?>([\d.]+)\s*%/g) || []
  const founders: { name: string; share: string }[] = []
  for (const m of founderMatches) {
    founders.push({
      name: m[1].trim().replace(/&#x27;/g, "'"),
      share: m[2] + '%',
    })
  }

  // Extract address (multi-line)
  const addressIdx = html.indexOf('Manzili')
  let address = ''
  if (addressIdx >= 0) {
    const after = html.substring(addressIdx + 7, addressIdx + 500)
    const texts = after.match(/>([^<]+)</g) || []
    const addrParts: string[] = []
    for (const t of texts) {
      const val = t.replace(/[><]/g, '').trim()
      if (val && !val.startsWith('Loading') && !val.startsWith('Kirish') && val.length > 3) {
        addrParts.push(val)
        if (addrParts.length >= 3) break
      }
    }
    address = addrParts.join(', ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
  }

  // The orginfo.uz organization page historically renders the official-name
  // and short-name labels in Russian ("Официальное название организации" /
  // "Краткое название организации"). Some pages also expose Latin-Uzbek
  // labels ("Rasmiy nomi" / "Qisqa nomi"). Try the Russian label first
  // (most reliable across all org pages), then fall back to the Latin label.
  const officialName =
    extractField(html, 'Официальное название организации') ||
    extractField(html, 'Rasmiy nomi')
  const shortName =
    extractField(html, 'Краткое название организации') ||
    extractField(html, 'Qisqa nomi')

  return {
    tin,
    officialName,
    shortName,
    registeredDate: extractField(html, "Ro'yxatdan o'tgan sana"),
    status: extractField(html, 'Faollik holati'),
    registeringAuthority: extractField(html, "Ro'yxatdan o'tkazuvchi organ"),
    thsht: extractField(html, 'THSHT'),
    dbibt: extractField(html, 'DBIBT'),
    ifut: extractField(html, 'IFUT'),
    charterCapital: extractField(html, 'Ustav fondi'),
    email: extractField(html, 'Elektron pochta'),
    phone: extractPhone(html),
    address,
    director: extractField(html, 'Rahbar'),
    founders,
    sustainabilityRating: extractField(html, 'Toifa'),
    largeTaxpayer: extractField(html, 'Yirik soliq'),
    orgInfoUrl: url,
  }
}
