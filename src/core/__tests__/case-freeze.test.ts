import { describe, expect, test } from 'bun:test'
import { caseFreeze, FREEZE_AFTER_DAYS } from '../case-freeze'

const NOW = new Date(2026, 10, 22) // 22.11.2026
const ago = (days: number): string => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - days)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
const inDays = (days: number): string => ago(-days)

describe('caseFreeze', () => {
  test('a case that ended long ago is frozen: the court is not asked again', () => {
    const f = caseFreeze({ status: 'Якунланган (Ижро варақасиз)', dates: [ago(400), ago(430)] }, NOW)
    expect(f).toEqual({ settled: true, frozen: true, quietDays: 400 })
  })

  test('a case that ended inside the appeal / cassation window is settled but NOT frozen (a new proceeding may still appear)', () => {
    const f = caseFreeze({ status: 'Якунланган (Ижро варақасиз)', dates: [ago(20)] }, NOW)
    expect(f.settled).toBe(true)
    expect(f.frozen).toBe(false)
  })

  test('the window is the cassation period plus a margin, to the day', () => {
    expect(caseFreeze({ status: 'Архивда', dates: [ago(FREEZE_AFTER_DAYS)] }, NOW).frozen).toBe(true)
    expect(caseFreeze({ status: 'Архивда', dates: [ago(FREEZE_AFTER_DAYS - 1)] }, NOW).frozen).toBe(false)
  })

  test('a hearing still ahead means the case is not settled, whatever the status says', () => {
    const f = caseFreeze({ status: 'Якунланган (Ижро варақасиз)', dates: [ago(900), inDays(3)] }, NOW)
    expect(f).toMatchObject({ settled: false, frozen: false })
  })

  test('an ongoing case is never settled or frozen', () => {
    expect(caseFreeze({ status: 'Кўриб чиқиш жараёнида', dates: [ago(900)] }, NOW)).toMatchObject({ settled: false, frozen: false })
    expect(caseFreeze({ status: 'Иш қўзғатиш', dates: [ago(900)] }, NOW)).toMatchObject({ settled: false, frozen: false })
  })

  test('refused and archived count as over; an unknown or missing status does not', () => {
    expect(caseFreeze({ status: 'Қабул қилиш рад этилган (девонхона)', dates: [ago(500)] }, NOW).frozen).toBe(true)
    expect(caseFreeze({ status: 'Иш ҳолати номаълум', dates: [ago(500)] }, NOW).settled).toBe(false)
    expect(caseFreeze({ status: undefined, dates: [ago(500)] }, NOW).settled).toBe(false)
  })

  test('with no readable date a finished case is settled but cannot be proven old, so it is not frozen', () => {
    expect(caseFreeze({ status: 'Якунланган (Ижро варақасиз)', dates: ['', null, 'xx'] }, NOW)).toEqual({ settled: true, frozen: false, quietDays: null })
  })

  test('dates are read as dd.mm.yyyy, never compared as text', () => {
    // '10.01.2026' sorts before '15.12.2025' as a string but is the LATER date
    const f = caseFreeze({ status: 'Архивда', dates: ['15.12.2025', '10.01.2026'] }, NOW)
    expect(f.quietDays).toBe(Math.round((NOW.getTime() - new Date(2026, 0, 10).getTime()) / 86_400_000))
  })
})
