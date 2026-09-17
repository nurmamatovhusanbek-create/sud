/**
 * mib.uz — Majburiy Ijro Byurosi (Bureau of Compulsory Enforcement) client.
 *
 * Provides debt-check lookup by STIR (legal entity INN). Uses:
 *  - Uzbekistan HTTP proxies (mib.uz geo-blocks all non-UZ IPs at TCP layer)
 *  - VLM (z-ai-web-dev-sdk) to solve the Uzbek-word math captcha
 *  - Apache Wicket AJAX form submission (stateful, session-bound)
 *
 * The debt-check service (Қарздорликни текшириш) is FULLY automatable:
 * just STIR + math captcha. No phone, no SMS. The monitoring service
 * (Ижро мониторинги) requires phone+SMS and is handled separately.
 *
 * Reverse-engineered from saved mib.uz HTML + verified working with STIR
 * 302678824 (result: "қарздорлик аниқланмади" = no debt found).
 */

import 'server-only'

// ---- Config --------------------------------------------------------------

const MIB_BASE = 'https://mib.uz'
const FETCH_TIMEOUT_MS = 15_000

/**
 * Direct fetch to mib.uz — no proxy, no external dependencies.
 * Uses Node's native fetch(). mib.uz may geo-block foreign IPs, but we try
 * directly first. If it times out, the user sees a clear error.
 */

interface DirectResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  text: string
  arrayBuffer: ArrayBuffer
  ok: boolean
}

async function fetchDirect(
  targetUrl: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
): Promise<DirectResponse> {
  const { method = 'GET', headers = {}, body, signal } = opts
  const res = await fetch(targetUrl, {
    method,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.7',
      ...headers,
    },
    body: body || undefined,
    signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'manual',
  })

  const responseHeaders: Record<string, string> = {}
  res.headers.forEach((v, k) => { responseHeaders[k.toLowerCase()] = v })

  // Set-Cookie is special — Headers.forEach may not capture all of them.
  // Use getSetCookie() (Node 18+) which returns an array.
  const setCookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
  if (setCookies && setCookies.length > 0) {
    responseHeaders['set-cookie'] = setCookies.join(', ')
  }

  const text = await res.text()
  const buf = Buffer.from(text, 'utf-8')

  return {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
    text,
    arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    ok: res.status >= 200 && res.status < 300,
  }
}

// ---- Types ---------------------------------------------------------------

export interface MibDebtResult {
  tin: string
  hasDebt: boolean
  /** 'clean' = no debt, 'debt' = debt found, 'error' = lookup failed, 'captcha_failed' = bad captcha */
  status: 'clean' | 'debt' | 'error' | 'captcha_failed'
  /** Raw UZ message from mib.uz, e.g. "302678824 СТИР рақамли юридик шахсда қарздорлик аниқланмади" */
  message: string
  /** Total debt amount in so'm (present when hasDebt=true). */
  totalDebt?: number
  /** Active debt amount in so'm (present when hasDebt=true). */
  currentDebt?: number
  /** List of individual enforcement debts (present when hasDebt=true). */
  debts?: MibDebt[]
  checkedAt: number
}

export interface MibDebt {
  /** Enforcement case number (Ижро иши рақами), e.g. "10072617684501" — used for monitoring lookup */
  enforcementCaseNumber: string
  /** Document status (Ҳужжат ҳолати), e.g. "Жараёнда" (In progress) */
  status: string
  /** Subject (И/Ҳ мазмуни), e.g. "Карз ундириш" (Debt collection) */
  subject: string
  /** Department (Ҳужжат иш юритувида), e.g. "Чилонзор тумани" */
  department: string
  /** Collector (Ундирувчи), masked, e.g. '"**R B**" AK***IK JA***TI' */
  collector: string
  /** Debt amount in so'm (Қарздорлик миқдори), e.g. 10210467.75 */
  amount: number
}

// ---- Captcha: manual mode (user solves it) ------------------------------
// The captcha is in Uzbek words (e.g. "саккиз олти" = 8-6 = 2).
// We return the image to the frontend; the user reads it and types the answer.
// No external API needed — works 100% offline.

// ---- Session store (in-memory, for passing data between prepare + submit) -

interface MibSession {
  cookieHeader: string
  hiddenField: string
  ajaxSubmitUrl: string
  wicketBaseUrl: string
  createdAt: number
}

