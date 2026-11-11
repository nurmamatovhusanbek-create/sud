import { describe, expect, test } from 'bun:test'
import { caseTimeline } from '../case-timeline'

const NOW = new Date(2026, 10, 11) // Nov 2026

describe('caseTimeline', () => {
  test('a window of months ending now, oldest first, the year on the first column and on every January', () => {
    const t = caseTimeline([], NOW, 14)
    expect(t.months).toHaveLength(14)
    expect(t.months[13]).toMatchObject({ key: '2026-11', label: 'Noy' })
    expect(t.months[0]).toMatchObject({ key: '2025-10', year: 2025 })
    expect(t.months.find((m) => m.key === '2026-1')?.year).toBe(2026)
    expect(t.months.find((m) => m.key === '2026-5')?.year).toBeNull()
  })
  test('cases land in the month they were filed, in filing order, with their outcome', () => {
    const t = caseTimeline(
      [
        { id: 'b', filed: '20.11.2026', outcome: 'pending' },
        { id: 'a', filed: '02.11.2026', outcome: 'win' },
        { id: 'c', filed: '2026-09-15', outcome: null },
      ],
      NOW,
    )
    expect(t.months[17].items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(t.months[15].items).toEqual([{ id: 'c', outcome: null }])
  })
  test('older than the window counts as earlier, an unreadable date as undated, a future typo is neither', () => {
    const t = caseTimeline(
      [{ id: '1', filed: '01.01.2020', outcome: 'lose' }, { id: '2', filed: '', outcome: 'win' }, { id: '3', filed: 'abc', outcome: 'win' }, { id: '4', filed: '01.01.2031', outcome: 'win' }],
      NOW,
    )
    expect(t.earlier).toBe(1)
    expect(t.undated).toBe(2)
    expect(t.months.reduce((n, m) => n + m.items.length, 0)).toBe(0)
  })
})
