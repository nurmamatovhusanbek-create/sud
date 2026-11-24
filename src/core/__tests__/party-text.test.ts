import { describe, expect, test } from 'bun:test'
import { firstText, normalizeRow, partyText } from '../party-text'
import { assignRoles } from '../classify'
import type { CourtCase } from '@/lib/court-case-types'

const row = (o: Record<string, unknown> = {}): CourtCase => ({ caseNumber: '3-1709-1901/856', caseType: '', caseStatus: 'Якунланган', result: '', courtName: '', dateFiled: '', plaintiff: 'A', defendant: 'B', claimAmount: '', hearingDate: '', hearingTime: '', judge: '', ...o }) as CourtCase

describe('text out of whatever the court sent', () => {
  test('strings stay, lists are joined, named objects give their name, the rest is empty', () => {
    expect(partyText('ANDIJONKABEL AJ')).toBe('ANDIJONKABEL AJ')
    expect(partyText([])).toBe('')
    expect(partyText(['A MChJ', '', ' - ', 'B MChJ'])).toBe('A MChJ; B MChJ')
    expect(partyText([{ name: 'A MChJ' }, { title: 'B' }])).toBe('A MChJ; B')
    expect(partyText(12345)).toBe('12345')
    for (const v of [null, undefined, {}, true, NaN]) expect(partyText(v)).toBe('')
  })

  test('firstText skips an EMPTY LIST (truthy in JS: `[] || x` kept it and broke the row) and the «-» mark', () => {
    expect(firstText([], 'ANDIJONKABEL AJ')).toBe('ANDIJONKABEL AJ')
    expect(firstText([], null, '-')).toBe('-')
    expect(firstText(undefined)).toBe('-')
    expect(firstText(['X MChJ'], 'Y')).toBe('X MChJ')
  })

  test('normalizeRow makes every text field a string and hands back a clean row as it is', () => {
    const clean = row()
    expect(normalizeRow(clean)).toBe(clean)
    const fixed = normalizeRow(row({ plaintiff: [], defendant: ['B MChJ'], claimAmount: 1500 }))
    expect(fixed).toMatchObject({ plaintiff: '', defendant: 'B MChJ', claimAmount: '1500', caseNumber: '3-1709-1901/856' })
  })

  test('the sides can be decided over a row whose party is a list (it used to throw «.trim is not a function»)', () => {
    const rows = [row({ plaintiff: [], defendant: 'ANDIJONKABEL AJ' }), row({ plaintiff: 'ANDIJONKABEL AJ', defendant: ['X'] })]
    expect(() => assignRoles(rows as never, { names: ['ANDIJONKABEL AJ'], tin: '200248856' })).not.toThrow()
  })
})
