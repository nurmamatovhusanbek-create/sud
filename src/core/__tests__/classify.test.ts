import { describe, expect, test } from 'bun:test'
import {
  normalizeName,
  nameMatches,
  classifyOutcome,
  remapCourtTypeByCaseNumber,
  dedupCases,
  summarize,
  distinctiveName,
  samePartyName,
  partyRole,
} from '../classify'

describe('normalizeName', () => {
  test('strips quotes, lowercases, collapses whitespace', () => {
    expect(normalizeName('  «ARTIKUL AZIYA KABEL» MChJ ')).toBe(
      'artikul aziya kabel mas\'uliyati cheklangan jamiyati',
    )
  })

  test('Cyrillic input lowercases and strips quotes (Latin-only expansion — lib-true behavior)', () => {
    // NOTE: the shipped lib expands only the LATIN forms mchj/aj/ooo/oao;
    // Cyrillic МЧЖ passes through lowercased. Parity with the lib is the goal.
    expect(normalizeName('АСИЯ САВДО МЧЖ')).toBe('асия савдо мчж')
  })

  test('maps OOO to the same normalized form as MChJ (Latin)', () => {
    expect(normalizeName('ASIA SAVDO MChJ')).toBe(normalizeName('ASIA SAVDO OOO'))
  })
})

describe('nameMatches', () => {
  test('direct substring either direction', () => {
    expect(nameMatches(normalizeName('Artikul Aziya Kabel MChJ'), normalizeName('ARTIKUL AZIYA KABEL MChJ'))).toBe(true)
    expect(nameMatches(normalizeName('Artikul Aziya Kabel MChJ'), normalizeName('Kabel'))).toBe(true)
  })

  test('two shared significant words suffice', () => {
    expect(nameMatches(normalizeName('Artikul Aziya Kabel MChJ'), normalizeName('Aziya Kabel Servis MChJ'))).toBe(true)
  })

  test('unrelated MChJ names DO fuzzy-match via shared legal-form words (lib-true quirk)', () => {
    // KNOWN QUIRK ported verbatim from stats.ts: the MChJ expansion words
    // (mas'uliyati cheklangan jamiyati) alone satisfy the ≥2-word rule, so two
    // different MChJs fuzzy-match. findByTin guarantees party membership in
    // practice, so this only affects which SIDE is picked — preserved for parity.
    expect(nameMatches(normalizeName('Artikul Aziya Kabel MChJ'), normalizeName('Buxoro Textil MChJ'))).toBe(true)
  })

  test('empty inputs never match', () => {
    expect(nameMatches('', 'x')).toBe(false)
    expect(nameMatches('x', '')).toBe(false)
  })
})

describe('classifyOutcome — judged from the company\'s side of the claim', () => {
  test('claim satisfied: plaintiff WINS, defendant LOSES', () => {
    for (const r of ['Иш тўлиқ қаноатлантирилди', "Da'vo to'liq qanoatlantirildi", 'Даъво қисман қаноатлантирилди', 'qisman qanoatlantirildi', "Da'vo to‘liq qanoatlantirilsin"]) {
      expect(classifyOutcome('plaintiff', r)).toBe('win')
      expect(classifyOutcome('defendant', r)).toBe('lose')
    }
  })

  test('claim rejected (rad etilgan): plaintiff LOSES, defendant WINS', () => {
    for (const r of ['Даво рад этилди', "Da'vo rad etilsin", "Da'vo rad etildi", 'Rad etilgan', "Da'vo qanoatlantirishdan rad etilsin", "Da'vo qanoatlantirilmasin"]) {
      expect(classifyOutcome('plaintiff', r)).toBe('lose')
      expect(classifyOutcome('defendant', r)).toBe('win')
    }
  })

  test('«to\'liq rad etilsin» is a rejection, not a satisfaction', () => {
    expect(classifyOutcome('plaintiff', "Da'vo to'liq rad etilsin")).toBe('lose')
    expect(classifyOutcome('defendant', "Da'vo to'liq rad etilsin")).toBe('win')
  })

  test('partly satisfied, the rest rejected, still counts as satisfied', () => {
    expect(classifyOutcome('plaintiff', "Da'vo qisman qanoatlantirilsin, qolgan qismi rad etilsin")).toBe('win')
    expect(classifyOutcome('defendant', "Da'vo qisman qanoatlantirilsin, qolgan qismi rad etilsin")).toBe('lose')
  })

  test('returned (qaytarilgan) is NEUTRAL for both sides', () => {
    for (const r of ['Иш қайтарилган', "Da'vo arizasi qaytarilsin", 'Qaytarilgan']) {
      expect(classifyOutcome('plaintiff', r)).toBe('neutral')
      expect(classifyOutcome('defendant', r)).toBe('neutral')
    }
  })

  test('left-without-review / terminated: plaintiff LOSES, defendant NEUTRAL', () => {
    for (const r of ['Кўрмасдан қолдирилган', 'Иш юритишдан тугатилган']) {
      expect(classifyOutcome('plaintiff', r)).toBe('lose')
      expect(classifyOutcome('defendant', r)).toBe('neutral')
    }
  })

  test('empty / dash outcomes are PENDING', () => {
    expect(classifyOutcome('plaintiff', '')).toBe('pending')
    expect(classifyOutcome('defendant', '—')).toBe('pending')
    expect(classifyOutcome('plaintiff', '-')).toBe('pending')
  })

  test('unknown outcome text is PENDING', () => {
    expect(classifyOutcome('plaintiff', 'Ажралмас сир сифатида')).toBe('pending')
  })
})

