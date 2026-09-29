/**
 * Uzbek Cyrillic → Latin (the 1995/2021 alphabet the app writes in). The court portals answer in Cyrillic
 * while the document templates are Latin, so prefilled names must be converted. Text with no Cyrillic is
 * returned untouched. Uses the tutuq belgisi (ʻ / ʼ) the app uses everywhere.
 */

const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ч: 'ch', ш: 'sh', э: 'e',
  ў: 'oʻ', қ: 'q', ғ: 'gʻ', ҳ: 'h', ё: 'yo', ю: 'yu', я: 'ya', ц: 'ts', ъ: 'ʼ', ь: '',
}

const CYR = /[Ѐ-ӿ]/

export function uzCyrToLat(text: string): string {
  if (!CYR.test(text)) return text
  return transliterate(text).replace(/\bMCHJ\b/g, 'MChJ') // the legal form is written «MChJ», not «MCHJ»
}

function transliterate(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const low = ch.toLowerCase()
    if (!(low in MAP) && low !== 'е') {
      out += ch
      continue
    }
    // е is «ye» at the start of a word or after a vowel/ъ/ь, otherwise «e»
    let lat: string
    if (low === 'е') {
      const prev = text[i - 1]?.toLowerCase() ?? ''
      lat = !prev || !/[Ѐ-ӿa-z]/i.test(prev) || /[аеёиоуэюяъь]/.test(prev) ? 'ye' : 'e'
    } else lat = MAP[low]
    // keep capitalisation: «Ш» → «Sh», a fully upper-case word → «SH»
    if (ch !== low) {
      const next = text[i + 1]
      const wordUpper = !!next && next === next.toUpperCase() && next !== next.toLowerCase()
      lat = wordUpper ? lat.toUpperCase() : lat.charAt(0).toUpperCase() + lat.slice(1)
    }
    out += lat
  }
  return out
}
