/**
 * The two Uzbek Latin alphabets the documents can be written in.
 *
 *   old (1995)   Gʻ gʻ   Oʻ oʻ   Sh sh   Ch ch      the alphabet the app and its templates are written in
 *   new (2026)   Ğ ğ     Ö ö     Ş ş     Ç ç        one letter each; the other 24 letters and the tutuq belgisi (ʼ) are unchanged
 *
 * The conversion is a text transformation, so «do not tweak» is the whole job:
 *   - it changes ONLY those four letters, in both directions, and is lossless (old → new → old gives the text back);
 *   - it never touches what is not Uzbek words: e-mail, links, domains, and codes that mix letters and digits
 *     («SH123», «AA1234567») are left exactly as written;
 *   - the tutuq belgisi ʼ (U+02BC) is a letter-separator, not the Gʻ/Oʻ modifier, so «sʼh» (s and h, two letters)
 *     does not become «ş», and «maʼno» keeps its ʼ.
 *
 * Pure and isomorphic. `findEdits` returns edits instead of a string so the .docx step (lib/documents/script) can
 * apply them to text that Word has split across several runs.
 */

export type LatinScript = 'old' | 'new'
export const LATIN_SCRIPTS: readonly LatinScript[] = ['old', 'new']
export const DEFAULT_LATIN_SCRIPT: LatinScript = 'old'

export const parseLatinScript = (v: unknown): LatinScript => (v === 'new' ? 'new' : 'old')

export const SCRIPT_LABEL: Record<LatinScript, string> = { old: 'Eski lotin (1995)', new: 'Yangi lotin (2026)' }

/** One replacement: text[start, end) becomes `text`. Edits never overlap and come in order. */
export interface Edit {
  start: number
  end: number
  text: string
}

/**
 * What can follow o / g to make the letter Oʻ / Gʻ. Typed text uses several look-alikes (ʻ ‘ ’ ' ` ´), and the
 * templates use more than one, so all of them count. NOT ʼ (U+02BC): that is the tutuq belgisi proper, a separator.
 */
const MODIFIER = /[ʻ‘’'`´]/

const isUpper = (c: string | undefined): boolean => !!c && c !== c.toLowerCase()

// ---- what is not Uzbek words ----------------------------------------------------------------------------------------

/** E-mails, links, domains: a token with any of these is never rewritten. */
const LINKISH = /@|:\/\/|^www\.|\.(?:uz|com|ru|org|net|gov|info|edu)\b/i
/**
 * A code, not a word: a letter touching a digit (SH123, AA1234567, 12A), or a short capitalised prefix joined to a number
 * by «-» or «/» (SH-12/2026, PF-5712, AB/12: contract, decree and case numbers). «5-chi» (digit first) and
 * «Oʻzbekiston-2030» (a long word) are words and are converted.
 */
const CODE = /[A-Za-z]\d|\d[A-Za-z]|(?:^|[^\p{L}])\p{Lu}\p{L}{0,5}[-/]\d/u

/** True when a whitespace-delimited token must be left exactly as it is. */
export function isProtectedToken(token: string): boolean {
  return LINKISH.test(token) || CODE.test(token)
}

// ---- old → new ------------------------------------------------------------------------------------------------------

function editsToNew(token: string, base: number, out: Edit[]): void {
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    const lo = c.toLowerCase()
    const n = token[i + 1]
    if (n === undefined) break
    if ((lo === 'o' || lo === 'g') && MODIFIER.test(n)) {
      out.push({ start: base + i, end: base + i + 2, text: lo === 'o' ? (isUpper(c) ? 'Ö' : 'ö') : isUpper(c) ? 'Ğ' : 'ğ' })
      i++
    } else if ((lo === 's' || lo === 'c') && n.toLowerCase() === 'h' && !(!isUpper(c) && isUpper(n))) {
      // «sh», «Sh», «SH» are one letter; «sH» is not a spelling of anything, so it is left alone
      out.push({ start: base + i, end: base + i + 2, text: lo === 's' ? (isUpper(c) ? 'Ş' : 'ş') : isUpper(c) ? 'Ç' : 'ç' })
      i++
    }
  }
}

// ---- new → old ------------------------------------------------------------------------------------------------------

