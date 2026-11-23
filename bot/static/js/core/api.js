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
}
