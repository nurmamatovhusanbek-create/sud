/**
 * «Xulosa» — a counterparty's picture on one page, as signals with their reasons, never a bare score.
 *
 * Inputs are what the registry already holds (status, chamber rating, win rate, cases, court-invoice state, hearings),
 * so nothing is fetched. Every signal names where to look next. The level is the WORST signal; a company with several
 * unknowns is never called «ok»: an unread source is an unread source, not a clean one. This is a heuristic to point a
 * lawyer at what to check, not a legal assessment, and the page says so.
 */

import { companyStatusFamily } from './status'

export type SignalTone = 'bad' | 'warn' | 'good' | 'info' | 'unknown'
export type VerdictLevel = 'danger' | 'caution' | 'ok' | 'unknown'
export type VerdictTarget = 'profile' | 'overview' | 'cases' | 'bills' | 'hearings'

export interface VerdictInput {
  status?: string
  rating?: string | null
  score?: number | null
  winRate?: number
  cases?: number
  /** overdue court invoices in tiyins; null/undefined = the invoices were never opened */
  overdueTotal?: number | null
  /** hearings still ahead, with days until the nearest */
  hearingsAhead: number
  nextHearingDays?: number | null
}

export interface Signal {
  id: string
  tone: SignalTone
  title: string
  detail: string
  target: VerdictTarget
}

export interface Verdict {
  level: VerdictLevel
  headline: string
  signals: Signal[]
  /** how many sources have not been read yet */
  unread: number
}

/** 100 mln soʻm in tiyins: past this an unpaid-invoice balance is serious on its own. */
export const BIG_OVERDUE_TIYINS = 100_000_000 * 100
/** Past this many cases a company is a frequent litigant. */
export const MANY_CASES = 30

const ORDER: Record<SignalTone, number> = { bad: 0, warn: 1, info: 2, unknown: 3, good: 4 }

