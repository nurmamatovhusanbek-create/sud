/**
 * Company report — the data model.
 *
 * Pure: takes whatever the app managed to load (each source may be missing) and
 * returns exactly what the report prints. No network, no DOM, no clock except the
 * injected `generatedAt` — so every number on the page is unit-testable.
 *
 * Rules the model enforces:
 *  - A source that FAILED is reported in `notes`; it is never turned into a zero.
 *  - A field with no value is dropped, never printed as «-».
 *  - Numbers match the Statistika page (win rate = win / total).
 */

import type { CompanyInfoData, CompanyStats, CourtCase, UpcomingHearingsData } from '@/lib/api-types'
import type { CompanyMeta } from '@/lib/registry'
import { dateKey, daysUntil, formatDmy } from '@/core/dates'
import { monthlyTrend, type TrendPoint } from '@/core/trend'
import { companyStatusFamily, ratingBandFamily, type StatusFamily } from '@/core/status'

export type Tone = 'pos' | 'neg' | 'warn' | 'info' | 'neu'

const TONE: Record<StatusFamily, Tone> = { positive: 'pos', negative: 'neg', warning: 'warn', info: 'info', neutral: 'neu' }

export const REPORT_SOURCES = 'orginfo.uz · chamber.uz · sud.uz · billing.sud.uz'

// ---- input / output ---------------------------------------------------------

export interface ReportInput {
  stir: string
  generatedAt: Date
  info: CompanyInfoData | null
  stats: CompanyStats | null
  /** the raw case list (carries claim amounts) — optional enrichment */
  cases: CourtCase[] | null
  hearings: UpcomingHearingsData['hearings'] | null
  /** billing aggregates the Bills section cached in the registry (tiyin) */
  bills: CompanyMeta | null
  /** per-source failure messages: a failed source is not the same as "nothing there" */
  failed?: Partial<Record<'info' | 'stats' | 'cases' | 'hearings', string>>
}

export interface Fact {
  label: string
  value: string
  mono?: boolean
}

export interface Founder {
  name: string
  /** percent 0–100, or null when the source gave no parseable share */
  share: number | null
  text: string
}

export interface ResultRow {
  label: string
  count: number
  pct: number
  tone: Tone
}

export interface CaseRow {
  number: string
  court: string
  party: string
  role: 'plaintiff' | 'defendant'
  result: string
  tone: Tone
  amount: number | null
  date: string
}

export interface HearingRow {
  date: string
  time: string
  court: string
  caseNumber: string
  judge: string
  daysLeft: number | null
}

export interface CasesBlock {
  total: number
  /** classification 'pending' — still being heard */
  inProgress: number
  /** everything else — decided */
  decided: number
  win: number
  lose: number
  neutral: number
  /** win / total, whole percent — same definition as Statistika */
  winRate: number
  asPlaintiff: number
  asDefendant: number
  byCourt: { label: string; count: number }[]
  results: ResultRow[]
  monthly: TrendPoint[]
  /** sum of claim amounts (soʻm) and how many cases carried one; null = unknown */
  claim: { total: number; count: number } | null
  latest: CaseRow[]
}

export interface BillsBlock {
  count: number
  paidCount: number
  /** tiyin */
  paidTotal: number
  overdueTotal: number
  loadedAt: Date
}

export interface Kpi {
  label: string
  value: string
  sub?: string
  tone?: Tone
}

export interface ReportModel {
  stir: string
  generatedAt: Date
  name: string
  legalForm: string
  status: { text: string; tone: Tone } | null
  rating: { score: number | null; category: string; tone: Tone } | null
  orgInfoUrl: string
  kpis: Kpi[]
  facts: Fact[]
  registration: Fact[]
  contacts: Fact[]
  codes: Fact[]
  founders: { rows: Founder[]; others: number }
  cases: CasesBlock | null
  hearings: HearingRow[] | null
  bills: BillsBlock | null
  /** sources that failed — printed so a gap is never mistaken for «none» */
  notes: { section: string; message: string }[]
}

// ---- small pure helpers (exported for tests + the renderer) ------------------

const clean = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v).trim()
  return s === '-' || s === '—' || s.toLowerCase() === 'null' ? '' : s
}

