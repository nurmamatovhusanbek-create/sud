/**
 * The party constants of a demand letter, resolved in ONE place: what the user typed wins, then what the Excel
 * says about the two companies, then the sample defaults. The defaults describe the sample debtor (name, legal form,
 * address): they are used only while the sheet named nobody, never next to a different company the sheet did name,
 * so a letter to one company can never carry another one's name, form or address.
 */

export interface DetectedParties {
  creditorName?: string
  creditorForm?: string
  debtorName?: string
  debtorForm?: string
}

export interface PartyDefaults {
  creditorName: string
  debtorName: string
  debtorAddress: string
  [k: string]: string
}

/** the sample debtor's legal form (the defaults describe «Hududiy Elektr Tarmoqlari», an AO) */
export const DEFAULT_DEBTOR_FORM = 'AO'

/** names go on the letter in capitals, as the template always had them */
const caps = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase()

export function resolveParties(
  typed: Record<string, string>,
  detected: DetectedParties | null | undefined,
  defaults: PartyDefaults,
): { creditorName: string; debtorName: string; debtorForm: string; debtorAddress: string; addressMissing: boolean } {
  const t = (k: string) => typed[k]?.trim() ?? ''
  const detName = detected?.debtorName ? caps(detected.debtorName) : ''
  const debtorName = t('debtorName') || detName || defaults.debtorName
  // the legal form belongs to the company it was read next to: a typed name keeps the sheet's form only while
  // the sheet named that company, otherwise none is written (better no form than a wrong one)
  const debtorForm = detName ? detected?.debtorForm ?? '' : t('debtorName') ? '' : DEFAULT_DEBTOR_FORM
  // the sheet carries no address: the sample's one belongs to the sample company only
  const sampleDebtor = [detName || t('debtorName') || defaults.debtorName].every((n) => caps(n) === caps(defaults.debtorName))
  const debtorAddress = t('debtorAddress') || (sampleDebtor ? defaults.debtorAddress : '')
  return {
    creditorName: t('creditorName') || (detected?.creditorName ? caps(detected.creditorName) : '') || defaults.creditorName,
    debtorName,
    debtorForm,
    debtorAddress,
    addressMissing: !debtorAddress,
  }
}
