/**
 * The three ways a document can be written in Uzbek.
 *
 *   old (1995)   Gʻ gʻ   Oʻ oʻ   Sh sh   Ch ch      the alphabet the app and its templates are written in
 *   new (2026)   Ğ ğ     Ö ö     Ş ş     Ç ç        one letter each; the other 24 letters and the tutuq belgisi (ʼ) are unchanged
 *   cyr          Ғ ғ     Ў ў     Ш ш     Ч ч        Uzbek Cyrillic (Ўзбек кирилл): every letter changes, see «Cyrillic» below
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
/** What a document can be written in: the two Latin alphabets, or Uzbek Cyrillic. */
export type UzScript = LatinScript | 'cyr'
export const LATIN_SCRIPTS: readonly LatinScript[] = ['old', 'new']
export const UZ_SCRIPTS: readonly UzScript[] = ['old', 'new', 'cyr']
export const DEFAULT_LATIN_SCRIPT: LatinScript = 'old'

export const parseLatinScript = (v: unknown): LatinScript => (v === 'new' ? 'new' : 'old')
/** Any of the three; anything else is the old Latin alphabet. */
export const parseScript = (v: unknown): UzScript => (v === 'new' || v === 'cyr' ? v : 'old')

export const SCRIPT_LABEL: Record<UzScript, string> = { old: 'Eski lotin (1995)', new: 'Yangi lotin (2026)', cyr: 'Кирилл' }

/** The scripts a document offers: Cyrillic only when its template was written for it (DocDef.cyrillic). */
export const scriptsFor = (cyrillic: boolean | undefined): readonly UzScript[] => (cyrillic ? UZ_SCRIPTS : LATIN_SCRIPTS)

/** The script a document is really written in: a document without a Cyrillic version stays in the Latin alphabet. */
export const effectiveScript = (requested: UzScript, cyrillic: boolean | undefined): UzScript => (requested === 'cyr' && !cyrillic ? 'old' : requested)

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

/**
 * The same for Cyrillic, where a Uzbek suffix written straight after a number («10:00ga», «5ta», «2026y.») is a word and
 * must be converted: only a digit followed by a CAPITAL letter (12A) is a code there.
 */
const CODE_CYR = /[A-Za-z]\d|\d[A-Z]|(?:^|[^\p{L}])\p{Lu}\p{L}{0,5}[-/]\d/u

