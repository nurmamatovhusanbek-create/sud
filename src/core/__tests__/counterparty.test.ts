import { describe, expect, test } from 'bun:test'
import { counterpartyRecord, type CounterpartyCase } from '../counterparty'

const cases: CounterpartyCase[] = [
  { caseNumber: '1', counterparty: 'Toshkent Metro Qurilish AJ', classification: 'lose' },
  { caseNumber: '2', counterparty: '«TOSHKENT METRO QURILISH» AJ', classification: 'win' },
  { caseNumber: '3', counterparty: 'Nur Elektro Montaj MChJ', classification: 'win' },
  { caseNumber: '4', counterparty: 'Toshkent Metro Qurilish AJ', classification: 'pending' },
]

describe('counterpartyRecord', () => {
  test('matches the same party however its name is written, and counts by outcome', () => {
    expect(counterpartyRecord(cases, 'Toshkent Metro Qurilish AJ')).toEqual({ total: 3, win: 1, lose: 1, neutral: 0, pending: 1, cases: ['1', '2', '4'] })
  })
  test('the case in front of you is not its own history', () => {
    expect(counterpartyRecord(cases, 'Toshkent Metro Qurilish AJ', '4').total).toBe(2)
  })
  test('an unknown or empty name matches nothing', () => {
    expect(counterpartyRecord(cases, 'Boshqa MChJ').total).toBe(0)
    expect(counterpartyRecord(cases, '').total).toBe(0)
  })
})

describe('identity', () => {
  test('a shared legal form never joins two companies', () => {
    expect(counterpartyRecord(cases, 'Boshqa MChJ').total).toBe(0)
  })
  test('the same company in Cyrillic and in a different legal-form spelling is one party', () => {
    const r = counterpartyRecord([{ caseNumber: '9', counterparty: 'Тошкент Метро Қурилиш АЖ', classification: 'win' }], '«Toshkent Metro Qurilish» aktsiyadorlik jamiyati')
    expect(r.total).toBe(1)
  })
})
