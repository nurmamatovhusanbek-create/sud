// The only module that calls the server. Every call carries Telegram's signed launch data; a failure is an ApiError with a sentence for the person.
import { initData } from './auth.js'

export class ApiError extends Error {}

export async function get(path, { signal } = {}) {
  let res
  try {
    res = await fetch(path, { headers: { 'x-init-data': initData }, signal })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new ApiError('Serverga ulanib boʻlmadi')
  }
  const body = await res.json().catch(() => null)
  if (!body || body.ok !== true) throw new ApiError(body?.error || `Server javob bermadi (${res.status})`)
  return body
}

/** a POST with a JSON body (the two order actions); the same envelope and the same refusals as `get` */
export async function post(path, body, { signal } = {}) {
  let res
  try {
    res = await fetch(path, { method: 'POST', headers: { 'x-init-data': initData, 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new ApiError('Serverga ulanib boʻlmadi')
  }
  const out = await res.json().catch(() => null)
  if (!out || out.ok !== true) throw new ApiError(out?.error || `Server javob bermadi (${res.status})`)
  return out
}

/**
 * Wait until the bot has read the backup. A host that has just woken from sleep needs a few seconds (sometimes a minute) to read it, and the first screen would
 * only say «Zaxira hali yuklanmagan». `/health` is public and cheap. Resolves `{ ready: true }`, or `{ ready: false, error }` when the bot says it cannot read
 * the backup (waiting will not help), or `{ ready: false, timeout: true }` after `maxMs` (the screens then show their own error with a retry).
 */
export async function waitForBackup({ onStatus, maxMs = 75_000 } = {}) {
  const t0 = Date.now()
  for (;;) {
    let info = null
    try {
      const c = new AbortController()
      const stop = setTimeout(() => c.abort(), 8000)
      const res = await fetch('/health', { signal: c.signal, cache: 'no-store' })
      clearTimeout(stop)
      info = await res.json()
    } catch { info = null }
    if (info?.ready) return { ready: true }
    const waited = Date.now() - t0
    if (info && info.error && info.failures >= 3) return { ready: false, error: info.error }
    if (waited > maxMs) return { ready: false, timeout: true }
    onStatus?.(info ? (waited > 20_000 ? 'Zaxira katta: oʻqilmoqda, biroz kuting…' : 'Zaxira oʻqilmoqda…') : 'Server uygʻonmoqda…')
    await new Promise((r) => setTimeout(r, 1500))
  }
}

const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])).toString()

export const api = {
  companies: (o) => get('/api/companies', o),
  search: (text, o) => get(`/api/search?${q({ q: text })}`, o),
  caseOf: (num, o) => get(`/api/case?${q({ num })}`, o),
  bill: (num, o) => get(`/api/bill?${q({ num })}`, o),
  /** a page of the upcoming hearings: { days, tin, q, offset, limit } → { page: { today, total, rows, companies, ranges } } */
  hearings: (p, o) => get(`/api/hearings?${q(p)}`, o),
  overview: (tin, o) => get(`/api/overview?${q({ tin })}`, o),
  company: (tin, o) => get(`/api/company?${q({ tin })}`, o),
  companyCases: (p, o) => get(`/api/company/cases?${q(p)}`, o),
  companyBills: (p, o) => get(`/api/company/bills?${q(p)}`, o),
  /** court orders: `{ case }` one case, `{ tin, offset, limit }` a company, or the filtered page `{ q, court, result, saved, year, offset, limit }` → { orders } */
  orders: (p, o) => get(`/api/orders?${q(p)}`, o),
  /** «Botga yuborish»: the bot sends the order's PDF to the person's chat */
  ordersSend: (pdfId, o) => post('/api/orders/send', { pdfId }, o),
  /** «Yuklash»: ask the app to download an order that was found but not downloaded → { status, message } */
  ordersDownload: (pdfId, o) => post('/api/orders/download', { pdfId }, o),
}
