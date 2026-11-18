/**
 * Order PDFs out of a HAR file the person saved from THEIR OWN browser («Save all as HAR with content» in DevTools ›
 * Network, after opening the order). public.sud.uz shows an order in a pop-up with no download button, but the browser has
 * already received the file; a HAR keeps it. Everything here is local: no request to any site is made, and nothing but
 * the order files is read — cookies, headers and the captcha token in the URL are never looked at or kept.
 *
 * The order is identified by the file request's own path (`/public/onStream/<uuid>`, or the pre-2024 paths), so the person
 * does not have to say which order it is. Pure: tested in __tests__/har-import.test.ts.
 */

import { ADMIN_DOC_TYPE, compactLegacy, compactPublication, isOrderFileId, legacyRows, PUBLIC_COURT_TYPES, type PublicCourtType, type RawPublication, type StoredOrder } from '@/core/public-orders'
import { NotPdfError, pdfFromUpload } from './order-pdf'

export class NotHarError extends Error {
  constructor() {
    super('Bu HAR fayl emas')
  }
}

export interface HarOrderFile {
  id: string
  bytes: Uint8Array
  filename: string | null
}

export interface HarImport {
  files: HarOrderFile[]
  /** the order RECORDS (case number, court, instance…) the browser's own searches returned, so the files land on a card */
  orders: StoredOrder[]
  /** order-file requests found in the HAR (kept or not) */
  seen: number
  /** of those, how many had no body saved (the HAR was saved without «with content») */
  noContent: number
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const RE_LIBRARY = new RegExp(`^/public/onStream/(${UUID})/?$`, 'i')
const RE_LEGACY = /^\/publication-proxy\/api\/file\/(download|civil|criminal|administrative)\/(\d{1,12})(?:\/(\d{1,4}))?\/?$/i

/** The order id a file request is for, from its URL (null for any other request). Only the PATH is read. */
export function orderIdFromFileUrl(rawUrl: string): string | null {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return null
  }
  if (!/(^|\.)sud\.uz$/i.test(u.hostname)) return null
  const lib = RE_LIBRARY.exec(u.pathname)
  if (lib) return lib[1].toLowerCase()
  const old = RE_LEGACY.exec(u.pathname)
  if (!old) return null
  const kind = old[1].toLowerCase() === 'download' ? 'economic' : old[1].toLowerCase()
  const id = kind === 'administrative' && old[3] && Number(old[3]) !== ADMIN_DOC_TYPE ? `old-${kind}-${old[2]}-${old[3]}` : `old-${kind}-${old[2]}`
  return isOrderFileId(id) ? id : null
}

const courtTypeOf = (u: URL): PublicCourtType | null => {
  const t = (u.searchParams.get('court_type') ?? '').toUpperCase()
  return (PUBLIC_COURT_TYPES as string[]).includes(t) ? (t as PublicCourtType) : null
}

/** The order rows of a search answer in the HAR (the library list, or the pre-2024 search). Anything unreadable gives none. */
function ordersFromSearch(rawUrl: string, text: string, encoding: unknown): StoredOrder[] {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return []
  }
  if (!/(^|\.)sud\.uz$/i.test(u.hostname)) return []
  const library = u.pathname === '/publications/list'
  const legacy = u.pathname.startsWith('/publication-proxy/')
  if (!library && !legacy) return []
  const ct = courtTypeOf(u)
  if (!ct) return []
  try {
    const body = encoding === 'base64' ? Buffer.from(text, 'base64').toString('utf8') : text
    const json = JSON.parse(body)
    if (library) {
      const rows = Array.isArray(json?.content) ? (json.content as RawPublication[]) : []
      return rows.map((r) => compactPublication(r, ct)).filter((o): o is StoredOrder => !!o)
    }
    return legacyRows(json).map((r) => compactLegacy(r, ct)).filter((o): o is StoredOrder => !!o)
  } catch {
    return []
  }
}

interface HarEntry {
  request?: { url?: unknown }
  response?: { content?: { text?: unknown; encoding?: unknown } }
}

export function extractOrdersFromHar(raw: Uint8Array): HarImport {
  let json: { log?: { entries?: unknown } }
  try {
    json = JSON.parse(Buffer.from(raw).toString('utf8'))
  } catch {
    throw new NotHarError()
  }
  const entries = json?.log?.entries
  if (!Array.isArray(entries)) throw new NotHarError()

  const best = new Map<string, HarOrderFile>()
  const orders = new Map<string, StoredOrder>()
  let seen = 0
  let noContent = 0
  for (const e of entries as HarEntry[]) {
    const url = e?.request?.url
    const id = typeof url === 'string' ? orderIdFromFileUrl(url) : null
    if (!id) {
      const t = e?.response?.content?.text
      if (typeof url === 'string' && typeof t === 'string' && t) for (const o of ordersFromSearch(url, t, e?.response?.content?.encoding)) orders.set(o.id, o)
      continue
    }
    seen++
    const c = e.response?.content
    const text = typeof c?.text === 'string' ? c.text : ''
    if (!text) {
      noContent++
      continue
    }
    try {
      const bytes = c?.encoding === 'base64' ? Buffer.from(text, 'base64') : Buffer.from(text, 'latin1')
      const pdf = pdfFromUpload(new Uint8Array(bytes)) // the site's envelope is unwrapped; anything that is not a PDF is refused
      const prev = best.get(id)
      if (!prev || pdf.bytes.length > prev.bytes.length) best.set(id, { id, bytes: pdf.bytes, filename: pdf.filename })
    } catch (err) {
      if (!(err instanceof NotPdfError)) throw err // an error page / empty answer: not an order file, skip it
    }
  }
  return { files: [...best.values()], orders: [...orders.values()], seen, noContent }
}
