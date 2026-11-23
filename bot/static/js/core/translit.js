// The courts answer in Cyrillic; Latin (the app's old alphabet) is the default here, as in the app (same rules as core/translit.ts).
const MAP = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ч: 'ch', ш: 'sh', э: 'e', ў: 'oʻ', қ: 'q', ғ: 'gʻ', ҳ: 'h', ё: 'yo', ю: 'yu', я: 'ya', ц: 'ts', ъ: 'ʼ', ь: '' }
const CYR = /[Ѐ-ӿ]/

export function toLatin(s) {
  if (!CYR.test(s)) return s
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const lo = ch.toLowerCase()
    let l
    if (lo === 'е') {
      // «ye» at the start of a word or after a vowel / ъ / ь, otherwise «e»
      const p = (s[i - 1] || '').toLowerCase()
      l = !p || !/[Ѐ-ӿa-z]/i.test(p) || /[аеёиоуэюяъь]/.test(p) ? 'ye' : 'e'
    } else if (lo in MAP) {
      l = MAP[lo]
      if (lo === 'с' && (s[i + 1] || '').toLowerCase() === 'ҳ') l += 'ʼ' // «сҳ» are two letters, not the digraph «sh»
    } else {
      out += ch
      continue
    }
    if (ch !== lo) {
      const n = s[i + 1]
      const pv = s[i - 1]
      const up = (c) => !!c && c === c.toUpperCase() && c !== c.toLowerCase()
      const letter = (c) => !!c && c.toLowerCase() !== c.toUpperCase()
      // the LAST letter of an all-capitals word has no capital after it: the one before it says (ШОДИЯ → SHODIYA)
      const wordUpper = up(n) || (up(pv) && !letter(n))
      l = wordUpper ? l.toUpperCase() : l.charAt(0).toUpperCase() + l.slice(1)
    }
    out += l
  }
  return out.replace(/\bMCHJ\b/g, 'MChJ')
}