const sessionStore = new Map<string, MibSession>()

// Sessions expire after 5 minutes
const SESSION_TTL = 5 * 60 * 1000

function createSession(tin: string, data: MibSession): string {
  const sessionId = `${tin}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  sessionStore.set(sessionId, data)
  // Clean up old sessions
  const now = Date.now()
  for (const [key, val] of sessionStore) {
    if (now - val.createdAt > SESSION_TTL) sessionStore.delete(key)
  }
  return sessionId
}

function getSession(sessionId: string): MibSession | null {
  const session = sessionStore.get(sessionId)
  if (!session) return null
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessionStore.delete(sessionId)
    return null
  }
  return session
}

// ---- HTML parsing helpers -----------------------------------------------

/** Extract the form action URL from the BlackListV2 page (resolves relative URLs). */
function resolveUrl(relative: string, pageUrl: string): string {
  if (relative.startsWith('http')) return relative
  // Use URL constructor for proper relative resolution
  // e.g. "../../foo/bar" from "https://mib.uz/bl" → "https://mib.uz/foo/bar"
  // e.g. "./foo/bar" from "https://mib.uz/bl" → "https://mib.uz/foo/bar"
  try {
    return new URL(relative, `${MIB_BASE}${pageUrl}`).href
  } catch {
    // Fallback: strip leading ./ and ../
    const stripped = relative.replace(/^(\.\.?\/)+/, '')
    return `${MIB_BASE}/${stripped}`
  }
}

interface ParsedBlackListPage {
  formId: string
  formAction: string
  hiddenField: string
  innInputId: string
  submitButtonId: string
  captchaImgUrl: string
  ajaxSubmitUrl: string
  wicketBaseUrl: string
}

/** Parse the BlackListV2 page HTML to extract form + captcha + AJAX submit details. */
function parseBlackListPage(html: string): ParsedBlackListPage {
  // Find the inn input — get its id
  const innInput = html.match(/<input[^>]*name="inn"[^>]*>/)
  if (!innInput) throw new Error('Could not find inn input on BlackListV2 page')
  const innInputIdMatch = innInput[0].match(/id="([^"]*)"/)
  const innInputId = innInputIdMatch ? innInputIdMatch[1] : ''
  console.log(`[mib] STEP 2: inn input found: id=${innInputId}, html=${innInput[0].slice(0, 100)}`)

  // Find ALL <form> tags in the page (id and action in any order)
  const allForms = [...html.matchAll(/<form\s[^>]*>/g)]
  console.log(`[mib] STEP 2: found ${allForms.length} <form> tags total`)

  // Find the inn input position
  const innIdx = html.indexOf(innInput[0])
  if (innIdx < 0) throw new Error('Could not locate inn input position in HTML')

  // Find the last <form> tag BEFORE the inn input — that's the parent form
  const beforeInn = html.slice(0, innIdx)
  const formTagsBefore = [...beforeInn.matchAll(/<form\s[^>]*>/g)]
  if (formTagsBefore.length === 0) throw new Error('Could not find parent form for inn input')
  const lastFormTag = formTagsBefore[formTagsBefore.length - 1][0]
  console.log(`[mib] STEP 2: parent form tag: ${lastFormTag.slice(0, 120)}`)

  // Extract id and action from the form tag (attributes can be in any order)
  const formIdMatch = lastFormTag.match(/id="([^"]*)"/)
  const formActionMatch = lastFormTag.match(/action="([^"]*)"/)
  if (!formIdMatch) throw new Error('Could not extract form id from form tag')
  const formId = formIdMatch[1]
  const formActionRaw = formActionMatch ? formActionMatch[1] : ''

  // Hidden field: <formId>_hf_0
  const hiddenField = `${formId}_hf_0`

  // Find the submit button inside this form (name="submit_button")
  // Search from the inn input to the next </form>
  const formEnd = html.indexOf('</form>', innIdx)
  const formBlock = html.slice(innIdx, formEnd > 0 ? formEnd : innIdx + 5000)
  console.log(`[mib] STEP 2: form block size: ${formBlock.length} bytes`)

  // Try multiple button patterns
  const submitBtn = formBlock.match(/<button[^>]*name="submit_button"[^>]*>/)
    || formBlock.match(/<button[^>]*id="([^"]*)"[^>]*name="submit_button"[^>]*>/)
    || formBlock.match(/<button[^>]*>/g)?.find(b => b.includes('submit_button'))
  if (!submitBtn) {
    console.log(`[mib] STEP 2: formBlock first 500 chars: ${formBlock.slice(0, 500)}`)
    throw new Error('Could not find submit button in form')
  }
  const submitBtnIdMatch =
    (submitBtn as unknown as string[])[0]?.match?.(/id="([^"]*)"/) ||
    (submitBtn as unknown as string).match(/id="([^"]*)"/)
  if (!submitBtnIdMatch) throw new Error('Could not extract submit button id')
  const submitButtonId = submitBtnIdMatch[1]
  console.log(`[mib] STEP 2: submit button id: ${submitButtonId}`)

  // Find the captcha image URL (first <img> inside the form block)
  const captchaImg = formBlock.match(/<img[^>]*src="([^"]*)"/)
  if (!captchaImg) throw new Error('Could not find captcha image in form')
  const captchaImgUrl = resolveUrl(captchaImg[1], '/bl')

  // Find the Wicket AJAX submit URL for the submit button
  // Pattern: {"u":"../../...","m":"POST","c":"<submitButtonId>",...}
  // The attributes in the JSON can be in any order, so search more broadly
  const ajaxRegex = new RegExp(
    `Wicket\\.Ajax\\.ajax\\(\\{[^}]*"c":"${submitButtonId}"[^}]*\\}`,
  )
  const ajaxMatch = html.match(ajaxRegex)
  let ajaxSubmitUrl: string
  if (!ajaxMatch) {
    // Try alternate pattern: "c":"<id>" might come before "u"
    const altAjaxRegex = new RegExp(
      `"u":"([^"]+)"[^}]*"c":"${submitButtonId}"`,
    )
    const altMatch = html.match(altAjaxRegex)
    if (!altMatch) throw new Error('Could not find Wicket AJAX submit URL')
    ajaxSubmitUrl = resolveUrl(altMatch[1], '/bl')
  } else {
    const urlMatch = ajaxMatch[0].match(/"u":"([^"]+)"/)
    if (!urlMatch) throw new Error('Could not extract URL from AJAX config')
    ajaxSubmitUrl = resolveUrl(urlMatch[1], '/bl')
  }

  // Wicket base URL
  const baseUrl = html.match(/Wicket\.Ajax\.baseUrl="([^"]+)"/)
  const wicketBaseUrl = baseUrl ? baseUrl[1] : ''

  return {
    formId,
    formAction: resolveUrl(formActionRaw, '/bl'),
    hiddenField,
    innInputId,
    submitButtonId,
    captchaImgUrl,
    ajaxSubmitUrl,
    wicketBaseUrl,
  }
}

