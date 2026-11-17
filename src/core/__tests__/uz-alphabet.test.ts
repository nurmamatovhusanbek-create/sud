import { describe, expect, test } from 'bun:test'
import { applyEdits, findEdits, hasNewLetters, isProtectedToken, parseLatinScript, toLatinScript, toNewLatin, toOldLatin } from '../uz-alphabet'

/** The alphabet chart (2026): [new, old]. Rows that changed are the four marked «O‘ZGARGAN». */
const CHANGED: [string, string][] = [
  ['Ğ', 'Gʻ'], ['ğ', 'gʻ'],
  ['Ö', 'Oʻ'], ['ö', 'oʻ'],
  ['Ş', 'Sh'], ['ş', 'sh'],
  ['Ç', 'Ch'], ['ç', 'ch'],
]
/** every other letter of the 28-letter alphabet is the same in both */
const UNCHANGED = 'ABDEFGHIJKLMNOPQRSTUVXYZ'.split('')

describe('the alphabet chart', () => {
  test('the four changed letters, both cases, both directions', () => {
    for (const [n, o] of CHANGED) {
      // a letter inside a lower-case word, so «Ş» is not read as the start of an all-capitals word
      expect(toNewLatin(`a${o}a`)).toBe(`a${n}a`)
      expect(toOldLatin(`a${n}a`)).toBe(`a${o}a`)
    }
  })
  test('the other 24 letters are untouched in both directions', () => {
    for (const l of UNCHANGED) for (const c of [l, l.toLowerCase(), l + l.toLowerCase()]) {
      expect(toNewLatin(c)).toBe(c)
      expect(toOldLatin(c)).toBe(c)
    }
  })
  test('the example words from the chart', () => {
    expect(toNewLatin('gʻalaba')).toBe('ğalaba')
    expect(toNewLatin('koʻl')).toBe('köl')
    expect(toNewLatin('shahar')).toBe('şahar')
    expect(toNewLatin('choy')).toBe('çoy')
    expect(toOldLatin('ğalaba')).toBe('gʻalaba')
    expect(toOldLatin('köl')).toBe('koʻl')
    expect(toOldLatin('şahar')).toBe('shahar')
    expect(toOldLatin('çoy')).toBe('choy')
  })
  test('words that are the same in both alphabets are not touched', () => {
    for (const w of ['ata', 'bola', 'daraxt', 'ertak', 'fikr', 'gul', 'hosil', 'ikki', 'jahon', 'kitob', 'laylak', 'maktab', 'non', 'olma', 'palov', 'qalam', 'rang', 'salom', 'tuz', 'uy', 'vaqt', 'xona', 'yil', 'zar']) {
      expect(toNewLatin(w)).toBe(w)
      expect(toOldLatin(w)).toBe(w)
    }
  })
})

describe('capitals', () => {
  test('a capital letter in a lower-case word', () => {
    expect(toNewLatin('Shahar')).toBe('Şahar')
    expect(toNewLatin('Choy')).toBe('Çoy')
    expect(toNewLatin('Gʻalaba')).toBe('Ğalaba')
    expect(toNewLatin('Oʻzbekiston')).toBe('Özbekiston')
    expect(toOldLatin('Şahar')).toBe('Shahar')
    expect(toOldLatin('Çoy')).toBe('Choy')
  })
  test('an all-capitals word keeps its capitals in both directions', () => {
    expect(toNewLatin('SHARTNOMA')).toBe('ŞARTNOMA')
    expect(toNewLatin('CHIRCHIQ')).toBe('ÇIRÇIQ')
    expect(toNewLatin('GʻALABA')).toBe('ĞALABA')
    expect(toNewLatin('OʻZBEKISTON')).toBe('ÖZBEKISTON')
    expect(toOldLatin('ŞARTNOMA')).toBe('SHARTNOMA')
    expect(toOldLatin('ÇIRÇIQ')).toBe('CHIRCHIQ')
    expect(toOldLatin('ÖZBEKISTON')).toBe('OʻZBEKISTON')
  })
  test('«sH» and «cH» are not a spelling of anything: left alone', () => {
    expect(toNewLatin('sHahar')).toBe('sHahar')
    expect(toNewLatin('cHoy')).toBe('cHoy')
  })
  test('initials: «Sh.A.» is the common case and survives the round trip', () => {
    expect(toNewLatin('Sh.A. Turgunov')).toBe('Ş.A. Turgunov')
    expect(toOldLatin('Ş.A. Turgunov')).toBe('Sh.A. Turgunov')
    expect(toOldLatin(toNewLatin('Sh.A. Turgunov'))).toBe('Sh.A. Turgunov')
  })
  test('an all-capitals word whose digraph is at the edge keeps its capitals', () => {
    expect(toOldLatin('BGEGʼÇ')).toBe('BGEGʼCH')
    expect(toOldLatin('ÖÖÇŞ')).toBe('OʻOʻCHSH')
    expect(toOldLatin('ŞA')).toBe('SHA')
    expect(toOldLatin('A.Ş.')).toBe('A.Sh.')
  })
  test('KNOWN LIMIT: a whole word that is only «CH» comes back as «Ch» (one Ç cannot remember which it was)', () => {
    expect(toOldLatin(toNewLatin('CH'))).toBe('Ch')
    expect(toOldLatin(toNewLatin('Ch'))).toBe('Ch')
  })
  test('KNOWN LIMIT: upper-case initials «SH.» come back as «Sh.» (one Ş cannot remember which it was)', () => {
    expect(toOldLatin(toNewLatin('SH.SH. Karimov'))).toBe('Sh.Sh. Karimov')
  })
})

