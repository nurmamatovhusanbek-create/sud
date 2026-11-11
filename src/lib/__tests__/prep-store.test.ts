import { beforeEach, describe, expect, test } from 'bun:test'
import { readPrep, writePrep } from '../prep-store'

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
}

beforeEach(() => mem.clear())

describe('prep-store', () => {
  test('an unseen case is empty, not an error', () => {
    expect(readPrep('1', 'A')).toMatchObject({ ticked: [], documentPrepared: false })
  })
  test('ticks are kept per company and case', () => {
    writePrep('1', 'A', { ticked: ['orders'] })
    writePrep('1', 'B', { ticked: ['counterparty'] })
    writePrep('2', 'A', { documentPrepared: true })
    expect(readPrep('1', 'A').ticked).toEqual(['orders'])
    expect(readPrep('1', 'B').ticked).toEqual(['counterparty'])
    expect(readPrep('2', 'A')).toMatchObject({ ticked: [], documentPrepared: true })
  })
  test('a patch keeps what it does not name', () => {
    writePrep('1', 'A', { ticked: ['orders'] })
    writePrep('1', 'A', { documentPrepared: true })
    expect(readPrep('1', 'A')).toMatchObject({ ticked: ['orders'], documentPrepared: true })
  })
  test('a corrupted store is treated as empty', () => {
    mem.set('sud-prep-v1', '{not json')
    expect(readPrep('1', 'A').ticked).toEqual([])
    mem.set('sud-prep-v1', '[1,2]')
    expect(readPrep('1', 'A').ticked).toEqual([])
  })
  test('the store stays bounded: the least recently touched cases go first', () => {
    for (let i = 0; i < 305; i++) writePrep('1', `C${i}`, { ticked: ['orders'] })
    expect(Object.keys(JSON.parse(mem.get('sud-prep-v1')!)).length).toBeLessThanOrEqual(300)
    expect(readPrep('1', 'C304').ticked).toEqual(['orders'])
  })
})
