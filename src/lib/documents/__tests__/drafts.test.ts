import { describe, expect, test } from 'bun:test'
import { changedValues, clearDraft, draftKeyFor, listDrafts, loadDraft, MAX_DRAFTS, saveDraft, type StorageLike } from '../drafts'

function fake(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    get length() {
      return data.size
    },
    key: (i) => [...data.keys()][i] ?? null,
  }
}
const DEF = { company: 'Artikul', name: '', date: '' }

describe('drafts', () => {
  test('keys', () => {
    expect(draftKeyFor({ docId: 'court_copy', tabId: 'court' })).toBe('doc:court_copy')
    expect(draftKeyFor({ tabId: 'visa' })).toBe('tab:visa')
  })
  test('only what differs from the defaults is stored, and it round-trips', () => {
    const s = fake()
    saveDraft(s, 'doc:a', { company: 'Artikul', name: 'Ali', date: '' }, DEF, 1000)
    expect(loadDraft(s, 'doc:a')).toEqual({ key: 'doc:a', values: { name: 'Ali' }, savedAt: 1000 })
  })
  test('clearing a default is a change too', () => {
    expect(changedValues({ company: '', name: '', date: '' }, DEF)).toEqual({ company: '' })
  })
  test('back to the defaults → the draft disappears', () => {
    const s = fake()
    saveDraft(s, 'doc:a', { ...DEF, name: 'Ali' }, DEF)
    saveDraft(s, 'doc:a', DEF, DEF)
    expect(loadDraft(s, 'doc:a')).toBeNull()
    expect(s.data.size).toBe(0)
  })
  test('keys the form does not know are never stored', () => {
    expect(changedValues({ ...DEF, stray: 'x' }, DEF)).toEqual({})
  })
  test('list: newest first, only drafts', () => {
    const s = fake()
    s.setItem('other', 'x')
    saveDraft(s, 'doc:a', { ...DEF, name: 'A' }, DEF, 1)
    saveDraft(s, 'tab:b', { ...DEF, name: 'B' }, DEF, 2)
    expect(listDrafts(s).map((d) => d.key)).toEqual(['tab:b', 'doc:a'])
  })
  test('clear', () => {
    const s = fake()
    saveDraft(s, 'doc:a', { ...DEF, name: 'A' }, DEF)
    clearDraft(s, 'doc:a')
    expect(loadDraft(s, 'doc:a')).toBeNull()
  })
  test('damaged or foreign data reads as «no draft»', () => {
    const s = fake()
    s.setItem('sud.doc-draft.v1:doc:a', '{nope')
    s.setItem('sud.doc-draft.v1:doc:b', JSON.stringify({ values: { a: 5 }, savedAt: 1 }))
    s.setItem('sud.doc-draft.v1:doc:c', JSON.stringify({ values: {}, savedAt: 1 }))
    expect(listDrafts(s)).toEqual([])
    expect(loadDraft(s, 'doc:a')).toBeNull()
  })
  test('at most MAX_DRAFTS are kept: the oldest go', () => {
    const s = fake()
    for (let i = 0; i < MAX_DRAFTS + 5; i++) saveDraft(s, `doc:${i}`, { ...DEF, name: String(i) }, DEF, i + 1)
    const keys = listDrafts(s).map((d) => d.key)
    expect(keys.length).toBe(MAX_DRAFTS)
    expect(keys).not.toContain('doc:0')
    expect(keys).toContain(`doc:${MAX_DRAFTS + 4}`)
  })
  test('a storage that throws never breaks the editor', () => {
    const bad: StorageLike = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('x') }, length: 1, key: () => { throw new Error('x') } }
    expect(() => saveDraft(bad, 'doc:a', { ...DEF, name: 'A' }, DEF)).not.toThrow()
    expect(loadDraft(bad, 'doc:a')).toBeNull()
    expect(listDrafts(bad)).toEqual([])
    expect(() => clearDraft(bad, 'doc:a')).not.toThrow()
  })
})