describe('apostrophes', () => {
  test('every look-alike after o / g is the letter modifier', () => {
    for (const q of ['ʻ', '‘', '’', "'", '`', '´']) {
      expect(toNewLatin(`bo${q}lim`)).toBe('bölim')
      expect(toNewLatin(`to${q}g${q}ri`)).toBe('töğri')
      expect(toNewLatin(`O${q}zbekiston`)).toBe('Özbekiston')
    }
  })
  test('the tutuq belgisi (ʼ U+02BC) is a separator, never the modifier', () => {
    expect(toNewLatin('maʼno')).toBe('maʼno')
    expect(toNewLatin('doʼst')).toBe('doʼst')
    expect(toNewLatin('sʼhoq')).toBe('sʼhoq') // s and h are two letters: not «ş»
    expect(toOldLatin('maʼno')).toBe('maʼno')
  })
  test('an apostrophe after any other letter is left exactly as typed', () => {
    for (const w of ["ma'no", 'maʼno', 'maʻno', 'mas’ul', "is'hoq", 'san’at']) expect(toNewLatin(w)).toBe(w)
  })
  test('«s» and «h» kept apart by any apostrophe stay two letters', () => {
    for (const q of ["'", 'ʼ', '’', 'ʻ']) expect(toNewLatin(`is${q}hoq`)).toBe(`is${q}hoq`)
  })
})

describe('plain s+h / c+h in text that is already in the new alphabet', () => {
  test('are two letters there, so going back to the old alphabet they get the tutuq', () => {
    expect(toOldLatin('Ishoq Özbek')).toBe('Ishoq Oʻzbek') // no marker letter in the token: read as the old digraph, left as is
    expect(toOldLatin('Öshoq')).toBe('Oʻsʼhoq') // a new letter in the token: s and h are separate
    expect(toOldLatin('Çesh')).toBe('Chesh'.replace('sh', 'sʼh'))
  })
  test('and old text without any marker is never given a tutuq', () => {
    expect(toOldLatin('Shahar Choy mashhur')).toBe('Shahar Choy mashhur')
  })
  test('the new letters themselves are digraphs back in the old alphabet: no tutuq added', () => {
    expect(toOldLatin('maşhur')).toBe('mashhur')
    expect(toOldLatin('köşk')).toBe('koʻshk')
  })
})

