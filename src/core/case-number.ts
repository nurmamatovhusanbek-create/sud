/**
 * A real court case number (`4-1001-2601/12345`). Court lists also carry rows that have none: a claim made in the person's cabinet that was never
 * sent to court, a refused acceptance, … («-» in the number column). Those are not cases: nothing is counted, backed up or shown to the bot for
 * them, and two of them are not «the same case» either. ONE rule for the app's counts and for what the bot reads.
 */
export const CASE_NUMBER_RE = /^\d+-[\d-]+\/\d+$/

export const isCaseNumber = (s: string | null | undefined): boolean => !!s && CASE_NUMBER_RE.test(s.trim())
