/**
 * ihamkor.uz scraper mini-service.
 *
 * Uses Puppeteer (headless Chrome) to bypass Cloudflare bot protection
 * and extract company data from ihamkor.uz.
 *
 * Port: 3030
 * Started with: bun --hot index.ts
 *
 * API:
 *   GET /api/scrape?tin=302678824
 *     → navigates to ihamkor.uz/oz/search?query=TIN
 *     → waits for Cloudflare challenge to resolve
 *     → extracts company data from the rendered page
 *     → returns JSON { ok, company, source }
 *
 * The Next.js app calls this via:
 *   fetch('/api/ihamkor?XTransformPort=3030&tin=302678824')
 * (Caddy gateway forwards to port 3030)
 *
 * Caching: results are cached in-memory for 30 minutes (TTL).
 * The first request takes 8-12s (browser launch + Cloudflare solve).
 * Subsequent requests for the same TIN return instantly from cache.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { URL } from 'url'

// ---- Config ----
const PORT = 3030
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const IHAMKOR_BASE = 'https://ihamkor.uz'

// ---- In-memory cache ----
interface CacheEntry {
  data: any
  ts: number
}
const cache = new Map<string, CacheEntry>()

// ---- Puppeteer lifecycle ----
// Keep a single browser instance alive across requests (faster — no re-launch).
let browser: any = null
let browserLaunchPromise: Promise<any> | null = null

async function getBrowser(): Promise<any> {
  if (browser && browser.connected) return browser
  if (browserLaunchPromise) return browserLaunchPromise

  browserLaunchPromise = (async () => {
    console.log('[ihamkor] launching Puppeteer browser...')
    const puppeteer = await import('puppeteer')
    browser = await puppeteer.default.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    })
    console.log('[ihamkor] browser launched')

    // Handle disconnect (browser crashed/closed)
    browser.on('disconnected', () => {
      console.log('[ihamkor] browser disconnected, will re-launch on next request')
      browser = null
      browserLaunchPromise = null
    })

    return browser
  })()

  return browserLaunchPromise
}

// ---- Scraping logic ----

interface IhamkorCompany {
  tin: string
  name: string
  shortName: string
  status: string
  registrationDate: string
  director: string
  address: string
  oked: string
  okedName: string
  legalForm: string
  phone: string
  email: string
  founders: { name: string; share: string }[]
  source: string
}

async function scrapeIhamkor(tin: string): Promise<IhamkorCompany | null> {
  const br = await getBrowser()
  const page = await br.newPage()

  // Set a realistic viewport + user agent
  await page.setViewport({ width: 1920, height: 1080 })
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  )

  try {
    // Navigate to the search page
    const searchUrl = `${IHAMKOR_BASE}/oz/search?query=${tin}`
    console.log(`[ihamkor] navigating to ${searchUrl}`)

    await page.goto(searchUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    })

    // Wait for Cloudflare challenge to resolve (page content changes)
    // The challenge page has title "Just a moment..." — wait for it to change
    await page.waitForFunction(
      () => {
        const title = document.title
        return !title.includes('Just a moment') && !title.includes('Attention Required')
      },
      { timeout: 20000 }
    ).catch(() => {
      console.log('[ihamkor] Cloudflare challenge did not resolve in 20s — trying anyway')
    })

    // Extra wait for React SPA to render
    await new Promise((r) => setTimeout(r, 3000))

    // Check if we're on a search results page or a company page
    const pageContent = await page.content()

    // Try to find company link in search results
    let companyUrl: string | null = null

    // Look for organization link
    const orgLink = await page.evaluate((tin) => {
      // Look for any link containing the TIN or "organization" path
      const links = Array.from(document.querySelectorAll('a'))
      for (const link of links) {
        const href = link.getAttribute('href') || ''
        const text = link.textContent || ''
        if (href.includes('/organization/') || href.includes(tin) || text.includes(tin)) {
          return href
        }
      }
      return null
    }, tin)

    if (orgLink) {
      companyUrl = orgLink.startsWith('http') ? orgLink : `${IHAMKOR_BASE}${orgLink}`
    } else {
      // Try direct organization URL
      companyUrl = `${IHAMKOR_BASE}/oz/organization/${tin}`
    }

    console.log(`[ihamkor] navigating to company page: ${companyUrl}`)

    // Navigate to the company page
    await page.goto(companyUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    })

    // Wait for Cloudflare again on the new page
    await page.waitForFunction(
      () => {
        const title = document.title
        return !title.includes('Just a moment') && !title.includes('Attention Required')
      },
      { timeout: 20000 }
    ).catch(() => {})

    // Wait for React to render
    await new Promise((r) => setTimeout(r, 3000))

    // Extract company data from the page
    const company = await page.evaluate(() => {
      const getText = (sel: string): string => {
        const el = document.querySelector(sel)
        return el ? el.textContent?.trim() || '' : ''
      }

      const getAllText = (sel: string): string[] => {
        const els = document.querySelectorAll(sel)
        return Array.from(els).map((el) => el.textContent?.trim() || '')
      }

      // Try to extract structured data from the page
      // ihamkor.uz is a React SPA — data is in rendered DOM elements
      const body = document.body?.innerText || ''

      // Helper: find a label and return the next value
      const findValue = (labels: string[]): string => {
        for (const label of labels) {
          const regex = new RegExp(label + '[\\s:]*([^\\n]+)', 'i')
          const match = body.match(regex)
          if (match && match[1]) return match[1].trim()
        }
        return ''
      }

      // Extract all text content for debugging
      const fullText = body.substring(0, 5000)

      // Try to find company name (usually in a heading or prominent element)
      const name =
        getText('h1') ||
        getText('h2') ||
        getText('.company-name') ||
        getText('.organization-name') ||
        findValue(['Nomi', "To'liq nomi", 'Name', 'Наименование'])

      const tin = findValue(['STIR', 'TIN', 'ИНН', 'Stir'])
      const status = findValue(['Holati', 'Status', 'Статус', "Holati"])
      const director = findValue(['Rahbar', 'Director', 'Руководитель', 'Direktor'])
      const address = findValue(['Manzil', 'Address', 'Адрес', 'Yashash joyi'])
      const oked = findValue(['OKED', 'Faoliyat', 'Деятельность', 'OKED kodi'])
      const regDate = findValue(["Ro'yxatdan olingan", 'Registered', 'Дата регистрации', 'Regist'])
      const legalForm = findValue(['Huquqiy shakl', 'Legal form', 'Правовая форма', 'THSHT'])
      const phone = findValue(['Telefon', 'Phone', 'Телефон'])
      const email = findValue(['Email', 'E-mail', 'Почта'])

      // Try to extract founders
      const founders: { name: string; share: string }[] = []
      const founderSection = body.match(/(?:Ta'sischi|Founders|Учредители|Asoschilar)([\s\S]*?)(?=\n\n|\n[A-Z]|\n\d)/i)
      if (founderSection) {
        const lines = founderSection[1].split('\n').filter((l) => l.trim())
        for (const line of lines) {
          const match = line.match(/(.+?)\s+(\d+(?:[.,]\d+)?%?)/)
          if (match) {
            founders.push({ name: match[1].trim(), share: match[2].trim() })
          }
        }
      }

      return {
        name,
        tin,
        status,
        director,
        address,
        oked,
        regDate,
        legalForm,
        phone,
        email,
        founders,
        fullText,
      }
    })

    await page.close()

    if (!company.name && !company.tin) {
      console.log('[ihamkor] no company data found on page')
      return null
    }

    return {
      tin: company.tin || tin,
      name: company.name || '',
      shortName: company.name || '',
      status: company.status || '',
      registrationDate: company.regDate || '',
      director: company.director || '',
      address: company.address || '',
      oked: company.oked || '',
      okedName: company.oked || '',
      legalForm: company.legalForm || '',
      phone: company.phone || '',
      email: company.email || '',
      founders: company.founders || [],
      source: 'ihamkor.uz',
    }
  } catch (e) {
    console.error(`[ihamkor] scrape error: ${e instanceof Error ? e.message : e}`)
    await page.close().catch(() => {})
    return null
  }
}

// ---- HTTP server ----

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  const url = new URL(req.url || '', `http://localhost:${PORT}`)

  if (url.pathname === '/api/scrape' || url.pathname === '/api/ihamkor') {
    const tin = url.searchParams.get('tin')?.trim()

    if (!tin || !/^\d{9}$/.test(tin)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'STIR must be 9 digits' }))
      return
    }

    // Check cache
    const cached = cache.get(tin)
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      console.log(`[ihamkor] cache hit for TIN ${tin} (age: ${Math.round((Date.now() - cached.ts) / 1000)}s)`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, company: cached.data, source: 'ihamkor.uz (cached)' }))
      return
    }

    console.log(`[ihamkor] scraping TIN ${tin}...`)
    const startTime = Date.now()

    try {
      const company = await scrapeIhamkor(tin)
      const elapsed = Date.now() - startTime

      if (company) {
        console.log(`[ihamkor] scrape success for TIN ${tin} in ${elapsed}ms`)
        cache.set(tin, { data: company, ts: Date.now() })

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, company, source: 'ihamkor.uz' }))
      } else {
        console.log(`[ihamkor] no data found for TIN ${tin} in ${elapsed}ms`)
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Company not found on ihamkor.uz' }))
      }
    } catch (e) {
      const elapsed = Date.now() - startTime
      console.error(`[ihamkor] scrape failed for TIN ${tin} in ${elapsed}ms: ${e instanceof Error ? e.message : e}`)
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'Scrape failed' }))
    }
    return
  }

  // Health check
  if (url.pathname === '/health' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'ihamkor-scraper', port: PORT, cacheSize: cache.size }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'Not found. Use /api/scrape?tin=XXXXXXXXX' }))
})

server.listen(PORT, () => {
  console.log(`[ihamkor] scraper service running on port ${PORT}`)
  console.log(`[ihamkor] API: GET /api/scrape?tin=302678824`)
  console.log(`[ihamkor] Health: GET /health`)
})
