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
  assignRoles,
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

describe('which side is the company on', () => {
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
  test('the same company in another script / spelling is the same party (c = k, q = k, x = h, no vowels)', () => {
    expect(samePartyName('PROCAB MChJ', '«ПРОКАБ» МЧЖ')).toBe(true)
    expect(samePartyName('Xolding Qurilish MChJ', '«Холдинг Курилиш» МЧЖ')).toBe(true)
    expect(samePartyName('PROCAB MChJ', '«ПРОМАБ» МЧЖ')).toBe(false)
  })
  test('a tiny distinctive name does not match everything', () => {
    expect(samePartyName('A MChJ', 'ABC MChJ')).toBe(false)
  })

  test('single case: names and TIN (nothing to learn from)', () => {
    expect(partyRole(procab, '"KONTRAGENT 1" MCHJ', '"PROCAB" MCHJ')).toBe('defendant')
    expect(partyRole(procab, '"PROCAB" MCHJ', '"KONTRAGENT 1" MCHJ')).toBe('plaintiff')
    expect(partyRole(procab, 'ABC MCHJ (STIR 302121267)', '"PROCAB" MCHJ')).toBe('plaintiff') // TIN wins over the name
    expect(partyRole(procab, 'ABC MCHJ', 'XYZ MCHJ')).toBeNull()
    expect(partyRole({ names: [undefined, ''], tin: '' }, 'ABC MCHJ', 'XYZ MCHJ')).toBeNull()
  })

  // the field report: 100 cases, the registers know the company in Latin, the courts write it in Cyrillic
  describe('learning the company from the list (100 cases, Cyrillic parties, a Latin company name)', () => {
    const cases = Array.from({ length: 100 }, (_, i) => {
      const me = i % 5 === 4 ? '«ПРОКАБ ГРУПП» МЧЖ' : i % 2 ? 'ПРОКАБ МЧЖ' : '«ПРОКАБ» Масъулияти чекланган жамияти' // spellings drift
      const other = i % 10 === 3 ? 'Давлат солиқ қўмитаси' : `«КОНТРАГЕНТ ${i}» МЧЖ` // one counterparty recurs in 10 cases
      const asPlaintiff = i < 60
      return asPlaintiff ? { plaintiff: me, defendant: other } : { plaintiff: other, defendant: me }
    })
    test('every case gets its side: 60 plaintiff, 40 defendant, none unknown', () => {
      const r = assignRoles(cases, { names: ['PROCAB'], tin: '302121267' })
      expect(r.method).toBe('learned')
      expect(r.roles.filter((x) => x === 'plaintiff')).toHaveLength(60)
      expect(r.roles.filter((x) => x === 'defendant')).toHaveLength(40)
      expect(r.roles.filter((x) => x === null)).toHaveLength(0)
    })
    test('it does not need the company name at all', () => {
      const r = assignRoles(cases, { names: [], tin: '' })
      expect(r.method).toBe('learned')
      expect(r.roles.filter((x) => x === 'plaintiff')).toHaveLength(60)
      expect(r.roles.filter((x) => x === 'defendant')).toHaveLength(40)
    })
    test('the old way (name matching only) would have found almost nothing', () => {
      const old = cases.map((c) => (nameMatches(normalizeName('PROCAB'), normalizeName(c.plaintiff)) ? 'plaintiff' : nameMatches(normalizeName('PROCAB'), normalizeName(c.defendant)) ? 'defendant' : null))
      expect(old.filter((x) => x === null).length).toBeGreaterThan(90)
    })
    test('a recurring counterparty is not mistaken for the company (the known name breaks a tie)', () => {
      // «Soliq» appears in every case, like the company itself: only the known name can tell which one is us
      const tied = cases.map((c, i) => (i < 60 ? { plaintiff: c.plaintiff, defendant: 'Давлат солиқ қўмитаси' } : { plaintiff: 'Давлат солиқ қўмитаси', defendant: c.defendant }))
      const r = assignRoles(tied, { names: ['PROCAB'], tin: '' })
      expect(r.method).toBe('learned')
      expect(r.roles.filter((x) => x === 'plaintiff')).toHaveLength(60)
      expect(r.roles.filter((x) => x === 'defendant')).toHaveLength(40)
    })
    test('an unresolvable tie is unknown, never a guess', () => {
      const tied = cases.map((c, i) => (i < 60 ? { plaintiff: c.plaintiff, defendant: 'Давлат солиқ қўмитаси' } : { plaintiff: 'Давлат солиқ қўмитаси', defendant: c.defendant }))
      const r = assignRoles(tied, { names: ['Boshqa nom'], tin: '' })
      expect(r.roles.every((x) => x === null)).toBe(true)
    })
  })

  test('against another MChJ the company is the defendant (it used to come out as plaintiff)', () => {
    const list = [
      { plaintiff: '"KONTRAGENT 1" MCHJ', defendant: '"PROCAB" MCHJ' },
      { plaintiff: '"KONTRAGENT 2" MCHJ', defendant: '"PROCAB" MCHJ' },
      { plaintiff: '"PROCAB" MCHJ', defendant: '"KONTRAGENT 3" MCHJ' },
    ]
    expect(assignRoles(list, procab).roles).toEqual(['defendant', 'defendant', 'plaintiff'])
  })
  test('missing parties ("-", empty) are unknown, not an error', () => {
    const r = assignRoles([{ plaintiff: '-', defendant: '' }, { plaintiff: null, defendant: undefined }, { plaintiff: '"PROCAB" MCHJ', defendant: 'X Y' }], procab)
    expect(r.roles).toEqual([null, null, 'plaintiff'])
  })
  test('the company against itself (both sides) is unknown', () => {
    expect(assignRoles([{ plaintiff: 'PROCAB MChJ', defendant: '«ПРОКАБ» МЧЖ' }], procab).roles).toEqual([null])
  })
  test('an empty list and a list with no names are fine', () => {
    expect(assignRoles([], procab)).toEqual({ roles: [], method: 'none', keys: [] })
    expect(assignRoles([{ plaintiff: 'A MChJ', defendant: 'B MChJ' }], { names: [], tin: '' }).roles).toEqual([null])
  })
})