/** Parse the Wicket AJAX response XML to extract the feedback message + debt list. */
function parseWicketResponse(xml: string): {
  status: 'clean' | 'debt' | 'captcha_failed'
  message: string
  totalDebt?: number
  currentDebt?: number
  debts?: MibDebt[]
} {
  // Look for feedbackPanel classes in the CDATA
  const warningMatch = xml.match(
    /<li class="feedbackPanelWARNING">\s*<span>([^<]+)<\/span>/,
  )
  const infoMatch = xml.match(
    /<li class="feedbackPanelINFO">\s*<span>([^<]+)<\/span>/,
  )
  const errorMatch = xml.match(
    /<li class="feedbackPanelERROR">\s*<span>([^<]+)<\/span>/,
  )

  if (errorMatch) {
    return { status: 'captcha_failed', message: errorMatch[1] }
  }

  // Debt found: the response contains "қарздорлик мавжуд" (debt exists) + a debt list
  // The debt list has "Ижро иши рақами" (enforcement case number) entries
  const debtExists = /қарздорлик мавжуд/i.test(xml) || /Ижро иши рақами/.test(xml)

  if (debtExists || infoMatch) {
    // Extract the feedback message
    const msg =
      infoMatch?.[1] ??
      (xml.match(/([^<]*қарздорлик мавжуд[^<]*)/i)?.[1] ?? 'Қарздорлик aniqlandi')

    // Extract total/current debt amounts
    const totalDebtMatch = xml.match(/Умумий қарздорлик:?\s*<\/[^>]+>\s*([\d\s,.]+)/i)
    const currentDebtMatch = xml.match(/Жорий қарздорлик:?\s*<\/[^>]+>\s*([\d\s,.]+)/i)
    const totalDebt = totalDebtMatch ? parseAmount(totalDebtMatch[1]) : undefined
    const currentDebt = currentDebtMatch ? parseAmount(currentDebtMatch[1]) : undefined

    // Extract individual debts. Each debt block contains:
    // Ижро иши рақами, Ҳужжат ҳолати, И/Ҳ мазмуни, Ҳужжат иш юритувида, Ундирувчи, Қарздорлик миқдори
    const debts: MibDebt[] = []
    const debtBlocks = xml.split('Ижро иши рақами')
    for (let i = 1; i < debtBlocks.length; i++) {
      const block = debtBlocks[i]
      // Enforcement case number (14-digit number)
      const caseNumMatch = block.match(/(\d{14})/)
      if (!caseNumMatch) continue
      // Status (Ҳужжат ҳолати)
      const statusMatch = block.match(/Ҳужжат ҳолати\s*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/)
      // Subject (И/Ҳ мазмуни)
      const subjectMatch = block.match(/И\/Ҳ мазмуни\s*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/)
      // Department (Ҳужжат иш юритувида)
      const deptMatch = block.match(/Ҳужжат иш юритувида\s*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/)
      // Collector (Ундирувчи)
      const collectorMatch = block.match(/Ундирувчи\s*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/)
      // Amount (Қарздорлик миқдори)
      const amountMatch = block.match(/Қарздорлик миқдори\s*<\/[^>]+>\s*([\d\s,.]+)/)

      debts.push({
        enforcementCaseNumber: caseNumMatch[1],
        status: statusMatch?.[1]?.trim() ?? '-',
        subject: subjectMatch?.[1]?.trim() ?? '-',
        department: deptMatch?.[1]?.trim() ?? '-',
        collector: collectorMatch?.[1]?.trim() ?? '-',
        amount: amountMatch ? parseAmount(amountMatch[1]) : 0,
      })
    }

    return {
      status: 'debt',
      message: msg,
      totalDebt,
      currentDebt,
      debts: debts.length > 0 ? debts : undefined,
    }
  }

  if (warningMatch) {
    return { status: 'clean', message: warningMatch[1] }
  }

  return { status: 'captcha_failed', message: 'No feedback in response' }
}