/** "272 628 881,58", "272628881.58", "1,234,567", "1.234.567" → number. Null when there is no number. */
export function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) return null
  const s = String(raw).replace(/[\s  ]/g, '').replace(/[^\d.,-]/g, '')
  if (!/\d/.test(s)) return null
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let dec = -1
  if (lastDot >= 0 && lastComma >= 0) {
    dec = Math.max(lastDot, lastComma) // both present: the later one is the decimal mark
  } else {
    const i = Math.max(lastDot, lastComma)
    // a lone separator is a decimal mark only when it appears once and is followed by 1–2 digits
    if (i >= 0 && (s.match(/[.,]/g) || []).length === 1 && s.length - i - 1 >= 1 && s.length - i - 1 <= 2) dec = i
  }
  const digits = (x: string) => x.replace(/\D/g, '')
  const int = digits(dec >= 0 ? s.slice(0, dec) : s)
  const frac = dec >= 0 ? digits(s.slice(dec + 1)) : ''
  const n = Number(`${int || '0'}.${frac || '0'}`)
  if (!Number.isFinite(n)) return null
  return s.startsWith('-') ? -n : n
}

/** "44.9%", "44,9 %", "45" → 44.9 / 44.9 / 45; null when there is no number. */
export function parseShare(raw: string | null | undefined): number | null {
  if (!raw) return null
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(raw))
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const group = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

/** 1 234 567 → "1 234 567"; used for full figures. */
export const fmtInt = (n: number): string => group(n)

/** 325 700 000 → "325,7 mln"; 2 400 000 000 → "2,4 mlrd"; smaller stays grouped. */
export function shortSum(n: number): string {
  const trim = (x: number) => x.toFixed(1).replace('.', ',').replace(/,0$/, '')
  if (Math.abs(n) >= 1e9) return `${trim(n / 1e9)} mlrd`
  if (Math.abs(n) >= 1e6) return `${trim(n / 1e6)} mln`
  return group(n)
}

const COURT_LABEL: Record<string, string> = { economic: 'Iqtisodiy', civil: 'Fuqarolik', administrative: 'Maʼmuriy' }
const CLASS_TONE: Record<string, Tone> = { win: 'pos', lose: 'neg', pending: 'info', neutral: 'neu' }
const RESULTS_SHOWN = 6
const FOUNDERS_SHOWN = 6
const LATEST_SHOWN = 8
const HEARINGS_SHOWN = 6

const fact = (label: string, value: unknown, mono?: boolean): Fact | null => {
  const v = clean(value)
  return v ? { label, value: v, ...(mono ? { mono } : {}) } : null
}
const compact = <T,>(xs: (T | null)[]): T[] => xs.filter((x): x is T => x !== null)

// ---- the builder ------------------------------------------------------------

