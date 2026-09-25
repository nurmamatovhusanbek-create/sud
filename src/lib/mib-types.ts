/**
 * MIB (Majburiy Ijro Byurosi — Bureau of Compulsory Enforcement) debt types.
 *
 * Shared between the server parser (mib.ts) and the client (registry meta,
 * overview + watchlist UI). No server-only imports here so it stays isomorphic.
 *
 * Data comes from the fast «Qarzdorlikni tekshirish» service on mib.uz
 * (STIR + captcha, no phone/SMS), which the operator runs in their own
 * browser (a UZ IP) and brings the result back to parse.
 */

export interface MibDebt {
  /** Ijro ishi raqami (enforcement-case id), 14 digits — the enforcement id. */
  enforcementCaseNumber: string
  /** Hujjat holati, e.g. "Jarayonda". */
  status: string
  /** I/H mazmuni (subject), e.g. "Qarz undirish". */
  subject: string
  /** Bo'lim / department (tuman). */
  department: string
  /** Undiruvchi (creditor) — mib.uz returns this masked. */
  collector: string
  /** Qarzdorlik miqdori (debt amount) in soʻm. */
  amount: number
}

export interface MibDebtResult {
  tin: string
  hasDebt: boolean
  /** 'clean' = no debt · 'debt' = debt found · 'error' = could not read the page. */
  status: 'clean' | 'debt' | 'error'
  /** Raw UZ message from mib.uz (e.g. "… qarzdorlik aniqlanmadi"). */
  message: string
  totalDebt?: number
  currentDebt?: number
  debts?: MibDebt[]
  checkedAt: number
}
