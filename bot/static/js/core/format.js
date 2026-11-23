// Numbers, money, dates. Uzbekistan time is UTC+5 all year (no summer time).
const NBSP = ' '
const TASHKENT_MS = 5 * 3600 * 1000

export const num = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
/** tiyin → soʻm */
export const money = (tiyin) => `${num((Number(tiyin) || 0) / 100)}${NBSP}soʻm`
export function dmy(ms) {
  if (!ms) return '-'
  const d = new Date(ms + TASHKENT_MS)
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
}
export const dmyIso = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '')
/** a value worth showing: not empty and not the courts' «-» */
export const has = (v) => v != null && v !== '' && v !== '-'
/** `dd.mm.yyyy` (the courts' date) → a sortable number, 0 when it is not one. Never compare these dates as strings. */
export function dmyKey(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s || ''))
  return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0
}
/** today in Uzbekistan as the same sortable number */
export const todayKey = () => dmyKey(dmy(Date.now()))
/** `20301205` → `05.12.2030` (the bot sends a hearing's day as yyyymmdd) */
export const dayDmy = (key) => `${String(key % 100).padStart(2, '0')}.${String(Math.floor(key / 100) % 100).padStart(2, '0')}.${Math.floor(key / 10000)}`
/** the day after `key` (yyyymmdd), through a real calendar */
export function nextDay(key) {
  const d = new Date(Date.UTC(Math.floor(key / 10000), (Math.floor(key / 100) % 100) - 1, key % 100 + 1))
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}
