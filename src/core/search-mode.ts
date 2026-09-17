/**
 * Input-shape detection for the unified search (arch guide §4, redesign §6.3).
 * Replaces the manual STIR/Kvitansiya toggle with inference + explicit override.
 */

export type SearchMode = 'stir' | 'pinfl' | 'invoice' | 'caseNumber' | 'unknown'

export interface DetectedSearch {
  mode: SearchMode
  /** Normalized digits-only form where applicable. */
  normalized: string
  /** Short human hint shown in the UI (Uzbek). */
  hint: string
}

export function detectSearchMode(rawInput: string): DetectedSearch {
  const raw = (rawInput || '').trim()
  const digits = raw.replace(/\D/g, '')

  if (/^\d{9}$/.test(digits) && raw.length === 9) {
    return { mode: 'stir', normalized: digits, hint: 'STIR · korxonalar boʻyicha qidirilmoqda' }
  }
  if (/^\d{14}$/.test(digits) && raw.length === 14) {
    return { mode: 'pinfl', normalized: digits, hint: 'PINFL · jismoniy shaxs boʻyicha qidirilmoqda' }
  }
  if (/^\d{12}$/.test(digits) && raw.length === 12) {
    return { mode: 'invoice', normalized: digits, hint: 'Kvitansiya raqami boʻyicha qidirilmoqda' }
  }
  if (/^\d{1,2}-/.test(raw.trim())) {
    return { mode: 'caseNumber', normalized: raw.trim(), hint: 'Ish raqami boʻyicha qidirilmoqda' }
  }
  if (digits.length >= 6 && raw.length <= 14) {
    return { mode: 'stir', normalized: digits, hint: 'STIR (raqamlar) boʻyicha qidirilmoqda' }
  }
  return { mode: 'unknown', normalized: raw, hint: 'Nom boʻyicha qidirilmoqda' }
}
