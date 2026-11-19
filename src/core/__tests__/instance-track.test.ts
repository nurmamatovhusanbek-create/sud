import { describe, expect, test } from 'bun:test'
import { addMonthsDmy, buildTrack } from '../instance-track'

const NOW = new Date(2026, 9, 5) // 5 Oct 2026
const t = (input: Parameters<typeof buildTrack>[0], courtType = 'economic') => buildTrack(input, { courtType, now: NOW })
const by = (s: ReturnType<typeof t>) => Object.fromEntries(s.map((x) => [x.key, x]))

describe('addMonthsDmy', () => {
  test('calendar months, the day clamped', () => {
    expect(addMonthsDmy('15.03.2026', 1)).toBe('15.04.2026')
    expect(addMonthsDmy('31.01.2026', 1)).toBe('28.02.2026')
    expect(addMonthsDmy('30.09.2026', 6)).toBe('30.03.2027')
    expect(addMonthsDmy('garbage', 1)).toBeNull()
  })
})

describe('buildTrack: the instances are not a fixed chain', () => {
  test('first → appeal → taftish (cassation skipped): cassation reads «Oʻtkazilgan», not a gap (case 4-1001-2621/42935)', () => {
    const s = by(t({
      first: { has: true, decided: true, decisionDate: '03.03.2026' },
      appeal: { has: true, decided: true, decisionDate: '04.05.2026' },
      inspection: { has: true },
    }))
    expect(s.cassation).toMatchObject({ state: 'skipped', note: 'Oʻtkazilgan' })
    expect(s.appeal.state).toBe('done')
    expect(s.inspection).toMatchObject({ state: 'done', note: 'Koʻrib chiqilmoqda', current: true })
    // the line jumps over the skipped instance
    expect([s.first.link, s.appeal.link, s.cassation.link, s.inspection.link]).toEqual(['solid', 'dash', 'dash', 'none'])
  })
  test('appeal skipped, straight to cassation', () => {
    const s = by(t({ first: { has: true, decided: true, decisionDate: '01.02.2026' }, cassation: { has: true, decided: true, decisionDate: '01.08.2026' } }))
    expect(s.appeal.state).toBe('skipped')
    expect(s.cassation.state).toBe('done')
    expect(s.inspection.state).toBe('none')
  })
  test('a ruling a week ago: the appeal window is open (days left) and cassation is open too (6 months)', () => {
    const s = by(t({ first: { has: true, decided: true, decisionDate: '28.09.2026' } }))
    expect(s.appeal).toMatchObject({ state: 'open', until: '28.10.2026', daysLeft: 23 })
    expect(s.cassation).toMatchObject({ state: 'open', until: '28.03.2027' })
  })
  test('an old ruling: the windows closed: neutral «Berilmagan», never «late»', () => {
    const s = by(t({ first: { has: true, decided: true, decisionDate: '01.01.2026' } }))
    expect(s.appeal).toMatchObject({ state: 'closed', note: 'Berilmagan' })
    expect(s.cassation).toMatchObject({ state: 'closed', until: '01.07.2026' })
    expect(s.appeal.hint).toContain('tiklashi mumkin')
  })
  test('administrative cassation window is a year', () => {
    expect(by(t({ first: { has: true, decided: true, decisionDate: '01.01.2026' } }, 'administrative')).cassation).toMatchObject({ state: 'open', until: '01.01.2027' })
  })
  test('still in the first instance (no ruling): nothing is due yet', () => {
    const s = by(t({ first: { has: true } }))
    expect(s.appeal).toMatchObject({ state: 'none', note: 'Hali yoʻq' })
    expect(s.cassation.state).toBe('none')
    expect(s.first).toMatchObject({ state: 'done', note: 'Koʻrib chiqilmoqda', current: true })
  })
  test('in appeal with no ruling yet: cassation is not due', () => {
    const s = by(t({ first: { has: true, decided: true, decisionDate: '01.03.2026' }, appeal: { has: true } }))
    expect(s.cassation.state).toBe('none')
  })
})
