/**
 * Compose the {{placeholder}} → value map for one Претензия from a debtor
 * contract + the (editable) constants. Pure — shared by the client preview and
 * the server .docx fill. Keys here must match pretenzia.docx exactly.
 */

import {
  computeClaim,
  formatSum,
  formatDate,
  spellMoney,
  dayWord,
  paymentClause,
  type PenaltyTerms,
} from '@/core/pretenzia'

/** Party/office constants — blank falls back to the sample default at the UI. */
export interface ClaimConstants {
  creditorName: string
  debtorName: string
  debtorAddress: string
  courtName: string
  director: string
  executor: string
  executorPhone: string
  /** Date the claim is issued (header + day count). */
  claimDate: Date
  terms?: PenaltyTerms
}

/** One selected contract, with its (possibly user-edited) delay-start date. */
export interface ClaimContractInput {
  no: string
  date: Date
  mainDebtTiyin: number
  paymentTiyin: number
  delayStart: Date
}

export function renderClaimValues(c: ClaimContractInput, k: ClaimConstants): Record<string, string> {
  const r = computeClaim({
    mainDebtTiyin: c.mainDebtTiyin,
    paymentTiyin: c.paymentTiyin,
    delayStart: c.delayStart,
    claimDate: k.claimDate,
    terms: k.terms,
  })
  return {
    claim_date: formatDate(k.claimDate),
    creditor_name: k.creditorName,
    debtor_name: k.debtorName,
    debtor_address: k.debtorAddress,
    court_name: k.courtName,
    director: k.director,
    executor: k.executor,
    executor_phone: k.executorPhone,
    contract_no: c.no,
    contract_date: formatDate(c.date),
    supplied: formatSum(r.suppliedTiyin),
    payment_clause: paymentClause(r.paymentTiyin),
    main_debt: formatSum(r.mainDebtTiyin),
    main_debt_words: spellMoney(r.mainDebtTiyin),
    penalty: formatSum(r.penaltyTiyin),
    penalty_words: spellMoney(r.penaltyTiyin),
    delay_start: formatDate(c.delayStart),
    days: String(r.days),
    day_word: dayWord(r.days),
  }
}
