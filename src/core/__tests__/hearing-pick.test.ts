import { describe, expect, test } from 'bun:test'
import { currentInstance, pickHearing, stageOfInstance } from '../hearing-pick'

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