export function companyVerdict(i: VerdictInput): Verdict {
  const s: Signal[] = []

  const fam = companyStatusFamily(i.status)
  if (!i.status?.trim()) s.push({ id: 'status', tone: 'unknown', title: 'Holati oʻqilmagan', detail: 'Roʻyxatdan oʻtganlik holati hali olinmagan', target: 'profile' })
  else if (fam === 'negative') s.push({ id: 'status', tone: 'bad', title: 'Tugatilgan', detail: 'Tugatilgan tomonga daʼvo qoʻyish yoki shartnoma tuzishdan oldin tekshiring', target: 'profile' })
  else if (fam === 'warning') s.push({ id: 'status', tone: 'warn', title: 'Faoliyati toʻxtatilgan', detail: 'Toʻxtatilgan faoliyat toʻlov qobiliyatiga taʼsir qilishi mumkin', target: 'profile' })
  else if (fam === 'positive') s.push({ id: 'status', tone: 'good', title: 'Faoliyatda', detail: 'Roʻyxatdan oʻtgan, faoliyati davom etmoqda', target: 'profile' })
  else s.push({ id: 'status', tone: 'unknown', title: i.status.trim(), detail: 'Bu holat aniq baholanmadi', target: 'profile' })

  const letter = i.rating?.trim().toUpperCase().charAt(0) ?? ''
  const scoreTxt = typeof i.score === 'number' ? ` (${i.score}/100)` : ''
  if (!letter) s.push({ id: 'rating', tone: 'unknown', title: 'Reyting oʻqilmagan', detail: 'Savdo-sanoat palatasi reytingi hali olinmagan', target: 'overview' })
  else if (letter === 'A' || letter === 'B') s.push({ id: 'rating', tone: 'good', title: `Reyting ${i.rating}`, detail: `Yuqori ishonchlilik toifasi${scoreTxt}`, target: 'overview' })
  else if (letter === 'C') s.push({ id: 'rating', tone: 'warn', title: `Reyting ${i.rating}`, detail: `Oʻrtacha toifa${scoreTxt}`, target: 'overview' })
  else s.push({ id: 'rating', tone: 'bad', title: `Reyting ${i.rating}`, detail: `Past toifa${scoreTxt}`, target: 'overview' })

  if (typeof i.winRate !== 'number' || !i.cases) s.push({ id: 'court', tone: 'unknown', title: 'Sud tarixi oʻqilmagan', detail: 'Sud ishlari statistikasi hali olinmagan', target: 'overview' })
  else {
    const rate = Math.round(i.winRate)
    if (i.cases >= MANY_CASES && rate < 40) s.push({ id: 'court', tone: 'bad', title: `${i.cases} ta ish, yutuq ${rate}%`, detail: 'Koʻp sudlashadi va koʻpini yutqazadi', target: 'cases' })
    else if (rate < 40) s.push({ id: 'court', tone: 'warn', title: `Yutuq ${rate}%`, detail: `${i.cases} ta ish boʻyicha koʻpini yutqazgan`, target: 'cases' })
    else if (i.cases >= MANY_CASES) s.push({ id: 'court', tone: 'warn', title: `${i.cases} ta sud ishi`, detail: `Tez-tez sudlashadi, yutuq ${rate}%`, target: 'cases' })
    else if (rate >= 50) s.push({ id: 'court', tone: 'good', title: `${i.cases} ta ish, yutuq ${rate}%`, detail: 'Sud tarixi tinch', target: 'cases' })
    else s.push({ id: 'court', tone: 'info', title: `${i.cases} ta ish, yutuq ${rate}%`, detail: 'Yutuq va yutqazish deyarli teng', target: 'cases' })
  }

  if (i.overdueTotal === null || i.overdueTotal === undefined) s.push({ id: 'bills', tone: 'unknown', title: 'Kvitansiyalar tekshirilmagan', detail: 'Sud toʻlov kvitansiyalari hali ochilmagan', target: 'bills' })
  else if (i.overdueTotal > 0) s.push({ id: 'bills', tone: i.overdueTotal >= BIG_OVERDUE_TIYINS ? 'bad' : 'warn', title: 'Muddati oʻtgan sud kvitansiyalari', detail: 'Sud toʻlovlarini oʻz vaqtida toʻlamagan: toʻlov intizomi belgisi', target: 'bills' })
  else s.push({ id: 'bills', tone: 'good', title: 'Muddati oʻtgan kvitansiya yoʻq', detail: 'Sud toʻlovlari oʻz vaqtida', target: 'bills' })

  if (i.hearingsAhead > 0) {
    const d = i.nextHearingDays
    s.push({ id: 'hearings', tone: 'info', title: `${i.hearingsAhead} ta majlis rejada`, detail: d === 0 ? 'Eng yaqini bugun' : d === 1 ? 'Eng yaqini ertaga' : typeof d === 'number' ? `Eng yaqini ${d} kundan keyin` : 'Rejalashtirilgan', target: 'hearings' })
  }

  s.sort((a, b) => ORDER[a.tone] - ORDER[b.tone])
  const bad = s.filter((x) => x.tone === 'bad').length
  const warn = s.filter((x) => x.tone === 'warn').length
  const good = s.filter((x) => x.tone === 'good').length
  const unread = s.filter((x) => x.tone === 'unknown').length
  let level: VerdictLevel
  let headline: string
  if (bad > 0) { level = 'danger'; headline = `Ehtiyot boʻling: ${bad} ta jiddiy belgi` }
  else if (warn > 0) { level = 'caution'; headline = `Eʼtibor bilan: ${warn} ta ogohlantirish` }
  else if (good >= 2 && unread <= 1) { level = 'ok'; headline = 'Jiddiy belgilar topilmadi' }
  else { level = 'unknown'; headline = 'Hali yetarli maʼlumot yoʻq' }
  return { level, headline, signals: s, unread }
}