/** Parse an Uzbek-formatted amount string (e.g. "42 989 464.35" or "10 210 467,75") → number. */
function parseAmount(s: string): number {
  // Remove spaces, replace comma with dot
  const clean = s.replace(/\s/g, '').replace(',', '.')
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : n
}

// ---- HTML parser (for "direct mode" — user pastes mib.uz result HTML) ----

/**
 * Parse a saved mib.uz debt-check result page (HTML) and extract the debt list.
 * This is for "direct mode" where the user does the check in their own browser
 * (which is in Uzbekistan, so no geo-block) and pastes the result HTML.
 *
 * The HTML structure (from saved pages) contains:
 * - "NNNNNNN ПИНФЛ/СТИР рақамли ... қарздорлик мавжуд!" (debt found header)
 *   OR "NNNNNNN СТИР рақамли юридик шахсда қарздорлик аниқланмади" (no debt)
 * - Умумий қарздорлик: (total debt)
 * - Жорий қарздорлик: (current debt)
 * - Multiple "Ижро иши рақами" blocks with enforcement case details
 */
export function parseMibHtml(html: string, tin: string): MibDebtResult {
  // Check for "no debt" message
  const noDebtMatch = html.match(/(\d+)\s+СТИР\s+рақамли\s+юридик\s+шахсда\s+қарздорлик\s+аниқланмади/i)
  if (noDebtMatch) {
    return {
      tin: tin || noDebtMatch[1],
      hasDebt: false,
      status: 'clean',
      message: noDebtMatch[0],
      checkedAt: Date.now(),
    }
  }

  // Check for "debt exists" message
  const debtExistsMatch = html.match(/(\d+)\s+(?:ПИНФЛ|СТИР)\s+рақамли\s+\S+\s+қарздорлик\s+мавжуд/i)
  if (!debtExistsMatch) {
    return {
      tin,
      hasDebt: false,
      status: 'error',
      message: 'MIB sahifasi topilmadi. To\'g\'ri HTML joylanganiga ishonch hosil qiling.',
      checkedAt: Date.now(),
    }
  }

  const message = debtExistsMatch[0]

  // Extract total + current debt
  const totalDebtMatch = html.match(/Умумий\s+қарздорлик:?\s*<\/[^>]+>\s*([\d\s,.]+)/i)
  const currentDebtMatch = html.match(/Жорий\s+қарздорлик:?\s*<\/[^>]+>\s*([\d\s,.]+)/i)
  const totalDebt = totalDebtMatch ? parseAmount(totalDebtMatch[1]) : undefined
  const currentDebt = currentDebtMatch ? parseAmount(currentDebtMatch[1]) : undefined

  // Extract individual debts by splitting on "Ижро иши рақами"
  const debts: MibDebt[] = []
  const debtBlocks = html.split('Ижро иши рақами')
  for (let i = 1; i < debtBlocks.length; i++) {
    const block = debtBlocks[i]
    // Enforcement case number (14-digit number)
    const caseNumMatch = block.match(/(\d{14})/)
    if (!caseNumMatch) continue

    // For HTML parsing, fields are in <p> or <label> tags. Strip tags and search.
    const blockText = block.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ')

    const statusMatch = blockText.match(/Ҳужжат\s+ҳолати\s*[:\s]*([^\n]+)/i)
    const subjectMatch = blockText.match(/И\/Ҳ\s+мазмуни\s*[:\s]*([^\n]+)/i)
    const deptMatch = blockText.match(/Ҳужжат\s+иш\s+юритувида\s*[:\s]*([^\n]+)/i)
    const collectorMatch = blockText.match(/Ундирувчи\s*[:\s]*([^\n]+)/i)
    const amountMatch = blockText.match(/Қарздорлик\s+миқдори\s*[:\s]*([\d\s,.]+)/i)

    debts.push({
      enforcementCaseNumber: caseNumMatch[1],
      status: statusMatch?.[1]?.trim() ?? '-',
      subject: subjectMatch?.[1]?.trim() ?? '-',
      department: deptMatch?.[1]?.trim() ?? '-',
      collector: collectorMatch?.[1]?.trim() ?? '-',
      amount: amountMatch ? parseAmount(amountMatch[1]) : 0,
    })
  }

  return {
    tin: tin || debtExistsMatch[1],
    hasDebt: true,
    status: 'debt',
    message,
    totalDebt,
    currentDebt,
    debts: debts.length > 0 ? debts : undefined,
    checkedAt: Date.now(),
  }
}