describe('what is not Uzbek words is never rewritten', () => {
  test('e-mail, links and domains', () => {
    for (const t of ['sh.turgunov@gmail.com', 'choy.shop@mail.uz', 'https://sud.uz/ish?ch=1', 'www.shahar.org', 'shahar.uz', 'info@Oʻzbek.com']) {
      expect(isProtectedToken(t)).toBe(true)
      expect(toNewLatin(t)).toBe(t)
      expect(toOldLatin(t)).toBe(t)
    }
  })
  test('codes that mix letters and digits', () => {
    for (const t of ['SH123', 'AA1234567', '12Ch', 'Sh-12A', 'A1', 'CH2026']) expect(toNewLatin(t)).toBe(t)
  })
  test('contract, decree and case numbers: a short prefix joined to a number by «-» or «/»', () => {
    for (const t of ['SH-12/2026', 'SH-12', 'PF-5712-son', 'AB/12', 'Ch-5', 'A-1', '(SH-12/2026)', '№SH-12']) expect(toNewLatin(t)).toBe(t)
  })
  test('…but a long word joined to a number is a word, and «digit-hyphen-letters» is a word', () => {
    expect(toNewLatin('Oʻzbekiston-2030')).toBe('Özbekiston-2030')
    expect(toNewLatin('Toshkent-2026')).toBe('Toşkent-2026')
    expect(toNewLatin('12-choy 5-shahar')).toBe('12-çoy 5-şahar')
  })
  test('numbers, dates, case numbers, money', () => {
    for (const t of ['4-1001-2610/40824', '2026-11-12', '12.11.2026', '1 250 000,00', '+998 90 123 45 67', '200 248 856']) expect(toNewLatin(t)).toBe(t)
  })
  test('«5-chi» has a hyphen between the digit and the letters: it IS a word', () => {
    expect(toNewLatin('5-chi')).toBe('5-çi')
    expect(toNewLatin('2026-yil 12-oktabr')).toBe('2026-yil 12-oktabr')
  })
  test('Cyrillic and Russian text with Latin abbreviations', () => {
    expect(toNewLatin('Начальник отдела / Бош мутахассис')).toBe('Начальник отдела / Бош мутахассис')
    expect(toOldLatin('Директор ООО «Шахар»')).toBe('Директор ООО «Шахар»')
  })
  test('a protected token does not shield the words next to it', () => {
    expect(toNewLatin('Shahar: sh@x.uz, Choy')).toBe('Şahar: sh@x.uz, Çoy')
  })
})

describe('sentences and the things documents contain', () => {
  test('a court petition sentence', () => {
    const old = 'Toshkent shahar Chilonzor tumani, Oʻzbekiston Respublikasi, shartnoma boʻyicha qarz, choʻzilgan'
    const neu = 'Toşkent şahar Çilonzor tumani, Özbekiston Respublikasi, şartnoma böyiça qarz, çözilgan'
    expect(toNewLatin(old)).toBe(neu)
    expect(toOldLatin(neu)).toBe(old)
  })
  test('«choʻ» is ç + ö, «shoʻ» is ş + ö, «gʻo» is ğ + o', () => {
    expect(toNewLatin('choʻl')).toBe('çöl')
    expect(toNewLatin('shoʻrva')).toBe('şörva')
    expect(toNewLatin('gʻoya')).toBe('ğoya')
    expect(toNewLatin('boʻgʻiz')).toBe('böğiz')
  })
  test('digraphs that are NOT changed: ng, ts, yo, yu, ya, ye', () => {
    for (const w of ['tong', 'sotsial', 'yoz', 'yuz', 'yaxshi'.replace('sh', 'x'), 'yer']) expect(toNewLatin(w)).toBe(w)
  })
  test('punctuation and quotes around words are kept', () => {
    expect(toNewLatin('«Shahar»,')).toBe('«Şahar»,')
    expect(toNewLatin('(choy)')).toBe('(çoy)')
    expect(toNewLatin('"Oʻzbek"')).toBe('"Özbek"')
  })
  test('empty, spaces and newlines', () => {
    expect(toNewLatin('')).toBe('')
    expect(toNewLatin('  \n\t ')).toBe('  \n\t ')
    expect(toNewLatin('sh\nsh')).toBe('ş\nş')
  })
})

