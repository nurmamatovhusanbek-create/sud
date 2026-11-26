import { describe, expect, test } from 'bun:test'
import { clip, DESC_MAX, split, tidy, TITLE_MAX } from '../notify'

describe('pop-ups stay short', () => {
  test('a short message is left as it is', () => {
    expect(split('Qaror saqlandi')).toEqual({ title: 'Qaror saqlandi', rest: null })
    expect(tidy('success', 'Qaror saqlandi')[0]).toBe('Qaror saqlandi')
  })
  test('a long message becomes a title (its first sentence) and a description (the rest)', () => {
    const m = 'public.sud.uz bu qarorni qoʻlda yuklashni talab qildi. Brauzerda oching, Network ochiq turib HAR faylini saqlang va «HAR fayldan yuklash» orqali bering, aks holda qaror yuklanmaydi.'
    const { title, rest } = split(m)
    expect(title).toBe('public.sud.uz bu qarorni qoʻlda yuklashni talab qildi.')
    expect(rest).toContain('HAR faylini saqlang')
    const [t, o] = tidy('error', m)
    expect(t).toBe(title)
    expect(String(o.description).length).toBeLessThanOrEqual(DESC_MAX)
  })
  test('one long sentence with no break is cut at a word, never in the middle of one, and the rest is kept', () => {
    const m = 'Telegram: ' + 'sabab '.repeat(60)
    const { title, rest } = split(m)
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX + 1)
    expect(title.endsWith('…')).toBe(true)
    expect(rest!.length).toBeGreaterThan(50)
    expect(clip('a b c', 100)).toBe('a b c')
  })
  test('an own description is kept (clipped), the cut-off rest comes first', () => {
    const [, o] = tidy('error', 'x'.repeat(5) + ' ' + 'y'.repeat(150), { description: 'Aniqroq: ' + 'z'.repeat(400) })
    expect(String(o.description).length).toBeLessThanOrEqual(DESC_MAX)
    const [, o2] = tidy('success', 'Tayyor', { description: 'q'.repeat(500) })
    expect(String(o2.description).length).toBeLessThanOrEqual(DESC_MAX)
  })
  test('the same message replaces itself (an id from type and title); an id given by the caller wins; loading has none', () => {
    expect(tidy('error', 'Xato')[1].id).toBe('error:Xato')
    expect(tidy('error', 'Xato', { id: 'mine' })[1].id).toBe('mine')
    expect(tidy('loading', 'Yuklanmoqda…')[1].id).toBeUndefined()
  })
  test('one corner for every pop-up: a position asked for is dropped', () => {
    expect((tidy('loading', 'Soʻralmoqda…', { position: 'top-left' })[1] as { position?: string }).position).toBeUndefined()
  })
  test('anything that is not text (a node) passes through', () => {
    const node = { type: 'div' } as never
    expect(tidy('info', node)[0]).toBe(node)
  })
})
