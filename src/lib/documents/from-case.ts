import { uzCyrToLat } from '@/core/translit'

/**
 * Fill a court-petition form from a case the app has ALREADY scraped — no library, no PDF needed.
 * The «Sud arizalari» templates (court_copy, court_postpone) ask for the court, the judge, the case number,
 * the claimant, the subject of the claim and the next hearing: all of that is in the case detail.
 * What only the user knows (representative, address, reason, phone) is left empty.
 */

export interface CaseFormInput {
  caseNumber: string
  general: { court?: string; judge?: string; plaintiff?: string; claimSubject?: string } | null
  /** the next hearing, dd.mm.yyyy (as the court portal writes it) or ISO yyyy-mm-dd */
  upcoming: { date?: string; time?: string } | null
  /** our own company */
  companyName?: string
}

/** The documents this can prefill. */
export const PREFILLABLE_DOCS = ['court_copy', 'court_postpone'] as const

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']

const blank = (s: unknown): boolean => typeof s !== 'string' || !s.trim() || ['-', '—'].includes(s.trim())
const tidy = (s: string | undefined): string => (blank(s) ? '' : uzCyrToLat(s!.replace(/\s+/g, ' ').trim()))

/** «12.10.2026» or «2026-10-12» → «2026-yil 12-oktabr» (how the templates read: «… {date} kuni soat …»). */
export function formatHearingDate(raw: string | undefined): string {
  if (blank(raw)) return ''
  const s = raw!.trim()
  let d: number, m: number, y: number
  let match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s)
  if (match) [d, m, y] = [+match[1], +match[2], +match[3]]
  else if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) [y, m, d] = [+match[1], +match[2], +match[3]]
  else return ''
  if (m < 1 || m > 12 || d < 1 || d > 31) return ''
  return `${y}-yil ${d}-${MONTHS[m - 1]}`
}

/** «10:30:00» → «10:30» */
const hhmm = (s: string | undefined): string => (blank(s) ? '' : (/^(\d{1,2}):(\d{2})/.exec(s!.trim())?.slice(1, 3).join(':') ?? ''))

/** Only the fields we actually know — empty ones are omitted so the form's own defaults/placeholders stay. */
export function caseToDocValues(i: CaseFormInput): Record<string, string> {
  const g = i.general
  const v: Record<string, string> = {
    court: tidy(g?.court),
    judge: tidy(g?.judge),
    case_number: tidy(i.caseNumber),
    plaintiff: tidy(g?.plaintiff),
    company: tidy(i.companyName),
    contract_subject: tidy(g?.claimSubject),
    hearing_date: formatHearingDate(i.upcoming?.date),
    hearing_time: hhmm(i.upcoming?.time),
  }
  return Object.fromEntries(Object.entries(v).filter(([, val]) => val))
}
