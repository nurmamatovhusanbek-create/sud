import { describe, expect, test } from 'bun:test'
import { currentInstance, pickHearing, reviewOf, stageOfInstance, stageOfRow } from '../hearing-pick'

const NOW = new Date(2026, 9, 5, 9, 0) // 5 Oct 2026, local

describe('pickHearing', () => {
  test('a case in appeal: today\'s review hearing wins over the old first-instance date', () => {
    const h = pickHearing({
      instance: 'Биринчи инстанция', hearing_date: '12.03.2026', hearing_time: '10:00', court: 'Toshkent iqtisodiy sudi',
      reviews: [{ instance: 'Апелляция инстанцияси', hearing_date: '05.10.2026', hearing_time: '14:30', court: 'Apellyatsiya sudi', responsible: 'Aliyev' }],
    }, NOW)
    expect(h).toMatchObject({ date: '05.10.2026', time: '14:30', stage: 'appeal', court: 'Apellyatsiya sudi', judge: 'Aliyev' })
  })

  test('the earliest hearing still ahead, not the latest', () => {
    const h = pickHearing({
      hearing_date: '20.10.2026',
      reviews: [{ instance: 'kassatsiya', hearing_date: '08.10.2026' }, { instance: 'apellyatsiya', hearing_date: '01.09.2026' }],
    }, NOW)
    expect(h).toMatchObject({ date: '08.10.2026', stage: 'cassation' })
  })

  test('same day: the earlier time first', () => {
    const h = pickHearing({ hearing_date: '05.10.2026', hearing_time: '15:00', reviews: [{ instance: 'апелляция', hearing_date: '05.10.2026', hearing_time: '09:30' }] }, NOW)
    expect(h?.time).toBe('09:30')
  })

  test('nothing ahead: the most recent past hearing; nothing at all: null', () => {
    expect(pickHearing({ hearing_date: '01.01.2026', reviews: [{ instance: 'апелляция', hearing_date: '02.02.2026' }] }, NOW)?.date).toBe('02.02.2026')
    expect(pickHearing({ hearing_date: '—', reviews: [] }, NOW)).toBeNull()
    expect(pickHearing({}, NOW)).toBeNull()
  })

  test('ISO dates and a time riding on the date are normalised to dd.mm.yyyy', () => {
    expect(pickHearing({ hearing_date: '2026-10-06' }, NOW)?.date).toBe('06.10.2026')
    expect(pickHearing({ hearing_date: '05.10.2026 10:30' }, NOW)).toMatchObject({ date: '05.10.2026', time: '10:30' })
  })

  test('garbage reviews are ignored', () => {
    expect(pickHearing({ hearing_date: '06.10.2026', reviews: [null, 3, 'x', {}] as never }, NOW)?.date).toBe('06.10.2026')
    expect(pickHearing({ hearing_date: '06.10.2026', reviews: 'nope' as never }, NOW)?.date).toBe('06.10.2026')
  })
})

describe('stageOfInstance', () => {
  test('Cyrillic and Latin spellings', () => {
    expect(stageOfInstance('Апелляция инстанцияси')).toBe('appeal')
    expect(stageOfInstance('Kassatsiya instansiyasi')).toBe('cassation')
    expect(stageOfInstance('Биринчи инстанция')).toBe('first')
    expect(stageOfInstance(undefined)).toBe('first')
  })
})