describe('remapCourtTypeByCaseNumber (v149 rule)', () => {
  test('5- prefix remaps to administrative', () => {
    expect(remapCourtTypeByCaseNumber('economic', '5-1234/2026')).toBe('administrative')
  })
  test('2-/3- prefixes remap to civil', () => {
    expect(remapCourtTypeByCaseNumber('economic', '2-100/26')).toBe('civil')
    expect(remapCourtTypeByCaseNumber('economic', '3-100/26')).toBe('civil')
  })
  test('4- prefix is economic', () => {
    expect(remapCourtTypeByCaseNumber('civil', '4-2401/2026')).toBe('economic')
  })
  test('unrecognized prefixes keep the declared type', () => {
    expect(remapCourtTypeByCaseNumber('civil', '1-99/26')).toBe('civil')
  })
})

describe('dedupCases', () => {
  test('keeps first occurrence per caseNumber, drops blanks', () => {
    const a = { caseNumber: '4-1/26', v: 'a' }
    const b = { caseNumber: '4-1/26', v: 'b' }
    const c = { caseNumber: '4-2/26', v: 'c' }
    const d = { caseNumber: '', v: 'd' }
    expect(dedupCases([a, b, c, d])).toEqual([a, c])
  })
})

describe('summarize', () => {
  test('counts classifications and roles', () => {
    const cases = [
      { classification: 'win' as const, role: 'plaintiff' as const },
      { classification: 'win' as const, role: 'defendant' as const },
      { classification: 'lose' as const, role: 'plaintiff' as const },
      { classification: 'neutral' as const, role: 'defendant' as const },
      { classification: 'pending' as const, role: 'plaintiff' as const },
    ]
    expect(summarize(cases)).toEqual({
      total: 5, win: 2, lose: 1, neutral: 1, pending: 1, asPlaintiff: 3, asDefendant: 2,
    })
  })
})

describe('which side is the company on (partyRole)', () => {
  const procab = { names: ['PROCAB', '"PROCAB" MAS\'ULIYATI CHEKLANGAN JAMIYAT'], tin: '302121267' }

  test('distinctiveName drops legal-form words, quotes and script differences', () => {
    expect(distinctiveName('"PROCAB" MAS\'ULIYATI CHEKLANGAN JAMIYAT')).toBe('procab')
    expect(distinctiveName('«Артикул Азия Кабел» МЧЖ')).toBe('artikul aziya kabel')
    expect(distinctiveName('"KONTRAGENT 1" MCHJ')).toBe('kontragent 1')
  })
  test('two different MChJs are NOT the same party (the fuzzy nameMatches quirk would say yes)', () => {
    expect(nameMatches(normalizeName('PROCAB MChJ'), normalizeName('"KONTRAGENT 1" MChJ'))).toBe(true) // the quirk, kept as is
    expect(samePartyName('PROCAB MChJ', '"KONTRAGENT 1" MChJ')).toBe(false)
    expect(samePartyName('PROCAB MChJ', '"PROCAB" Mas\'uliyati cheklangan jamiyati')).toBe(true)
  })
  test('the company as defendant against another MChJ is a defendant (it used to come out as plaintiff)', () => {
    expect(partyRole(procab, '"KONTRAGENT 1" MCHJ', '"PROCAB" MCHJ')).toBe('defendant')
    expect(partyRole(procab, '"PROCAB" MCHJ', '"KONTRAGENT 1" MCHJ')).toBe('plaintiff')
  })
  test('works across Latin / Cyrillic, and with the short name only', () => {
    expect(partyRole({ names: ['Artikul Aziya Kabel'], tin: '1' }, 'Бошка МЧЖ', '«Артикул Азия Кабел» МЧЖ')).toBe('defendant')
    expect(partyRole({ names: ['PROCAB'], tin: '1' }, 'X MChJ', 'Procab Group MChJ')).toBe('defendant')
  })
  test('a TIN inside the party string wins over the name', () => {
    expect(partyRole(procab, 'ABC MCHJ (STIR 302121267)', '"PROCAB" MCHJ')).toBe('plaintiff')
  })
  test('cannot tell → null (never guessed); no names → null', () => {
    expect(partyRole(procab, 'ABC MCHJ', 'XYZ MCHJ')).toBeNull()
    expect(partyRole({ names: [undefined, ''], tin: '' }, 'ABC MCHJ', 'XYZ MCHJ')).toBeNull()
  })
  test('a tiny distinctive name does not match everything', () => {
    expect(samePartyName('A MChJ', 'ABC MChJ')).toBe(false)
  })
})