// ---- Main API: checkDebtByTin -------------------------------------------

/**
 * Phase 1: Prepare MIB check — fetch page, parse form, download captcha.
 * Returns the captcha image (base64) + a session ID for Phase 2.
 * The user reads the captcha (Uzbek math words) and types the answer.
 */
export async function prepareMibCheck(tin: string): Promise<{
  ok: boolean
  sessionId?: string
  captchaImage?: string  // base64 PNG
  error?: string
}> {
  const cleanTin = tin.trim()
  if (!/^\d{9}$/.test(cleanTin)) {
    return { ok: false, error: 'STIR must be exactly 9 digits' }
  }

  try {
    console.log(`[mib] PREPARE: GET ${MIB_BASE}/bl`)
    let pageUrl = `${MIB_BASE}/bl`
    let pageRes = await fetchDirect(pageUrl, {})

    // Follow redirects, collect cookies
    let redirectCount = 0
    let collectedCookies: string[] = []
    if (pageRes.headers['set-cookie']) collectedCookies.push(pageRes.headers['set-cookie'])
    while (pageRes.status >= 300 && pageRes.status < 400 && pageRes.headers['location'] && redirectCount < 5) {
      const loc = pageRes.headers['location']
      try {
        pageUrl = new URL(loc, pageUrl).href
      } catch {
        pageUrl = loc.startsWith('http') ? loc : `${MIB_BASE}/${loc.replace(/^\.?\//, '')}`
      }
      const cookieStr = collectedCookies.map(c => c.split(';')[0]).join('; ')
      pageRes = await fetchDirect(pageUrl, {
        headers: { Referer: `${MIB_BASE}/bl`, ...(cookieStr ? { Cookie: cookieStr } : {}) },
      })
      if (pageRes.headers['set-cookie']) collectedCookies.push(pageRes.headers['set-cookie'])
      redirectCount++
    }
    if (!pageRes.ok) return { ok: false, error: `GET /bl failed: HTTP ${pageRes.status}` }
    if (pageRes.text.length < 5000) return { ok: false, error: 'mib.uz returned an error page (geo-block or server down)' }

    const cookieHeader = collectedCookies.map(c => c.split(';')[0]).join('; ')
    console.log(`[mib] PREPARE: page loaded (${pageRes.text.length} bytes), cookies: ${cookieHeader ? 'yes' : 'none'}`)

    // Parse form
    const parsed = parseBlackListPage(pageRes.text)
    console.log(`[mib] PREPARE: form parsed: ${parsed.formId} btn=${parsed.submitButtonId}`)

    // Download captcha
    const capRes = await fetchDirect(parsed.captchaImgUrl, {
      headers: { Referer: `${MIB_BASE}/bl`, ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
    })
    if (!capRes.ok) return { ok: false, error: `Captcha download failed: HTTP ${capRes.status}` }

    const captchaBase64 = Buffer.from(capRes.arrayBuffer).toString('base64')
    console.log(`[mib] PREPARE: captcha downloaded (${captchaBase64.length} chars base64)`)

    // Store session for Phase 2
    const sessionId = createSession(cleanTin, {
      cookieHeader,
      hiddenField: parsed.hiddenField,
      ajaxSubmitUrl: parsed.ajaxSubmitUrl,
      wicketBaseUrl: parsed.wicketBaseUrl,
      createdAt: Date.now(),
    })

    return { ok: true, sessionId, captchaImage: captchaBase64 }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const cause = (e as { cause?: { code?: string; message?: string } }).cause
    const causeMsg = cause ? ` (${cause.code}: ${cause.message})` : ''
    console.log(`[mib] PREPARE FAILED: ${msg}${causeMsg}`)
    return { ok: false, error: msg + causeMsg }
  }
}

/**
 * Phase 2: Submit the form with the user's captcha answer.
 * Uses the session from Phase 1 to submit to the Wicket AJAX endpoint.
 */
export async function submitMibCheck(tin: string, sessionId: string, captchaAnswer: string): Promise<MibDebtResult> {
  const cleanTin = tin.trim()
  const session = getSession(sessionId)
  if (!session) {
    return {
      tin: cleanTin,
      hasDebt: false,
      status: 'error',
      message: 'Sessiya muddati tugagan. Qaytadan urinib ko\'ring.',
      checkedAt: Date.now(),
    }
  }

  try {
    console.log(`[mib] SUBMIT: inn=${cleanTin}, secure_code=${captchaAnswer}`)

    const submitBody = new URLSearchParams({
      [session.hiddenField]: '',
      inn: cleanTin,
      secure_code: captchaAnswer,
      submit_button: '1',
    }).toString()

    const submitRes = await fetchDirect(session.ajaxSubmitUrl, {
      method: 'POST',
      headers: {
        Accept: 'text/xml,application/xml,application/xhtml+xml,text/html;q=0.9,*/*;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Wicket-Ajax': 'true',
        'Wicket-Ajax-BaseURL': session.wicketBaseUrl,
        'X-Requested-With': 'XMLHttpRequest',
        Origin: MIB_BASE,
        Referer: `${MIB_BASE}/bl`,
        ...(session.cookieHeader ? { Cookie: session.cookieHeader } : {}),
      },
      body: submitBody,
    })

    if (!submitRes.ok) {
      return {
        tin: cleanTin,
        hasDebt: false,
        status: 'error',
        message: `Submit failed: HTTP ${submitRes.status}`,
        checkedAt: Date.now(),
      }
    }

    const responseXml = submitRes.text
    console.log(`[mib] SUBMIT: response (${responseXml.length} bytes)`)

    const result = parseWicketResponse(responseXml)
    console.log(`[mib] SUBMIT: status=${result.status}`)

    // Clean up session
    sessionStore.delete(sessionId)

    return {
      tin: cleanTin,
      hasDebt: result.status === 'debt',
      status: result.status,
      message: result.message,
      totalDebt: result.totalDebt,
      currentDebt: result.currentDebt,
      debts: result.debts,
      checkedAt: Date.now(),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`[mib] SUBMIT FAILED: ${msg}`)
    return {
      tin: cleanTin,
      hasDebt: false,
      status: 'error',
      message: msg,
      checkedAt: Date.now(),
    }
  }
}
