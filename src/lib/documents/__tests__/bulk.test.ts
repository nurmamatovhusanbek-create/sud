import { describe, expect, test } from 'bun:test'
import { excelDate, gridToRows, matchColumns, normHeader, parseCsv, rowsToValues, templateCsv } from '../bulk'
import { FIELDS } from '../registry'

describe('parseCsv', () => {
  test('semicolons (Excel in Uzbekistan), BOM, quotes, doubled quotes, CRLF', () => {
    const r = parseCsv('﻿F.I.Sh;Telefon;Izoh\r\n"Aliyev, Ali";+998 90 123 45 67;"u ""dedi"""\r\n')
    expect(r).toEqual([['F.I.Sh', 'Telefon', 'Izoh'], ['Aliyev, Ali', '+998 90 123 45 67', 'u "dedi"']])
  })
  test('commas and tabs', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
  test('trailing empty lines are dropped; a missing final newline is fine', () => {
    expect(parseCsv('a;b\n1;2\n\n\n')).toEqual([['a', 'b'], ['1', '2']])
  })
})

test('gridToRows: dense, text, trailing empties dropped', () => {
  const grid = new Map([[1, new Map<number, string | number>([[1, 'A'], [3, 'C']])], [2, new Map<number, string | number>([[2, 5]])], [4, new Map<number, string | number>()]])
  expect(gridToRows(grid)).toEqual([['A', '', 'C'], ['', '5', '']])
})

test('excelDate', () => {
  expect(excelDate(45292)).toBe('01.01.2024')
  expect(excelDate(12)).toBeNull()
  expect(excelDate(NaN)).toBeNull()
})

describe('matchColumns', () => {
  const keys = ['full_name', 'passport', 'dob', 'phone']
  test('by label, by key, loosely (case, apostrophes, notes)', () => {
    expect(matchColumns(['F.I.Sh (toʻliq)', 'PASSPORT', 'Tugʻilgan sana', 'Telefon'], keys)).toEqual(['full_name', 'passport', 'dob', 'phone'])
    expect(matchColumns(["Tug'ilgan sana"], keys)).toEqual(['dob']) // a straight apostrophe matches the label's ʻ
  })
  test('unknown headers and blanks are not mapped', () => {
    expect(matchColumns(['Izoh', ''], keys)).toEqual([null, null])
  })
  test('a key is taken once, by the first column', () => {
    expect(matchColumns(['phone', 'Telefon'], keys)).toEqual(['phone', null])
  })
  test('normHeader', () => {
    expect(normHeader(' Emp_Name (lotinda) ')).toBe('empname')
  })
})

describe('rowsToValues', () => {
  const base = { company: 'Alfa', phone: '+998 90 000 00 00' }
  test('the row lays over the form; an empty cell keeps the form value; blank rows are skipped', () => {
    const out = rowsToValues([['Aliyev', ''], ['', ''], ['Valiyev', '+998 91 111 11 11']], ['full_name', 'phone'], base)
    expect(out).toEqual([
      { company: 'Alfa', phone: '+998 90 000 00 00', full_name: 'Aliyev' },
      { company: 'Alfa', phone: '+998 91 111 11 11', full_name: 'Valiyev' },
    ])
  })
  test('an Excel date serial in a date column becomes dd.mm.yyyy (other columns are left alone)', () => {
    const [v] = rowsToValues([['45201', '45201']], ['dob', 'passport'], {})
    expect(v.dob).toBe('02.10.2023')
    expect(v.passport).toBe('45201')
    expect(FIELDS.dob.kind).toBe('date')
  })
  test('the hearing date is written the way the letter reads it, from a serial or a dd.mm.yyyy', () => {
    expect(rowsToValues([['45292']], ['hearing_date'], {})[0].hearing_date).toBe('2024-yil 1-yanvar')
    expect(rowsToValues([['15.12.2026']], ['hearing_date'], {})[0].hearing_date).toBe('2026-yil 15-dekabr')
    expect(rowsToValues([['kelasi hafta']], ['hearing_date'], {})[0].hearing_date).toBe('kelasi hafta') // free text is kept
  })
  test('unmapped columns are ignored', () => {
    expect(rowsToValues([['x', 'Aliyev']], [null, 'full_name'], {})).toEqual([{ full_name: 'Aliyev' }])
  })
})

test('templateCsv: labels as the header, defaults as the example, BOM for Excel', () => {
  const t = templateCsv(['company', 'full_name'], { company: 'Alfa; MCHJ', full_name: '' })
  expect(t.startsWith('﻿')).toBe(true)
  const rows = parseCsv(t)
  expect(rows[0]).toEqual([FIELDS.company.label, FIELDS.full_name.label])
  expect(rows[1]).toEqual(['Alfa; MCHJ', ''])
})
