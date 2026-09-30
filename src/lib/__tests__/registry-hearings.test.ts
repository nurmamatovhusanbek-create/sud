import { describe, expect, test } from 'bun:test'
import { daysUntilIso, hearingMetaPatch, upcomingOf } from '../registry'

describe('upcoming hearings in the registry meta', () => {
  test('keeps EVERY hearing, nearest first (a company with two hearings on one day counts twice)', () => {
    const patch = hearingMetaPatch([
      { isoDate: '2026-10-20', hearingTime: '09:00', caseNumber: '4-1/3' },
      { isoDate: '2026-10-02', hearingTime: '10:25', caseNumber: '4-1/2', courtName: 'Sud' },
      { isoDate: '2026-10-02', hearingTime: '10:20', caseNumber: '4-1/1' },
      { caseNumber: 'no date' },
    ])
    expect(patch.upcoming?.map((h) => `${h.iso} ${h.time}`)).toEqual(['2026-10-02 10:20', '2026-10-02 10:25', '2026-10-20 09:00'])
    expect(patch.nextHearingIso).toBe('2026-10-02')
    expect(patch.nextHearingCase).toBe('4-1/1')
  })

  test('older cache entries (only the single next hearing) still read as one hearing', () => {
    expect(upcomingOf({ nextHearingIso: '2026-10-02', nextHearingCase: '4-1/1' })).toEqual([
      { iso: '2026-10-02', court: undefined, caseNumber: '4-1/1', time: undefined, judge: undefined },
    ])
    expect(upcomingOf(undefined)).toEqual([])
    expect(upcomingOf({})).toEqual([])
  })

  test('daysUntilIso counts whole local days, today = 0, past < 0, garbage = null', () => {
    const noon = new Date(2026, 8, 30, 12, 0).getTime()
    expect(daysUntilIso('2026-09-30', noon)).toBe(0)
    expect(daysUntilIso('2026-10-02', noon)).toBe(2)
    expect(daysUntilIso('2026-09-29', noon)).toBeLessThan(0)
    expect(daysUntilIso('nope', noon)).toBeNull()
  })
})
