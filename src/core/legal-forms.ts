/**
 * Legal forms of Uzbek companies as they are written next to a name in an «Акт сверки» header
 * («"Hududiy Elektr Tarmoqlari" Aksiyadorlik Jamiyati», «ООО "Name"»…), and how a demand letter writes each in
 * Russian and in Uzbek. Pure: the parser finds the form and the name, the letter fills `АО «NAME»` / `«NAME» AJ`.
 */

export interface LegalForm {
  code: string
  /** the form as the Russian letter writes it before the name («АО», «ООО») */
  ru: string
  /** …and as the Uzbek letter writes it after the name («AJ», «MChJ») */
  uz: string
  /** what it looks like in a spreadsheet (case-insensitive); the first match wins, so longer forms come first */
  re: RegExp
}

/** a whole word (JS `\\b` knows only ASCII letters, so it never fires between Cyrillic ones) */
const w = (alts: string) => `(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`

const Q = "[`'’ʻʼ‘]" // every apostrophe the sheets use (Mas'uliyati, Qo‘shma, Mas’uliyati…)

export const LEGAL_FORMS: readonly LegalForm[] = [
  { code: 'SP_OOO', ru: 'СП ООО', uz: 'MChJ QK', re: new RegExp(`mas${Q}?uliyati\\s+cheklangan\\s+jamiyat(?:i)?\\s+qo${Q}?shma\\s+korxona(?:si)?|совместное\\s+предприятие\\s+(?:общество\\s+с\\s+ограниченной\\s+ответственностью|ООО)|${w('СП\\s+ООО')}|${w('MChJ\\s+QK')}|${w('QK\\s+MChJ')}`, 'iu') },
  { code: 'OOO', ru: 'ООО', uz: 'MChJ', re: new RegExp(`mas${Q}?uliyati\\s+cheklangan\\s+jamiyat(?:i)?|общество\\s+с\\s+ограниченной\\s+ответственностью|${w('ООО')}|${w('OOO')}|${w('MChJ')}|${w('MCHJ')}`, 'iu') },
  { code: 'AO', ru: 'АО', uz: 'AJ', re: new RegExp(`aksiyadorlik\\s+jamiyat(?:i)?|акционерное\\s+общество|${w('АО')}|${w('AO')}|${w('AJ')}`, 'iu') },
  { code: 'GUP', ru: 'ГУП', uz: 'DUK', re: new RegExp(`davlat\\s+unitar\\s+korxona(?:si)?|государственное\\s+унитарное\\s+предприятие|${w('ГУП')}|${w('DUK')}`, 'iu') },
  { code: 'GU', ru: 'ГУ', uz: 'DM', re: new RegExp(`davlat\\s+muassasa(?:si)?|государственное\\s+учреждение|${w('ГУ')}`, 'iu') },
  { code: 'CHP', ru: 'ЧП', uz: 'XK', re: new RegExp(`xususiy\\s+korxona(?:si)?|частное\\s+предприятие|${w('ЧП')}|${w('XK')}`, 'iu') },
  { code: 'IP', ru: 'ИП', uz: 'YaTT', re: new RegExp(`yakka\\s+tartibdagi\\s+tadbirkor(?:lik)?|индивидуальный\\s+предприниматель|${w('ИП')}|${w('YaTT')}|${w('YATT')}`, 'iu') },
  { code: 'SP', ru: 'СП', uz: 'QK', re: new RegExp(`qo${Q}?shma\\s+korxona(?:si)?|совместное\\s+предприятие|${w('СП')}|${w('QK')}`, 'iu') },
]

const BY_CODE = new Map(LEGAL_FORMS.map((f) => [f.code, f]))

/** how the letter writes a form («АО» / «AJ»); '' for an unknown or empty code */
export function formLabel(code: string | undefined, lang: 'ru' | 'uz'): string {
  const f = code ? BY_CODE.get(code) : undefined
  return f ? f[lang] : ''
}

export function isFormCode(code: string): boolean {
  return BY_CODE.has(code)
}

/** Every kind of quote a sheet puts around a name (and sometimes twice or unbalanced). */
const QUOTES = /["“”„‟«»]/g

/**
 * «""Artikul Aziya Kabel" Mas'uliyati Cheklangan Jamiyat "» → { name: 'Artikul Aziya Kabel', code: 'OOO' }.
 * The form may stand before or after the name, inside or outside its quotes; whatever is left once the form words
 * and the quote marks are gone is the name. Several forms («Mas'uliyati Cheklangan Jamiyat Qo'shma Korxona») are
 * taken as ONE, the longest first.
 */
export function splitParty(raw: string): { name: string; code: string } {
  let s = raw.replace(/\s+/g, ' ').trim()
  let code = ''
  for (const f of LEGAL_FORMS) {
    if (f.re.test(s)) {
      code = f.code
      s = s.replace(new RegExp(f.re.source, 'giu'), ' ')
      break
    }
  }
  const name = s.replace(QUOTES, ' ').replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
  return { name, code }
}