describe('currentInstance: the judge and court of the instance the case is in now', () => {
  const first = { instance: 'Биринчи инстанция', court: 'Toshkent iqtisodiy sudi', responsible: 'Karimov' }
  test('first instance only: the top-level judge and court', () => {
    expect(currentInstance(first)).toEqual({ stage: 'first', judge: 'Karimov', court: 'Toshkent iqtisodiy sudi' })
  })
  test('in appeal: the APPEAL judge, not the first one', () => {
    const r = currentInstance({ ...first, reviews: [{ instance: 'Апелляция инстанцияси', court: 'Apellyatsiya sudi', responsible: 'Aliyev' }] })
    expect(r).toEqual({ stage: 'appeal', judge: 'Aliyev', court: 'Apellyatsiya sudi' })
  })
  test('in cassation: the cassation judge wins over appeal and first, whatever the order', () => {
    const r = currentInstance({
      ...first,
      reviews: [
        { instance: 'Кассация инстанцияси', court: 'Kassatsiya sudi', responsible: 'Valiyev' },
        { instance: 'Апелляция инстанцияси', court: 'Apellyatsiya sudi', responsible: 'Aliyev' },
      ],
    })
    expect(r).toEqual({ stage: 'cassation', judge: 'Valiyev', court: 'Kassatsiya sudi' })
  })
  test('a review with no judge yet shows none: never the first instance\'s name', () => {
    const r = currentInstance({ ...first, reviews: [{ instance: 'apellyatsiya', court: 'Apellyatsiya sudi' }] })
    expect(r.judge).toBe('')
    expect(r.stage).toBe('appeal')
  })
  test('a review with no court keeps the top-level court (never blank)', () => {
    expect(currentInstance({ ...first, reviews: [{ instance: 'apellyatsiya', responsible: 'Aliyev' }] }).court).toBe('Toshkent iqtisodiy sudi')
  })
  test('junk reviews are ignored', () => {
    expect(currentInstance({ ...first, reviews: [null, 'x', 5] as never }).stage).toBe('first')
  })
})

describe('Taftish (the fourth instance) and the library names', () => {
  test('Cyrillic, Latin and enum spellings of Taftish / Nazorat', () => {
    for (const t of ['Тафтиш инстанцияси', 'Назорат инстанцияси', 'Taftish instansiyasi', 'INSPECTION', 'supervision']) expect(stageOfInstance(t)).toBe('inspection')
  })
  test('CASSATION_REPEATED is cassation, APPEAL is appeal', () => {
    expect(stageOfInstance('CASSATION_REPEATED')).toBe('cassation')
    expect(stageOfInstance('APPEAL')).toBe('appeal')
    expect(stageOfInstance('FIRST')).toBe('first')
  })
  test('a case in taftish: the taftish judge and court, above cassation and appeal', () => {
    const r = currentInstance({
      instance: 'Биринчи инстанция', court: 'First court', responsible: 'Karimov',
      reviews: [
        { instance: 'Тафтиш инстанцияси', court: 'Taftish court', responsible: 'Tashev' },
        { instance: 'Кассация инстанцияси', court: 'Kassatsiya court', responsible: 'Valiyev' },
        { instance: 'Апелляция инстанцияси', court: 'Appeal court', responsible: 'Aliyev' },
      ],
    })
    expect(r).toEqual({ stage: 'inspection', judge: 'Tashev', court: 'Taftish court' })
  })
  test('a row that is itself an appeal row: its own judge, not "first"', () => {
    expect(stageOfRow({ instance: 'Апелляция инстанцияси' })).toBe('appeal')
    expect(currentInstance({ instance: 'Апелляция инстанцияси', court: 'Appeal court', responsible: 'Aliyev' })).toEqual({ stage: 'appeal', judge: 'Aliyev', court: 'Appeal court' })
  })
  test('reviewOf: the latest of several entries of one kind (a repeated cassation)', () => {
    const r = reviewOf({ reviews: [
      { instance: 'Кассация инстанцияси', hearing_date: '01.03.2026', responsible: 'Old' },
      { instance: 'Кассация инстанцияси', hearing_date: '09.09.2026', responsible: 'New' },
    ] }, 'cassation')
    expect(r?.responsible).toBe('New')
    expect(reviewOf({ reviews: [] }, 'inspection')).toBeNull()
  })
  test('pickHearing carries the Taftish hearing with its own judge', () => {
    const h = pickHearing({ hearing_date: '01.01.2026', responsible: 'Karimov', reviews: [{ instance: 'Тафтиш инстанцияси', hearing_date: '06.10.2026', responsible: 'Tashev', court: 'Taftish court' }] }, NOW)
    expect(h).toMatchObject({ stage: 'inspection', judge: 'Tashev', court: 'Taftish court' })
  })
})
