import { test, expect, describe } from 'bun:test'
import {
  toTiyin,
  formatSum,
  spellInteger,
  spellMoney,
  spellIntegerUz,
  spellMoneyUz,
  addBankingDays,
  delayDays,
  dayWord,
  formatDate,
  computeClaim,
  paymentClause,
} from '../pretenzia'

// Real letters are the oracle. The engine is generic over any number of
// contracts; these three just pin the arithmetic + wording exactly.

describe('formatSum', () => {
  test('thin-grouped, comma decimal', () => {
    expect(formatSum(toTiyin(5538730518.42))).toBe('5 538 730 518,42')
    expect(formatSum(toTiyin(240144154.6))).toBe('240 144 154,60')
    expect(formatSum(toTiyin(0))).toBe('0,00')
    expect(formatSum(toTiyin(58700600))).toBe('58 700 600,00')
  })
})

describe('spellInteger — gender & declension', () => {
  test('units triplet masculine, thousands feminine', () => {
    expect(spellInteger(5_538_730_518)).toBe(
      'пять миллиардов пятьсот тридцать восемь миллионов семьсот тридцать тысяч пятьсот восемнадцать',
    )
    expect(spellInteger(2_171_182_363)).toBe(
      'два миллиарда сто семьдесят один миллион сто восемьдесят две тысячи триста шестьдесят три',
    )
    expect(spellInteger(1_768_990_031)).toBe(
      'один миллиард семьсот шестьдесят восемь миллионов девятьсот девяносто тысяч тридцать один',
    )
    expect(spellInteger(5_264_851_284)).toBe(
      'пять миллиардов двести шестьдесят четыре миллиона восемьсот пятьдесят одна тысяча двести восемьдесят четыре',
    )
    expect(spellInteger(240_144_154)).toBe(
      'двести сорок миллионов сто сорок четыре тысячи сто пятьдесят четыре',
    )
    expect(spellInteger(63_398_056)).toBe(
      'шестьдесят три миллиона триста девяносто восемь тысяч пятьдесят шесть',
    )
    expect(spellInteger(0)).toBe('ноль')
  })
})

describe('spellMoney — full прописью', () => {
  test('K1125545 debt & penalty', () => {
    expect(spellMoney(toTiyin(5538730518.42))).toBe(
      'пять миллиардов пятьсот тридцать восемь миллионов семьсот тридцать тысяч пятьсот восемнадцать сум 42 тийин',
    )
    expect(spellMoney(toTiyin(2171182363.22))).toBe(
      'два миллиарда сто семьдесят один миллион сто восемьдесят две тысячи триста шестьдесят три сум 22 тийин',
    )
  })
  test('K1127247 debt (00 тийин, «одна тысяча»)', () => {
    expect(spellMoney(toTiyin(5264851284.0))).toBe(
      'пять миллиардов двести шестьдесят четыре миллиона восемьсот пятьдесят одна тысяча двести восемьдесят четыре сум 00 тийин',
    )
  })
  test('K1128937 debt & penalty', () => {
    expect(spellMoney(toTiyin(240144154.6))).toBe(
      'двести сорок миллионов сто сорок четыре тысячи сто пятьдесят четыре сум 60 тийин',
    )
    expect(spellMoney(toTiyin(63398056.81))).toBe(
      'шестьдесят три миллиона триста девяносто восемь тысяч пятьдесят шесть сум 81 тийин',
    )
  })
})

describe('addBankingDays — 5 business days after the contract date', () => {
  test('matches the letters (Fri starts) and computes Mon start', () => {
    // 05.06.2026 Fri → 12.06.2026 Fri
    expect(formatDate(addBankingDays(new Date(2026, 5, 5), 5))).toBe('12.06.2026')
    // 19.06.2026 Fri → 26.06.2026 Fri
    expect(formatDate(addBankingDays(new Date(2026, 5, 19), 5))).toBe('26.06.2026')
    // 06.07.2026 Mon → 13.07.2026 Mon (letter hand-adjusted to 14.07 — editable)
    expect(formatDate(addBankingDays(new Date(2026, 6, 6), 5))).toBe('13.07.2026')
  })
})

describe('delayDays — inclusive, to claim date', () => {
  test('reproduces 98 / 84 / 66', () => {
    const claim = new Date(2026, 8, 17) // 17.09.2026
    expect(delayDays(new Date(2026, 5, 12), claim)).toBe(98)
    expect(delayDays(new Date(2026, 5, 26), claim)).toBe(84)
    expect(delayDays(new Date(2026, 6, 14), claim)).toBe(66)
  })
})

