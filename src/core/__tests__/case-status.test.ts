import { describe, expect, test } from 'bun:test'
import { caseStatusInfo, isConcludedStatus } from '../case-status'
import { classifyOutcome } from '../classify'
import { isOngoingFirstInstance } from '../public-orders'

/** the values below are the REAL `status_name` / `result` strings jadvalapi.sud.uz returned (read live, Nov 2026), double spaces included */
describe('caseStatusInfo: the court\'s real statuses', () => {
  test('every real status is known', () => {
    const real: [string, string, boolean][] = [
      ['Кўриб чиқиш жараёнида', 'ongoing', false],
      ['Тайинлаш', 'ongoing', false],
      ['Рўйхатга олиш', 'ongoing', false],
      ['Натижа қабул қилинган', 'finished', false],
      ['Архивга топширилган', 'archived', false],
      ['Иш қўзғатиш', 'ongoing', false],
      ['Тайёрлаш', 'ongoing', false],
      ['Якунланган (Ижро варақасиз)', 'finished', false],
      ['Якунланган  (Ижро варақа билан)', 'finished', true],
      ['Архивда', 'archived', false],
      ['Қабул қилиш рад этилган (девонхона)', 'refused', false],
      ['Фуқаро шахсий кабинетида яратилган, судга юборилмаган', 'draft', false],
      ['Иш ҳолати номаълум', 'unknown', false],
    ]
    for (const [s, stage, writ] of real) expect(caseStatusInfo(s)).toMatchObject({ stage, writ })
  })
  test('a writ of execution is told apart (ijro varaqasi bilan / siz)', () => {
    expect(caseStatusInfo('Якунланган  (Ижро варақа билан)')?.label).toContain('ijro varaqasi bilan')
    expect(caseStatusInfo('Якунланган (Ижро варақасиз)')?.label).toBe('Yakunlangan')
  })
  test('instance statuses and empties are not this table\'s business', () => {
    expect(caseStatusInfo('Апелляцияда')).toBeNull()
    expect(caseStatusInfo('Назоратда')).toBeNull()
    expect(caseStatusInfo('')).toBeNull()
    expect(caseStatusInfo('-')).toBeNull()
  })
  test('concluded = finished, archived, refused', () => {
    expect(isConcludedStatus('Якунланган (Ижро варақасиз)')).toBe(true)
    expect(isConcludedStatus('Архивда')).toBe(true)
    expect(isConcludedStatus('Қабул қилиш рад этилган (девонхона)')).toBe(true)
    expect(isConcludedStatus('Кўриб чиқиш жараёнида')).toBe(false)
  })
})

describe('classifyOutcome with the real results and statuses', () => {
  test('a finished case with NO result text is no longer «in progress»', () => {
    expect(classifyOutcome('plaintiff', '', 'Якунланган (Ижро варақасиз)')).toBe('neutral')
    expect(classifyOutcome('defendant', '', 'Архивда')).toBe('neutral')
    expect(classifyOutcome('plaintiff', '', 'Қабул қилиш рад этилган (девонхона)')).toBe('neutral')
  })
  test('a case being heard (or with no status) stays pending', () => {
    expect(classifyOutcome('plaintiff', '', 'Кўриб чиқиш жараёнида')).toBe('pending')
    expect(classifyOutcome('plaintiff', '', 'Тайинлаш')).toBe('pending')
    expect(classifyOutcome('plaintiff', '')).toBe('pending')
  })
  test('«sent to another court» and «claim not accepted» decide nothing (they were pending / a defendant win)', () => {
    expect(classifyOutcome('plaintiff', 'Бошқа судга юборилган')).toBe('neutral')
    expect(classifyOutcome('plaintiff', 'Қабул қилиш рад қилинган')).toBe('neutral')
    expect(classifyOutcome('defendant', 'Қабул қилиш рад қилинган')).toBe('neutral')
  })
  test('the real results that were already right stay right', () => {
    expect(classifyOutcome('plaintiff', 'Тўлиқ қаноатлантирилган')).toBe('win')
    expect(classifyOutcome('plaintiff', 'Қисман қаноатлантирилган')).toBe('win')
    expect(classifyOutcome('defendant', 'Рад қилинган')).toBe('win')
    expect(classifyOutcome('plaintiff', 'Рад қилинган')).toBe('lose')
    expect(classifyOutcome('plaintiff', 'Қайтарилган')).toBe('neutral')
    expect(classifyOutcome('plaintiff', 'Кўрмасдан қолдирилган')).toBe('lose')
    expect(classifyOutcome('defendant', 'Иш юритишдан тугатилган')).toBe('neutral')
  })
})

describe('isOngoingFirstInstance with the real statuses', () => {
  test('being heard / scheduled / registered / a draft not sent: ongoing', () => {
    for (const s of ['Кўриб чиқиш жараёнида', 'Тайинлаш', 'Рўйхатга олиш', 'Фуқаро шахсий кабинетида яратилган, судга юборилмаган']) {
      expect(isOngoingFirstInstance({ result: '', caseStatus: s })).toBe(true)
    }
  })
  test('refused at the chancellery has no order either; a FINISHED case with no result text is worth a look', () => {
    expect(isOngoingFirstInstance({ result: '', caseStatus: 'Қабул қилиш рад этилган (девонхона)' })).toBe(true)
    expect(isOngoingFirstInstance({ result: '', caseStatus: 'Якунланган (Ижро варақасиз)' })).toBe(false)
    expect(isOngoingFirstInstance({ result: '', caseStatus: 'Иш ҳолати номаълум' })).toBe(false)
  })
})
