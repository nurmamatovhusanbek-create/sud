import { describe, expect, test } from 'bun:test'
import type { StorageLike } from '../drafts'
import { applyProfile, deleteProfile, listProfiles, MAX_PROFILES, profileNs, profileValues, saveProfile, suggestName } from '../profiles'

function fake(): StorageLike {
  const data = new Map<string, string>()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k), get length() { return data.size }, key: (i) => [...data.keys()][i] ?? null }
}
const KEYS = ['company', 'director', 'address']
const NS = profileNs(KEYS)

describe('profiles', () => {
  test('the group is its set of keys, in any order', () => {
    expect(profileNs(['b', 'a'])).toBe(profileNs(['a', 'b']))
    expect(profileNs(['a'])).not.toBe(profileNs(['a', 'b']))
  })
  test('save → list → apply fills the group and nothing else', () => {
    const s = fake()
    saveProfile(s, NS, KEYS, 'Alfa', { company: 'Alfa MCHJ', director: 'Aliyev A.', address: '  Toshkent ', other: 'x' }, 1)
    const [p] = listProfiles(s, NS)
    expect(p.name).toBe('Alfa')
    expect(p.values).toEqual({ company: 'Alfa MCHJ', director: 'Aliyev A.', address: 'Toshkent' })
    expect(applyProfile({ company: '', director: 'old', other: 'keep' }, KEYS, p)).toEqual({ company: 'Alfa MCHJ', director: 'Aliyev A.', other: 'keep', address: 'Toshkent' })
  })
  test('a profile that lacks a key leaves that field alone', () => {
    const s = fake()
    saveProfile(s, NS, KEYS, 'Alfa', { company: 'Alfa' })
    expect(applyProfile({ company: 'x', director: 'keep me' }, KEYS, listProfiles(s, NS)[0])).toEqual({ company: 'Alfa', director: 'keep me' })
  })
  test('the same name replaces (case-insensitive); newest first', () => {
    const s = fake()
    saveProfile(s, NS, KEYS, 'Alfa', { company: 'one' }, 1)
    saveProfile(s, NS, KEYS, 'Beta', { company: 'two' }, 2)
    saveProfile(s, NS, KEYS, 'alfa', { company: 'three' }, 3)
    expect(listProfiles(s, NS).map((p) => [p.name, p.values.company])).toEqual([['alfa', 'three'], ['Beta', 'two']])
  })
  test('nothing to save: empty name or empty values', () => {
    const s = fake()
    expect(saveProfile(s, NS, KEYS, '  ', { company: 'x' })).toBeNull()
    expect(saveProfile(s, NS, KEYS, 'N', { company: ' ' })).toBeNull()
    expect(listProfiles(s, NS)).toEqual([])
  })
  test('groups do not mix', () => {
    const s = fake()
    saveProfile(s, NS, KEYS, 'Alfa', { company: 'x' })
    expect(listProfiles(s, profileNs(['company']))).toEqual([])
  })
  test('delete', () => {
    const s = fake()
    const p = saveProfile(s, NS, KEYS, 'Alfa', { company: 'x' })!
    deleteProfile(s, NS, p.id)
    expect(listProfiles(s, NS)).toEqual([])
  })
  test('capped', () => {
    const s = fake()
    for (let i = 0; i < MAX_PROFILES + 3; i++) saveProfile(s, NS, KEYS, `n${i}`, { company: 'x' }, i + 1)
    expect(listProfiles(s, NS).length).toBe(MAX_PROFILES)
  })
  test('suggested name prefers the company / person, falls back to any filled value', () => {
    expect(suggestName(KEYS, { company: 'Alfa MCHJ', director: 'Aliyev' })).toBe('Alfa MCHJ')
    expect(suggestName(['address', 'phone'], { phone: '+998' })).toBe('+998')
    expect(suggestName(KEYS, {})).toBe('')
  })
  test('damaged storage reads as empty', () => {
    const s = fake()
    s.setItem('sud.doc-profiles.v1', '{nope')
    expect(listProfiles(s, NS)).toEqual([])
    s.setItem('sud.doc-profiles.v1', JSON.stringify({ [NS]: [{ id: 1 }, 'x'] }))
    expect(listProfiles(s, NS)).toEqual([])
  })
  test('profileValues keeps only filled keys of the group', () => {
    expect(profileValues(['a', 'b'], { a: ' x ', b: '', c: 'z' })).toEqual({ a: 'x' })
  })
})