export function buildReportModel(input: ReportInput): ReportModel {
  const { stir, generatedAt, info, stats, cases, hearings, bills } = input
  const failed = input.failed ?? {}
  const co = info?.company ?? null
  const rt = info?.rating ?? null

  const name = clean(co?.officialName) || clean(co?.shortName) || clean(stats?.company?.name) || `STIR ${stir}`
  const statusText = clean(co?.status) || clean(stats?.company?.status)

  // rating: chamber first, then the copy stats carries
  const ratingCategory = clean(rt?.category) || clean(stats?.rating?.category)
  const rawScore = typeof rt?.score === 'number' ? rt.score : stats?.rating?.score
  const rating = ratingCategory
    ? {
        score: typeof rawScore === 'number' && Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : null,
        category: ratingCategory,
        tone: TONE[ratingBandFamily(ratingCategory) ?? 'neutral'],
      }
    : null

  // ---- facts
  const oked = [clean(rt?.okedCode), clean(rt?.okedName)].filter(Boolean).join(' · ')
  const region = [clean(rt?.region), clean(rt?.district)].filter(Boolean).join(', ')
  const facts = compact([
    fact('STIR', stir, true),
    fact('Holat', statusText),
    fact('Roʻyxatdan oʻtgan', co?.registeredDate, true),
    fact('Ustav kapitali', co?.charterCapital, true),
    fact('Rahbar', co?.director),
    fact('Toifa', co?.sustainabilityRating),
    fact('Yirik soliq toʻlovchi', co?.largeTaxpayer),
    fact('Hudud', region),
  ])
  const registration = compact([fact('Organ', co?.registeringAuthority)])
  const contacts = compact([fact('Manzil', co?.address), fact('Telefon', co?.phone, true), fact('Email', co?.email, true)])
  const ifut = clean(co?.ifut)
  const codes = compact([
    fact('Faoliyat turi (OKED)', oked || ifut),
    fact('IFUT', oked && ifut && ifut !== oked ? ifut : ''),
    fact('Tashkiliy-huquqiy shakl (THSHT)', co?.thsht),
    fact('DBIBT', co?.dbibt),
  ])

  // ---- founders
  const allFounders: Founder[] = (co?.founders ?? [])
    .map((f) => ({ name: clean(f?.name), share: parseShare(f?.share), text: clean(f?.share) }))
    .filter((f) => f.name)
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1))
  const founders = { rows: allFounders.slice(0, FOUNDERS_SHOWN), others: Math.max(0, allFounders.length - FOUNDERS_SHOWN) }

  // ---- court cases (needs stats; the amounts list only enriches it)
  const block = stats ? buildCases(stats, cases, generatedAt) : null

  // ---- hearings
  const hearingRows: HearingRow[] | null = hearings
    ? hearings.slice(0, HEARINGS_SHOWN).map((h) => {
        const r = h as unknown as Record<string, unknown>
        const iso = clean(r.isoDate)
        return {
          date: iso ? formatDmy(new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))) : clean(r.hearingDate),
          time: clean(r.hearingTime),
          court: clean(r.courtName) || clean(r.courtTypeLabel),
          caseNumber: clean(r.caseNumber),
          judge: clean(r.judge),
          daysLeft: daysUntil(iso || clean(r.hearingDate), generatedAt),
        }
      })
    : null

  // ---- bills (aggregates the Bills section cached; absent until it was opened once)
  const billsBlock: BillsBlock | null =
    bills?.billsLoadedAt && typeof bills.billCount === 'number'
      ? {
          count: bills.billCount,
          paidCount: bills.paidCount ?? 0,
          paidTotal: bills.paidTotal ?? 0,
          overdueTotal: bills.overdueTotal ?? 0,
          loadedAt: new Date(bills.billsLoadedAt),
        }
      : null

  // ---- KPI tiles
  const na = (why: string) => ({ value: '—', sub: why })
  const kpis: Kpi[] = [
    block
      ? { label: 'Sud ishlari', value: fmtInt(block.total), sub: `${fmtInt(block.inProgress)} ta joriy` }
      : { label: 'Sud ishlari', ...na('maʼlumot olinmadi') },
    block
      ? {
          label: 'Yutuq darajasi',
          value: `${block.winRate}%`,
          // deliberately no colour: any good/bad threshold would be an editorial judgement
          sub: `${fmtInt(block.win)} yutgan · ${fmtInt(block.lose)} yutqazgan`,
        }
      : { label: 'Yutuq darajasi', ...na('maʼlumot olinmadi') },
    block?.claim
      ? { label: 'Daʼvo summasi', value: shortSum(block.claim.total), sub: `${fmtInt(block.claim.count)} ta ish boʻyicha, soʻm` }
      : { label: 'Daʼvo summasi', ...na(cases === null ? 'maʼlumot olinmadi' : 'summa koʻrsatilmagan') },
    hearingRows
      ? {
          label: 'Yaqin majlislar',
          value: fmtInt(hearings!.length),
          sub: hearingRows[0] ? `eng yaqini ${hearingRows[0].date}` : 'belgilanmagan',
        }
      : { label: 'Yaqin majlislar', ...na('maʼlumot olinmadi') },
  ]

  // ---- gaps are stated, not hidden
  const notes: ReportModel['notes'] = []
  if (!info) notes.push({ section: 'Kompaniya profili', message: failed.info || 'orginfo.uz / chamber.uz javob bermadi' })
  if (!stats) notes.push({ section: 'Sud ishlari', message: failed.stats || 'sud.uz javob bermadi' })
  if (hearings === null) notes.push({ section: 'Yaqin majlislar', message: failed.hearings || 'majlislar jadvali olinmadi' })

  return {
    stir,
    generatedAt,
    name,
    legalForm: clean(co?.thsht),
    status: statusText ? { text: statusText, tone: TONE[companyStatusFamily(statusText)] } : null,
    rating,
    orgInfoUrl: clean(co?.orgInfoUrl),
    kpis,
    facts,
    registration,
    contacts,
    codes,
    founders,
    cases: block,
    hearings: hearingRows,
    bills: billsBlock,
    notes,
  }
}