describe('properties', () => {
  test('idempotent: converting twice is converting once', () => {
    const t = 'Toshkent shahar, Oʻzbekiston, SHARTNOMA, Gʻ.Sh. choy ma’no maʼno'
    expect(toNewLatin(toNewLatin(t))).toBe(toNewLatin(t))
    expect(toOldLatin(toOldLatin(toNewLatin(t)))).toBe(toOldLatin(toNewLatin(t)))
  })
  test('old text is already «old»; new text is already «new»', () => {
    expect(toOldLatin('Toshkent shahar Oʻzbekiston')).toBe('Toshkent shahar Oʻzbekiston')
    expect(toNewLatin('Toşkent şahar Özbekiston')).toBe('Toşkent şahar Özbekiston')
  })
  test('toLatinScript, parseLatinScript, hasNewLetters', () => {
    expect(toLatinScript('shahar', 'new')).toBe('şahar')
    expect(toLatinScript('şahar', 'old')).toBe('shahar')
    expect(parseLatinScript('new')).toBe('new')
    for (const v of ['old', '', null, undefined, 'x', 1]) expect(parseLatinScript(v)).toBe('old')
    expect(hasNewLetters('şahar')).toBe(true)
    expect(hasNewLetters('shahar')).toBe(false)
  })
  test('findEdits: sorted, non-overlapping, absolute, and applyEdits(text, edits) = toLatinScript', () => {
    const t = 'ab shahar Oʻzbek, x@y.uz choy'
    const e = findEdits(t, 'new')
    for (let i = 0; i < e.length; i++) {
      expect(e[i].end).toBeGreaterThan(e[i].start)
      if (i) expect(e[i].start).toBeGreaterThanOrEqual(e[i - 1].end)
    }
    expect(applyEdits(t, e)).toBe(toNewLatin(t))
    expect(e.map((x) => t.slice(x.start, x.end))).toEqual(['sh', 'Oʻ', 'ch'])
  })

  /** FUZZ: random valid old-alphabet text. old → new → old must give the text back, and the new text must hold no old digraph. */
  test('fuzz: old → new → old is lossless and leaves no old spelling behind', () => {
    let seed = 20260512
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
    const SYL = ['a', 'o', 'u', 'i', 'e', 'b', 'd', 'g', 'k', 'l', 'm', 'n', 'q', 'r', 't', 'y', 'z', 'sh', 'ch', 'oʻ', 'gʻ', 'ng', 'ts', 'ʼ', 's', 'c', 'h', 'x']
    for (let n = 0; n < 4000; n++) {
      const words: string[] = []
      for (let w = 0, count = 1 + Math.floor(rnd() * 4); w < count; w++) {
        let word = ''
        for (let s = 0, len = 1 + Math.floor(rnd() * 6); s < len; s++) {
          const syl = pick(SYL)
          // in the old alphabet «s»+«h» and «c»+«h» as separate letters must carry the tutuq (that is what it is for)
          if (/[sc]$/i.test(word) && syl.startsWith('h')) word += 'ʼ'
          // an apostrophe-like modifier must not be produced by the generator after o/g except through the real letters
          word += syl
        }
        let form = rnd()
        // a whole word that is just «SH» / «CH» in capitals is the one shape that cannot be told from «Sh» (see KNOWN LIMIT)
        if (/^(sh|ch)$/i.test(word.replace(/[ʼʻ]/g, '')) && form >= 0.8) form = 0.1
        words.push(form < 0.5 ? word : form < 0.8 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toUpperCase())
      }
      const old = words.join(' ')
      const neu = toNewLatin(old)
      // no old spelling left (the generator only makes valid ones)
      expect(neu).not.toMatch(/[oOgG][ʻ‘’'`´]/)
      expect(neu).not.toMatch(/[sScC][hH]/)
      // lossless: «Ş» after a lower-case letter is always «Sh», and upper-case words are upper-case words
      expect(toOldLatin(neu)).toBe(old)
    }
  })

  /** FUZZ the other way: new → old → new. */
  test('fuzz: new → old → new is lossless', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
    const SYL = ['a', 'o', 'u', 'i', 'e', 'b', 'd', 'g', 'k', 'l', 'm', 'n', 'q', 'r', 't', 'y', 'z', 'ş', 'ç', 'ö', 'ğ', 'ng', 'ʼ', 's', 'c', 'h', 'x']
    for (let n = 0; n < 4000; n++) {
      let word = ''
      for (let s = 0, len = 1 + Math.floor(rnd() * 7); s < len; s++) {
        const syl = pick(SYL)
        // a plain s+h / c+h in new text is two letters; round-tripping it adds the tutuq on purpose (tested above), so not here
        if (/[sc]$/i.test(word) && syl === 'h') continue
        word += syl
      }
      const form = rnd()
      const w = form < 0.5 ? word : form < 0.8 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toUpperCase()
      // a single capital Ş/Ç next to nothing else is the one ambiguous shape (see «KNOWN LIMIT»)
      if (/^[ŞÇ]$/.test(w)) continue
      expect(toNewLatin(toOldLatin(w))).toBe(w)
    }
  })
})
