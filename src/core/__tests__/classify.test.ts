import { describe, expect, test } from 'bun:test'
import {
  normalizeName,
  nameMatches,
  classifyOutcome,
  remapCourtTypeByCaseNumber,
  dedupCases,
  summarize,
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

describe('classifyOutcome (Interpretation A)', () => {
  test('full satisfaction is a WIN for both roles', () => {
    expect(classifyOutcome('plaintiff', 'Иш тўлиқ қаноатлантирилди')).toBe('win')
    expect(classifyOutcome('defendant', "Da'vo to'liq qanoatlantirildi")).toBe('win')
  })

  test('partial satisfaction is a WIN', () => {
    expect(classifyOutcome('plaintiff', 'Даё қисман қаноатлантирилди')).toBe('win')
    expect(classifyOutcome('defendant', 'qisman qanoatlantirildi')).toBe('win')
  })

  test('rejection: plaintiff LOSE, defendant NEUTRAL', () => {
    expect(classifyOutcome('plaintiff', 'Даво рад этилди')).toBe('lose')
    expect(classifyOutcome('defendant', 'Даво рад этилди')).toBe('neutral')
  })

  test('returned / left-without-review / terminated behave as rejection', () => {
    for (const r of ['Иш қайтарилган', 'Кўрмасдан қолдирилган', 'Иш юритишдан тугатилган']) {
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
