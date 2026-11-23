/**
 * Which of a company's bills belong to a court CASE, and what the others are. Only a bill with a case number is kept (a bill with none is of no use
 * here), so this decision is the gate of the whole pipeline and it must be explicit, not «the field is empty».
 *
 * Measured on 2 600 real bills of a water utility (Nov 2026): 436 name a case; of the 2 164 that do not, 1 814 are «Почта харажатлари» (postal costs paid
 * when a claim is filed), 226 are «Суд тўловлар» (court payments), 5 video-conference costs: all of them have `isInFavor: true`, NO `decisionDate`, and
 * no sibling bill of the same court and payer within ten minutes, so they cannot be tied to a case by any rule (and a guess would put a wrong case
 * on a person's file). The bills that DO name a case have `decisionDate` in 22 % of rows and, for those, a description that holds the case number.
 *
 *   case        `claimCaseNumber` is a case number: kept
 *   text        `claimCaseNumber` is empty but the description / purpose holds a case number («… санадаги 4-1001-2129/44390-сонли ҳал қилув қарори»):
 *               kept, with the number taken from the text (never seen in the sample, cheap to keep: billing fills the field itself nearly always)
 *   claim-cost  no case: a postal / court-payment / video-conference cost paid when a claim was filed, no ruling yet: not kept, counted
 *   unlinked    no case and not a known kind of cost: not kept, counted
 *
 * Pure: no network, no disk.
 */

import { CASE_NUMBER } from './bill-cases'

export type BillLink = 'case' | 'text' | 'claim-cost' | 'unlinked'

export interface BillLinkResult {
  link: BillLink
  /** the case number to keep (`case` and `text`), else null */
  caseNumber: string | null
}

/** a case number inside free text: `4-1001-2129/44390` */
const CASE_IN_TEXT = /\b\d-\d{4}-\d{4}\/\d+\b/

const COST_WORDS = /почта|видеоконференц|суд\s*тўловлар/i

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function linkOfBill(raw: unknown): BillLinkResult {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const own = str(o.claimCaseNumber)
  if (CASE_NUMBER.test(own)) return { link: 'case', caseNumber: own }
  const inText = CASE_IN_TEXT.exec(`${str(o.description)} ${str(o.purpose)}`)
  if (inText) return { link: 'text', caseNumber: inText[0] }
  const noRuling = typeof o.decisionDate !== 'number'
  if (noRuling && o.isInFavor !== false && COST_WORDS.test(`${str(o.payCategory)} ${str(o.description)}`)) return { link: 'claim-cost', caseNumber: null }
  return { link: 'unlinked', caseNumber: null }
}

export interface LinkTally {
  case: number
  text: number
  claimCost: number
  unlinked: number
}

/** how a page of raw bills divides (a bill that is not an object counts for nothing) */
export function tallyLinks(rows: readonly unknown[], into: LinkTally = { case: 0, text: 0, claimCost: 0, unlinked: 0 }): LinkTally {
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const { link } = linkOfBill(r)
    if (link === 'case') into.case++
    else if (link === 'text') into.text++
    else if (link === 'claim-cost') into.claimCost++
    else into.unlinked++
  }
  return into
}
