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

// ---- Uzbek Latin → Russian Cyrillic (names in the Russian half of a bilingual document) ------------------------------
// Russian-style, the way names are written in Russian paperwork: «Nurmamat oʻgʻli» → «Нурмамат угли»,
// «Azimjanovich» → «Азимжанович», «Erkin» → «Эркин». Longest digraph first; capitalisation follows the source.

const LAT_DIGRAPH: [string, string][] = [
  ['sh', 'ш'], ['ch', 'ч'], ['yo', 'ё'], ['yu', 'ю'], ['ya', 'я'], ['ye', 'е'], ['ng', 'нг'],
]
const LAT_SINGLE: Record<string, string> = {
  a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н',
  o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'х', y: 'й', z: 'з',
}
const TUTUQ = /[ʻʼ‘’'`´]/

export function uzLatToRu(text: string): string {
  const src = text
  const lower = src.toLowerCase()
  let out = ''
  let i = 0
  const cap = (ru: string, at: number, len: number) => {
    const first = src[at]
    if (first === first.toLowerCase()) return ru
    const rest = src.slice(at + 1, at + len)
    const allUpper = rest.length > 0 && rest === rest.toUpperCase() && rest !== rest.toLowerCase()
    const next = src[at + len]
    const wordUpper = allUpper || (len === 1 && !!next && next === next.toUpperCase() && next !== next.toLowerCase())
    return wordUpper ? ru.toUpperCase() : ru.charAt(0).toUpperCase() + ru.slice(1)
  }
  while (i < src.length) {
    const two = lower.slice(i, i + 2)
    // oʻ / gʻ (the tutuq belgisi follows the letter)
    if ((lower[i] === 'o' || lower[i] === 'g') && TUTUQ.test(src[i + 1] ?? '')) {
      out += cap(lower[i] === 'o' ? 'у' : 'г', i, 2)
      i += 2
      continue
    }
    const di = LAT_DIGRAPH.find(([l]) => l === two)
    if (di) {
      out += cap(di[1], i, 2)
      i += 2
      continue
    }
    const ch = lower[i]
    if (ch === 'e') {
      const prev = lower[i - 1] ?? ''
      // «Э» at the start of a word, «е» elsewhere (Эркин, Шерзод)
      out += cap(!prev || !/[a-zа-я]/.test(prev) ? 'э' : 'е', i, 1)
    } else if (ch in LAT_SINGLE) out += cap(LAT_SINGLE[ch], i, 1)
    else if (TUTUQ.test(src[i])) out += '' // a stray apostrophe inside a word
    else out += src[i]
    i++
  }
  return out
}