/** «Ş.A.», «A.Ç.»: a token of single-letter initials. Its capitals are title-case initials («Sh.A.»), not an upper-case word. */
const CASED = '[\\p{Lu}\\p{Ll}]' // not \\p{L}: the tutuq ʼ and the modifier ʻ are Unicode LETTERS that have no case
const INITIALS = new RegExp(`^(?:${CASED}\\.)+${CASED}?\\.?$`, 'u')

function editsToOld(token: string, base: number, out: Edit[]): void {
  const letters = token.match(new RegExp(CASED, 'gu')) ?? []
  // «ŞARTNOMA», «BGEGʼÇ»: every letter is a capital, so the digraph is «SH»/«CH» too. A lone letter or an initials token is not a word.
  const capsWord = letters.length >= 2 && letters.every((l) => isUpper(l)) && !INITIALS.test(token)
  // In a token that already uses the new alphabet a plain «s»+«h» is TWO letters; the old alphabet needs the tutuq to say so
  const newToken = hasNewLetters(token)
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    switch (c) {
      case 'Ğ': out.push({ start: base + i, end: base + i + 1, text: 'Gʻ' }); break
      case 'ğ': out.push({ start: base + i, end: base + i + 1, text: 'gʻ' }); break
      case 'Ö': out.push({ start: base + i, end: base + i + 1, text: 'Oʻ' }); break
      case 'ö': out.push({ start: base + i, end: base + i + 1, text: 'oʻ' }); break
      case 'ş': out.push({ start: base + i, end: base + i + 1, text: 'sh' }); break
      case 'ç': out.push({ start: base + i, end: base + i + 1, text: 'ch' }); break
      case 'Ş':
      case 'Ç': {
        // upper-case next to a capital («ŞA»), or inside an all-capitals word, else title case («Şahar» → «Shahar»)
        const caps = capsWord || isUpper(token[i - 1]) || isUpper(token[i + 1])
        const dig = c === 'Ş' ? 'S' : 'C'
        out.push({ start: base + i, end: base + i + 1, text: caps ? `${dig}H` : `${dig}h` })
        break
      }
      default:
        if (newToken && (c === 's' || c === 'S' || c === 'c' || c === 'C') && (token[i + 1] === 'h' || token[i + 1] === 'H')) {
          out.push({ start: base + i + 1, end: base + i + 1, text: 'ʼ' }) // zero-width: inserted between the two letters
        }
    }
  }
}

/**
 * The edits that turn `text` into `script`, token by token (a token is a run of non-space characters), leaving
 * protected tokens alone. Sorted, non-overlapping, absolute to `text`.
 */
export function findEdits(text: string, script: LatinScript): Edit[] {
  const out: Edit[] = []
  const re = /\S+/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (isProtectedToken(m[0])) continue
    if (script === 'new') editsToNew(m[0], m.index, out)
    else editsToOld(m[0], m.index, out)
  }
  return out
}

/** Apply edits (as returned by findEdits) to the same text. */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let out = ''
  let at = 0
  for (const e of edits) {
    out += text.slice(at, e.start) + e.text
    at = e.end
  }
  return out + text.slice(at)
}

/** `text` written in `script`. Idempotent: converting twice is the same as converting once. */
export function toLatinScript(text: string, script: LatinScript): string {
  return applyEdits(text, findEdits(text, script))
}

export const toNewLatin = (text: string): string => toLatinScript(text, 'new')
export const toOldLatin = (text: string): string => toLatinScript(text, 'old')

/** True when the text already uses a letter of the new alphabet. */
export const hasNewLetters = (text: string): boolean => /[ĞğÖöŞşÇç]/.test(text)

// ---- not Uzbek at all ---------------------------------------------------------------------------------------------

/** English-only function words: none of them is an Uzbek word (so «to», «on», «an», «is», «at» are NOT on the list). */
const ENGLISH = new Set(['the', 'and', 'of', 'with', 'this', 'that', 'from', 'which', 'have', 'will', 'shall', 'are', 'was', 'were', 'been', 'not', 'for', 'their', 'such', 'should', 'would', 'who'])

/**
 * True when the text is English. The alphabet change must never touch it: «should», «which» and «Chief» contain «sh»,
 * «ch» and would come out as «şould», «whiçh», «Çief». A document that is declared English is skipped by its language;
 * this is the second layer, for templates that declare nothing (the operator's own .docx files).
 */
export function looksEnglish(text: string): boolean {
  const seen = new Set<string>()
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (ENGLISH.has(w)) {
      seen.add(w)
      if (seen.size >= 3) return true
    }
  }
  return false
}
