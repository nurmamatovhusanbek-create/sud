/**
 * Parse an «Акт сверки» (reconciliation) .xlsx into the debtor contracts it
 * contains — 1, several, or none. Runs in the browser (JSZip), so the uploaded
 * financial statement never leaves the operator's machine.
 *
 * We only need what the demand letter is computed from: per contract the
 * number, date, main debt (Сальдо конечное, debit side) and the total credited
 * against it (opening advance + payments). Everything else in the letter
 * (parties, addresses, court, rate) comes from the editable constants, not the
 * spreadsheet.
 *
 * Layout (verified against real HET/Artikul exports): a header row carries
 * «Дата | Документ | Дебет | Кредит» for the first (our) party; below it each
 * contract is a block that starts with «№<no> от dd.mm.yyyy» and ends at
 * «Сальдо конечное». The right-party mirror columns are ignored. A contract is
 * a claimable debtor iff its closing balance sits on the DEBIT side.
 */

import { cellText as str, readFirstSheet } from '@/lib/xlsx-grid'
import { toTiyin } from '@/core/pretenzia'
import { splitParty } from '@/core/legal-forms'

export interface DebtorContract {
  /** Contract number without the «№», e.g. «K1125545». */
  no: string
  /** Contract date. */
  date: Date
  /** Main debt = closing debit balance, in tiyin. */
  mainDebtTiyin: number
  /** Opening advance + payments credited against it, in tiyin (0 if none). */
  paymentTiyin: number
}

export interface SverkaParseResult {
  contracts: DebtorContract[]
  /** Reconciliation period end («на dd.mm.yyyy»), when found — a sensible
   *  default for the claim date. */
  periodEnd?: Date
  /** the first party of the reconciliation (the sheet is «По данным <us>»), as written in the file */
  creditorName?: string
  /** its legal form, as a `LEGAL_FORMS` code («OOO», «AO»…), when the sheet says it */
  creditorForm?: string
  /** the OTHER party */
  debtorName?: string
  debtorForm?: string
  /** Every contract block seen (incl. fully-paid ones) — for a "N of M" hint. */
  totalBlocks: number
}

const num = (v: string | number | undefined): number | undefined => (typeof v === 'number' ? v : undefined)

// ---- sverka semantics ------------------------------------------------------

const HEADER_RE = /^№\s*(.+?)\s+от\s+(\d{2})\.(\d{2})\.(\d{4})/
const PERIOD_END_RE = /на\s+(\d{2})\.(\d{2})\.(\d{4})\s+задолженность/
const MIN_DEBT_TIYIN = 100 // ignore 0.01/0.33-sum residue rows

function toDate(dd: string, mm: string, yyyy: string): Date {
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd))
}

/**
 * The two parties of an «Акт сверки», whatever their legal forms. The header says it twice:
 *   «взаимных расчетов за период: …\nмежду "<us>" <form>\nи "<them>" <form>»  and  «По данным <us>, сум | По данным <them>, сум».
 * The first party is the sheet's own side (the columns the parser reads), the second is the OTHER company the letter
 * is addressed to. Returns null when neither sentence is found.
 */
export function findParties(cells: string[]): { creditor: { name: string; code: string }; debtor: { name: string; code: string } } | null {
  for (const t of cells) {
    // «между A\nи B»: the line break is what separates them when a name itself contains « и »
    const m = /между\s+([\s\S]+?)\s*\n\s*и\s+([\s\S]+)$/i.exec(t) ?? /между\s+([\s\S]+?)\s+и\s+((?:["“«]|[A-ZА-ЯЁ])[\s\S]+)$/.exec(t)
    if (m) {
      const creditor = splitParty(m[1])
      const debtor = splitParty(m[2])
      if (creditor.name && debtor.name) return { creditor, debtor }
    }
  }
  const named: string[] = []
  for (const t of cells) {
    const m = /По данным\s+([\s\S]+?)\s*,?\s*сум(?![\p{L}\p{N}])/iu.exec(t)
    if (m && !named.includes(m[1].trim())) named.push(m[1].trim())
  }
  if (named.length >= 2) {
    const creditor = splitParty(named[0])
    const debtor = splitParty(named[1])
    if (creditor.name && debtor.name) return { creditor, debtor }
  }
  return null
}

export async function parseSverka(data: ArrayBuffer | Uint8Array): Promise<SverkaParseResult> {
  const grid = await readFirstSheet(data)

  // Locate the «Дебет | Кредит» header row → the first-party column indices.
  let debitCol = 5
  let creditCol = 7
  let labelCol = 2
  const sortedRows = [...grid.keys()].sort((a, b) => a - b)
  for (const row of sortedRows) {
    const cells = grid.get(row)!
    const cols = [...cells.entries()]
    const debit = cols.find(([, v]) => str(v).trim() === 'Дебет')
    const credit = cols.find(([, v]) => str(v).trim() === 'Кредит')
    const date = cols.find(([, v]) => str(v).trim() === 'Дата')
    if (debit && credit) {
      debitCol = debit[0]
      creditCol = credit[0]
      if (date) labelCol = date[0]
      break
    }
  }

  // Period end from the free-text rows; the two parties from the header sentence (see findParties).
  let periodEnd: Date | undefined
  for (const row of sortedRows) {
    for (const v of grid.get(row)!.values()) {
      const pm = periodEnd ? null : PERIOD_END_RE.exec(str(v))
      if (pm) periodEnd = toDate(pm[1], pm[2], pm[3])
    }
  }
  const parties = findParties(sortedRows.flatMap((r) => [...grid.get(r)!.values()].map(str)))
  const creditorName = parties?.creditor.name || undefined
  const creditorForm = parties?.creditor.code || undefined
  const debtorName = parties?.debtor.name || undefined
  const debtorForm = parties?.debtor.code || undefined

  // Walk contract blocks.
  const contracts: DebtorContract[] = []
  let totalBlocks = 0
  let cur: { no: string; date: Date; closingDebit?: number; credit: number } | null = null

  const flush = () => {
    if (!cur) return
    totalBlocks++
    const debtTiyin = cur.closingDebit != null ? toTiyin(cur.closingDebit) : 0
    if (debtTiyin >= MIN_DEBT_TIYIN) {
      contracts.push({
        no: cur.no,
        date: cur.date,
        mainDebtTiyin: debtTiyin,
        paymentTiyin: toTiyin(cur.credit),
      })
    }
    cur = null
  }

  for (const row of sortedRows) {
    const cells = grid.get(row)!
    const label = str(cells.get(labelCol)).trim()
    const doc = str([...cells.values()].find((v) => /Обороты по договору|Оплата|Счет|Сальдо/.test(str(v))) ?? '')

    // Grand-total footer → stop.
    if (/^Обороты за период/.test(label)) break

    const hm = HEADER_RE.exec(label)
    if (hm) {
      flush()
      cur = { no: hm[1].trim(), date: toDate(hm[2], hm[3], hm[4]), credit: 0 }
      continue
    }
    if (!cur) continue

    if (label === 'Сальдо начальное') {
      // opening advance sits on the credit side → counts as payment
      cur.credit += num(cells.get(creditCol)) ?? 0
    } else if (label === 'Сальдо конечное') {
      cur.closingDebit = num(cells.get(debitCol)) ?? 0
    } else if (/Обороты по договору/.test(doc)) {
      // period credit turnover = sum of all Оплата lines
      cur.credit += num(cells.get(creditCol)) ?? 0
    }
  }
  flush()

  return { contracts, periodEnd, creditorName, creditorForm, debtorName, debtorForm, totalBlocks }
}