/** A protected code followed by «-» and a lower-case Uzbek word: «SH-12/2026-sonli», «AA1234567-raqamli». */
const CODE_TAIL = /^(.*\d-)([\p{Ll}ʻʼ’‘'`´]+[.,;:!?)»”]*)$/u

/** True when a whitespace-delimited token must be left exactly as it is. */
export function isProtectedToken(token: string, script: UzScript = 'new'): boolean {
  return LINKISH.test(token) || (script === 'cyr' ? CODE_CYR : CODE).test(token)
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


// ---- Cyrillic ------------------------------------------------------------------------------------------------------
//
// Uzbek Cyrillic is a different spelling of the same words, so the converter reads the OLD Latin alphabet (new-alphabet
// letters are read too) and writes every letter of a word. The rules that are not a plain letter-for-letter table:
//   - oʻ gʻ (letter + any apostrophe look-alike) → ў ғ;  sh ch → ш ч (one letter, any capitalisation: Sh, SH → Ш);
//   - ya yo yu → я ё ю, but «yoʻ» is y + oʻ (yoʻq → йўқ, not ёʻқ); ye → е; a lone y → й; after the loan-word prefixes
//     ob sub pod pred raz iz in kon ad the Latin spelling drops the ъ: obyekt → объект, subyekt → субъект;
//   - e is э at the start of a word and after a vowel (Erkin → Эркин, poeziya → поэзия) and е after a consonant (Sherzod → Шерзод);
//   - the tutuq belgisi between letters is ъ (maʼno → маъно); ʼ between s and h only says «two letters» (sʼh → сҳ) and is dropped;
//   - ts → ц between vowels or at the start of a word (federatsiya → федерация, Tsentr → Центр) and only before a vowel;
//   - a token that holds a letter the Uzbek alphabet has no Cyrillic for (c outside «ch», w) is a foreign word or a brand
//     (Wi-Fi, Coca-Cola): it stays exactly as written rather than becoming half Latin, half Cyrillic; so does a word that is Cyrillic already.
// Codes, e-mail and links are protected as in the Latin conversions. Known limit: «ts» between two vowels is always ц,
// so «otsa» (ot + sa) would read as «оца»; real Uzbek words with that pattern are rare, the loanwords (-tsiya) are common.
// The Russian-style spelling of names (Ю, Щ, Ы, Ь) is not Uzbek and is not produced.

const CYR_SINGLE: Record<string, string> = {
  a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н',
  o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з',
  ğ: 'ғ', ö: 'ў', ş: 'ш', ç: 'ч',
}
const VOWELS = 'aeiouö'
const CYR_VOWELS = 'аеёиоуэюяъ'
const APOSTROPHES = /[ʻʼ‘’'`´]/
const WORD = /\p{L}[\p{L}ʻʼ‘’'`´]*/gu
const CYRILLIC = /[Ѐ-ӿ]/

/** A letter Uzbek Cyrillic has no counterpart for: w, and c outside «ch». */
/** Prefixes whose «ъ» the Latin spelling leaves out: obyekt, subyekt, podyezd, inyektor, konyunktura (объект, субъект, подъезд, инъектор, конъюнктура). */
const HARD_SIGN_PREFIX = /^(?:ob|sub|pod|pred|raz|iz|in|kon|ad)(?=y[aeou])/

const foreign = (lower: string): boolean => /w/.test(lower) || /c(?!h)/.test(lower)

function editsToCyr(token: string, base: number, out: Edit[]): void {
  // «Wi-Fi», «Coca-Cola»: one foreign word makes the whole hyphenated name foreign (no half-converted brand)
  if (foreign(token.toLowerCase().replace(/ç/g, ''))) return
  WORD.lastIndex = 0
  for (let m = WORD.exec(token); m; m = WORD.exec(token)) {
    const w = m[0]
    const at = base + m.index
    const lower = w.toLowerCase()
    if (CYRILLIC.test(w)) continue // Cyrillic already: never half Latin, half Cyrillic
    const isLetter = (ch: string | undefined) => !!ch && /\p{L}/u.test(ch) && !APOSTROPHES.test(ch)
    let last = '' // the Cyrillic letter written last (ъ and the vowels make the next e an «э»)
    for (let i = 0; i < w.length; i++) {
      const c = w[i]
      const lo = lower[i]
      const nx = lower[i + 1]
      const up = (t: string) => (c !== lo ? t.toUpperCase() : t)
      const put = (len: number, t: string) => {
        out.push({ start: at + i, end: at + i + len, text: t })
        i += len - 1
        last = t.toLowerCase()
      }
      if (APOSTROPHES.test(c)) {
        const prev = w[i - 1]
        const next = w[i + 1]
        if (!isLetter(prev)) continue
        if (lo === 'ʼ' && lower[i - 1] === 's' && nx === 'h') put(1, '') // «sʼh»: two letters, the mark only says so
        else if (lo === 'ʼ' || isLetter(next)) put(1, 'ъ')
        continue
      }
      if ((lo === 'o' || lo === 'g') && nx && APOSTROPHES.test(nx) && nx !== 'ʼ') put(2, up(lo === 'o' ? 'ў' : 'ғ'))
      else if ((lo === 's' || lo === 'c') && nx === 'h' && !(c === lo && w[i + 1] !== nx)) put(2, up(lo === 's' ? 'ш' : 'ч'))
      else if (lo === 'y' && (nx === 'a' || nx === 'u' || nx === 'e' || nx === 'o') && !(c === lo && w[i + 1] !== nx) && !(nx === 'o' && w[i + 2] && APOSTROPHES.test(w[i + 2]) && w[i + 2] !== 'ʼ')) {
        put(2, (HARD_SIGN_PREFIX.test(lower) && HARD_SIGN_PREFIX.exec(lower)![0].length === i ? 'ъ' : '') + up(nx === 'a' ? 'я' : nx === 'u' ? 'ю' : nx === 'o' ? 'ё' : 'е'))
      } else if (lo === 't' && nx === 's' && VOWELS.includes(lower[i + 2] ?? '#') && (i === 0 || VOWELS.includes(lower[i - 1]))) put(2, up('ц'))
      else if (lo === 'e') put(1, up(i === 0 || CYR_VOWELS.includes(last) ? 'э' : 'е'))
      else if (lo in CYR_SINGLE) put(1, up(CYR_SINGLE[lo]))
    }
  }
}

/**
 * The edits that turn `text` into `script`, token by token (a token is a run of non-space characters), leaving
 * protected tokens alone. Sorted, non-overlapping, absolute to `text`.
 */
export function findEdits(text: string, script: UzScript): Edit[] {
  const out: Edit[] = []
  const re = /\S+/g
  const convert = (token: string, base: number) => {
    if (script === 'new') editsToNew(token, base, out)
    else if (script === 'cyr') editsToCyr(token, base, out)
    else editsToOld(token, base, out)
  }
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!isProtectedToken(m[0], script)) {
      convert(m[0], m.index)
      continue
    }
    // «SH-12/2026-sonli»: the code stays, the Uzbek word hanging on it («-sonli», «-sonli,») is still a word
    const tail = CODE_TAIL.exec(m[0])
    if (tail && !LINKISH.test(m[0])) convert(tail[2], m.index + tail[1].length)
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
export function toLatinScript(text: string, script: UzScript): string {
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
