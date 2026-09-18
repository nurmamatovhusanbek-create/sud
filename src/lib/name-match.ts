/**
 * Normalize a company/party name for indexing + matching (guide §5.3).
 *
 * Strips legal-form noise, quotes, punctuation; folds Cyrillic→Latin so
 * "МЧЖ «АРТИКУЛ»" and 'ARTIKUL LLC' collapse to the same token.
 *
 * This is for MATCHING only, never display. Pure + client-safe.
 */

// NOTE: the strip runs AFTER Cyrillic→Latin folding, so the pattern list must
// cover the POST-FOLD Latin forms (`ooo` for ооо, `qq` for ққ, `mchj` for мчж
// ...). The Cyrillic variants are kept as harmless dead alternatives in case
// the strip is ever moved before folding.
const LEGAL_FORMS =
  /\b(мчж|мжж|ооо|оао|ао|зао|ип|xk|xt|yatt|mchj|ltd|llc|jsc|ojsc|dsc|мсб|ичм|қк|kk|ooo|oao|zao|ao|qq)\b/gi

// Minimal Cyrillic→Latin transliteration sufficient for matching (not display).
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
}

export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = raw.toLowerCase()
  s = s.replace(/[«»"“”'’`]/g, ' ')
  s = s.split('').map((ch) => (ch in CYR ? CYR[ch] : ch)).join('') // fold Cyrillic
  s = s.replace(LEGAL_FORMS, ' ')
  s = s.replace(/[^a-z0-9\s]/g, ' ') // drop remaining punctuation
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/** First N significant tokens — used to build a cheap trigram prefilter. */
export function nameKey(raw: string, n = 3): string {
  return normalizeName(raw)
    .split(' ')
    .filter((w) => w.length > 2)
    .slice(0, n)
    .join(' ')
}
