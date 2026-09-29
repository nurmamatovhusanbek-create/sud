import { describe, expect, test } from 'bun:test'
import { caseToDocValues, formatHearingDate, PREFILLABLE_DOCS } from '../from-case'
import { docById } from '../registry'
import { uzCyrToLat } from '@/core/translit'

describe('uzCyrToLat', () => {
  test.each([
    ['Тошкент туманлараро иқтисодий суди', 'Toshkent tumanlararo iqtisodiy sudi'],
    ['Ўзбекистон', 'Oʻzbekiston'],
    ['ҒУЛОМОВ ШАВКАТ', 'GʻULOMOV SHAVKAT'],
    ['Ёқубов Юсуф Яхшиевич', 'Yoqubov Yusuf Yaxshiyevich'],
    ['Еркин Мехнат', 'Yerkin Mexnat'],
    ['Абдуллаев', 'Abdullayev'], // «е» after a vowel is «ye»
    ['Мехнат', 'Mexnat'], // …after a consonant just «e»
  ])('%s → %s', (cyr, lat) => expect(uzCyrToLat(cyr)).toBe(lat))
  test('Latin text is left exactly as it is', () => expect(uzCyrToLat('Toshkent sud “ABC” MChJ')).toBe('Toshkent sud “ABC” MChJ'))
})

describe('formatHearingDate — reads as «… 2026-yil 12-oktabr kuni soat …»', () => {
  test('dd.mm.yyyy and ISO', () => {
    expect(formatHearingDate('12.10.2026')).toBe('2026-yil 12-oktabr')
    expect(formatHearingDate('2026-03-01')).toBe('2026-yil 1-mart')
  })
  test('junk in, nothing out', () => {
    for (const bad of ['', '-', '—', 'tez orada', '31.13.2026', undefined]) expect(formatHearingDate(bad)).toBe('')
  })
})

describe('caseToDocValues', () => {
  const input = {
    caseNumber: '4-1001-2619/21743',
    general: { court: 'Тошкент туманлараро иқтисодий суд', judge: 'Хусанов У.Р.', plaintiff: '«ABC» МЧЖ', claimSubject: 'Pudrat shartnomasi yuzasidan' },
    upcoming: { date: '02.10.2026', time: '10:30:00' },
    companyName: '“PROCAB” MChJ',
  }
  test('fills every field the case data knows, in Latin', () => {
    expect(caseToDocValues(input)).toEqual({
      court: 'Toshkent tumanlararo iqtisodiy sud',
      judge: 'Xusanov U.R.',
      case_number: '4-1001-2619/21743',
      plaintiff: '«ABC» MChJ',
      company: '“PROCAB” MChJ',
      contract_subject: 'Pudrat shartnomasi yuzasidan',
      hearing_date: '2026-yil 2-oktabr',
      hearing_time: '10:30',
    })
  })
  test('unknown parts are omitted (the form keeps its own placeholder), never written as «-»', () => {
    expect(caseToDocValues({ caseNumber: '4-1-2601/1', general: { court: '-', judge: '' }, upcoming: null })).toEqual({ case_number: '4-1-2601/1' })
  })
  test('every key it produces is a real field of the documents it is meant for', () => {
    const keys = Object.keys(caseToDocValues(input))
    for (const id of PREFILLABLE_DOCS) {
      const fields = docById(id)!.fields
      for (const k of keys) expect(fields).toContain(k)
    }
  })
})
