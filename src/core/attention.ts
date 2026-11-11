/**
 * «Bugun» — what needs the operator today, worked out from the registry alone (no fetching).
 *
 * The old home answered «how big is everything» (totals). This answers «what do I have to do»: a ranked queue where
 * every item names the company, says why, and says where to go next. Severity 3 = today/tomorrow or a closed company,
 * 2 = within three days or overdue court invoices, 1 = something to keep an eye on (a weak rating).
 */

import { calendarDaysUntil } from './agenda'
import { companyStatusFamily } from './status'

export type AttentionKind = 'hearing' | 'debt' | 'status' | 'rating'
export type AttentionTarget = 'hearings' | 'bills' | 'profile' | 'overview'

export interface AttentionHearing {
  caseNumber?: string
  iso: string
  time?: string
  court?: string
  judge?: string
}

export interface AttentionInput {
  stir: string
  name?: string
  status?: string
  rating?: string | null
  score?: number | null
  winRate?: number
  /** every hearing still ahead */
  upcoming: { iso: string; court?: string; caseNumber?: string; time?: string; judge?: string }[]
  /** overdue debt in tiyins; null/undefined = bills never opened (unknown, not zero) */
  overdueTotal?: number | null
}

export interface AttentionItem {
  id: string
  kind: AttentionKind
  severity: 1 | 2 | 3
  stir: string
  name: string
  /** one line: what */
  title: string
  /** one line: the detail that makes it actionable */
  detail: string
  /** the day it is about (hearings), for ordering */
  iso?: string
  target: AttentionTarget
  /** label of the button */
  action: string
  /** the hearing a `hearing` item is about, so the screen can open its preparation */
  hearing?: AttentionHearing
  /** tiyin amount the item is about (overdue invoices) */
  amount?: number
}

/** Hearings further away than this are left to the week agenda. */
export const HEARING_WINDOW_DAYS = 3

/** A debt this large (100 mln soʻm, in tiyins) is urgent by itself. */
export const BIG_DEBT_TIYINS = 100_000_000 * 100

const when = (days: number) => (days === 0 ? 'Bugun' : days === 1 ? 'Ertaga' : `${days} kundan keyin`)

export function attentionItems(rows: readonly AttentionInput[], now: Date = new Date()): AttentionItem[] {
  const out: AttentionItem[] = []
  for (const r of rows) {
    const name = r.name?.trim() || `STIR ${r.stir}`

    for (const [i, h] of r.upcoming.entries()) {
      const days = calendarDaysUntil(h.iso, now)
      // the week itself is the agenda's job; the queue only carries what is close enough to prepare for NOW
      if (days === null || days < 0 || days > HEARING_WINDOW_DAYS) continue
      const severity = days <= 1 ? 3 : 2
      out.push({
        id: `h-${r.stir}-${h.iso}-${h.caseNumber ?? i}`,
        kind: 'hearing',
        severity,
        stir: r.stir,
        name,
        title: `${when(days)}${h.time ? `, ${h.time}` : ''}: majlis`,
        detail: [h.court, h.caseNumber].filter(Boolean).join(' · ') || 'Majlis rejalashtirilgan',
        iso: h.iso,
        hearing: { caseNumber: h.caseNumber, iso: h.iso, time: h.time, court: h.court, judge: h.judge },
        target: 'hearings',
        action: h.caseNumber ? 'Majlisga tayyorlanish' : 'Majlislarni ochish',
      })
    }

    if (typeof r.overdueTotal === 'number' && r.overdueTotal > 0) {
      out.push({
        id: `d-${r.stir}`,
        kind: 'debt',
        severity: r.overdueTotal >= BIG_DEBT_TIYINS ? 3 : 2,
        stir: r.stir,
        name,
        title: 'Muddati oʻtgan sud kvitansiyalari',
        // these are the company's OWN unpaid court invoices (billing.sud.uz): a payment-discipline signal, not a claim
        detail: 'Sud toʻlovlari oʻz vaqtida toʻlanmagan: toʻlov intizomi belgisi',
        target: 'bills',
        action: 'Kvitansiyalarni koʻrish',
        amount: r.overdueTotal,
      })
    }

    const fam = companyStatusFamily(r.status)
    if (fam === 'negative' || fam === 'warning') {
      out.push({
        id: `s-${r.stir}`,
        kind: 'status',
        severity: fam === 'negative' ? 3 : 2,
        stir: r.stir,
        name,
        title: fam === 'negative' ? 'Kompaniya tugatilgan' : 'Faoliyati toʻxtatilgan',
        detail: 'Tugatilgan yoki toʻxtatilgan tomonga daʼvo qoʻyishdan oldin tekshiring',
        target: 'profile',
        action: 'Profilni ochish',
      })
    }

    if ((r.rating === 'D' || (typeof r.score === 'number' && r.score > 0 && r.score < 40))) {
      out.push({
        id: `r-${r.stir}`,
        kind: 'rating',
        severity: 1,
        stir: r.stir,
        name,
        title: `Past reyting${r.rating ? ` (${r.rating})` : ''}`,
        detail: typeof r.winRate === 'number' ? `Yutuq darajasi ${Math.round(r.winRate)}%` : 'Shartnoma oldidan reytingni koʻrib chiqing',
        target: 'overview',
        action: 'Statistikani ochish',
      })
    }
  }
  return out.sort(
    (a, b) =>
      b.severity - a.severity ||
      (a.iso && b.iso ? a.iso.localeCompare(b.iso) : a.iso ? -1 : b.iso ? 1 : 0) ||
      (b.amount ?? 0) - (a.amount ?? 0) ||
      a.name.localeCompare(b.name),
  )
}

/** The one sentence that opens the page. */
export function briefLine(items: readonly AttentionItem[]): string {
  const urgent = items.filter((i) => i.severity === 3).length
  if (items.length === 0) return 'Bugun shoshilinch ish yoʻq. Hammasi tinch.'
  if (urgent === 0) return `${items.length} ta narsa eʼtiborni kutmoqda, lekin shoshilinchi yoʻq.`
  return `${urgent} ta shoshilinch ish, jami ${items.length} ta narsa eʼtibor talab qiladi.`
}