function buildCases(stats: CompanyStats, list: CourtCase[] | null, now: Date): CasesBlock {
  const all = stats.cases ?? []
  const total = all.length
  const s = stats.summary
  const win = s?.win ?? all.filter((c) => c.classification === 'win').length
  const lose = s?.lose ?? all.filter((c) => c.classification === 'lose').length
  const neutral = s?.neutral ?? all.filter((c) => c.classification === 'neutral').length
  const inProgress = s?.pending ?? all.filter((c) => c.classification === 'pending').length

  // claim amounts come from the raw list, keyed by case number (each case counted once)
  const amountOf = new Map<string, number>()
  for (const c of list ?? []) {
    const n = parseAmount(c.claimAmount)
    const key = clean(c.caseNumber).toUpperCase()
    if (key && n !== null && n > 0 && !amountOf.has(key)) amountOf.set(key, n)
  }
  const claim = list === null ? null : { total: [...amountOf.values()].reduce((a, b) => a + b, 0), count: amountOf.size }

  // result breakdown: group by the raw outcome text; each group takes its dominant class's tone
  const groups = new Map<string, { count: number; byClass: Record<string, number> }>()
  for (const c of all) {
    const label = clean(c.result) || (c.classification === 'pending' ? 'Jarayonda' : 'Natija koʻrsatilmagan')
    const g = groups.get(label) ?? { count: 0, byClass: {} }
    g.count++
    g.byClass[c.classification] = (g.byClass[c.classification] ?? 0) + 1
    groups.set(label, g)
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0)
  const results: ResultRow[] = sorted.slice(0, RESULTS_SHOWN).map(([label, g]) => {
    const dominant = Object.entries(g.byClass).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral'
    return { label, count: g.count, pct: pct(g.count), tone: CLASS_TONE[dominant] ?? 'neu' }
  })
  const rest = sorted.slice(RESULTS_SHOWN).reduce((a, [, g]) => a + g.count, 0)
  if (rest > 0) results.push({ label: 'Boshqalar', count: rest, pct: pct(rest), tone: 'neu' })

  const byCourtMap = new Map<string, number>()
  for (const c of all) byCourtMap.set(c.courtType, (byCourtMap.get(c.courtType) ?? 0) + 1)
  const byCourt = ['economic', 'civil', 'administrative']
    .filter((k) => byCourtMap.has(k))
    .map((k) => ({ label: COURT_LABEL[k] ?? k, count: byCourtMap.get(k)! }))

  const latest: CaseRow[] = [...all]
    .sort((a, b) => dateKey(b.regDate).localeCompare(dateKey(a.regDate)))
    .slice(0, LATEST_SHOWN)
    .map((c) => ({
      number: clean(c.caseNumber),
      court: clean(c.court),
      party: clean(c.counterparty),
      role: c.role,
      result: clean(c.result) || (c.classification === 'pending' ? 'Jarayonda' : ''),
      tone: CLASS_TONE[c.classification] ?? 'neu',
      amount: amountOf.get(clean(c.caseNumber).toUpperCase()) ?? null,
      date: clean(c.regDate),
    }))

  return {
    total,
    inProgress,
    decided: Math.max(0, total - inProgress),
    win,
    lose,
    neutral,
    winRate: total ? Math.round((win / total) * 100) : 0,
    asPlaintiff: s?.asPlaintiff ?? all.filter((c) => c.role === 'plaintiff').length,
    asDefendant: s?.asDefendant ?? all.filter((c) => c.role === 'defendant').length,
    byCourt,
    results,
    monthly: monthlyTrend(all, now),
    claim,
    latest,
  }
}
