import { describe, expect, test } from 'bun:test'
import { isCaseNumber } from '../case-number'

describe('a real case number', () => {
  test('is X-XXXX-XXXX/N; a placeholder, a blank or nothing is not', () => {
    expect(isCaseNumber('4-1001-2601/12345')).toBe(true)
    expect(isCaseNumber('2-1103-2604/00001')).toBe(true)
    expect(isCaseNumber(' 4-1001-2601/1 ')).toBe(true)
    for (const bad of ['-', '—', '', '   ', null, undefined, 'abc', '4-1001-2601', '4-1001-2601/']) expect(isCaseNumber(bad as string)).toBe(false)
  })
})