describe('spellIntegerUz / spellMoneyUz — Uzbek', () => {
  test('plain concatenation, «ming» drops «bir»', () => {
    expect(spellIntegerUz(5_538_730_518)).toBe(
      'besh milliard besh yuz oʻttiz sakkiz million yetti yuz oʻttiz ming besh yuz oʻn sakkiz',
    )
    expect(spellIntegerUz(240_144_154)).toBe(
      'ikki yuz qirq million yuz qirq toʻrt ming yuz ellik toʻrt',
    )
    expect(spellIntegerUz(1000)).toBe('ming')
    expect(spellIntegerUz(1_000_000)).toBe('bir million')
    expect(spellIntegerUz(2100)).toBe('ikki ming yuz')
    expect(spellIntegerUz(0)).toBe('nol')
  })
  test('spellMoneyUz adds soʻm / tiyin', () => {
    expect(spellMoneyUz(toTiyin(5538730518.42))).toBe(
      'besh milliard besh yuz oʻttiz sakkiz million yetti yuz oʻttiz ming besh yuz oʻn sakkiz soʻm 42 tiyin',
    )
    expect(spellMoneyUz(toTiyin(240144154.6))).toBe(
      'ikki yuz qirq million yuz qirq toʻrt ming yuz ellik toʻrt soʻm 60 tiyin',
    )
  })
})

describe('paymentClause — uz', () => {
  test('partial / none', () => {
    expect(paymentClause(toTiyin(58700600), 'uz')).toBe('(qisman toʻlov 58 700 600,00 soʻmni tashkil etgan)')
    expect(paymentClause(0, 'uz')).toBe('(toʻlov amalga oshirilmagan)')
  })
})

describe('dayWord — Russian agreement', () => {
  test('matches the letters', () => {
    expect(dayWord(98)).toBe('дней')
    expect(dayWord(84)).toBe('дня')
    expect(dayWord(66)).toBe('дней')
    expect(dayWord(1)).toBe('день')
    expect(dayWord(21)).toBe('день')
    expect(dayWord(112)).toBe('дней')
  })
})

describe('computeClaim — full figures per contract', () => {
  const claim = new Date(2026, 8, 17)

  test('K1125545 — partial payment', () => {
    const r = computeClaim({
      mainDebtTiyin: toTiyin(5538730518.42),
      paymentTiyin: toTiyin(272628881.58),
      delayStart: new Date(2026, 5, 12),
      claimDate: claim,
    })
    expect(formatSum(r.suppliedTiyin)).toBe('5 811 359 400,00')
    expect(r.days).toBe(98)
    expect(formatSum(r.penaltyTiyin)).toBe('2 171 182 363,22')
    expect(r.penaltyCapped).toBe(false)
    expect(paymentClause(r.paymentTiyin)).toBe('(частичная оплата составила 272 628 881,58 сум)')
  })

  test('K1127247 — no payment', () => {
    const r = computeClaim({
      mainDebtTiyin: toTiyin(5264851284.0),
      paymentTiyin: 0,
      delayStart: new Date(2026, 5, 26),
      claimDate: claim,
    })
    expect(formatSum(r.suppliedTiyin)).toBe('5 264 851 284,00')
    expect(r.days).toBe(84)
    expect(formatSum(r.penaltyTiyin)).toBe('1 768 990 031,42')
    expect(paymentClause(r.paymentTiyin)).toBe('(оплата не производилась)')
  })

  test('K1128937 — opening advance as payment', () => {
    const r = computeClaim({
      mainDebtTiyin: toTiyin(240144154.6),
      paymentTiyin: toTiyin(58700600),
      delayStart: new Date(2026, 6, 14),
      claimDate: claim,
    })
    expect(formatSum(r.suppliedTiyin)).toBe('298 844 754,60')
    expect(r.days).toBe(66)
    expect(formatSum(r.penaltyTiyin)).toBe('63 398 056,81')
    expect(paymentClause(r.paymentTiyin)).toBe('(частичная оплата составила 58 700 600,00 сум)')
  })

  test('penalty cap applies at 50% of the debt', () => {
    // 300 days at 0.4% = 120% → capped to 50%
    const r = computeClaim({
      mainDebtTiyin: toTiyin(1000000),
      paymentTiyin: 0,
      delayStart: new Date(2026, 0, 1),
      claimDate: new Date(2026, 11, 31),
    })
    expect(r.penaltyCapped).toBe(true)
    expect(r.penaltyTiyin).toBe(toTiyin(500000))
  })
})
