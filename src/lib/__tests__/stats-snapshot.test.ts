/**
 * The stats snapshot policy. The bug this pins: a forced refresh whose courts all failed came back as a normal
 * (partial) answer and still dropped the company's court / info / bills snapshots, losing good data for nothing.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-stats-snap-'))
process.env.SNAPSHOT_DIR = DIR

const { servedStats, statsComplete } = await import('../stats-snapshot')
const { readSnapshot, writeSnapshot, __resetSnapshotsForTests } = await import('../snapshot-store')
import type { CompanyStats } from '../stats'

const TIN = '302121267'
const stats = (over: Partial<CompanyStats> = {}): CompanyStats => ({
  company: { name: 'PROCAB', tin: TIN },
  cases: [],
  summary: { total: 0, win: 0, lose: 0, neutral: 0, pending: 0, asPlaintiff: 0, asDefendant: 0 },
  errors: [],
  rating: null,
  ...over,
})
const partial = () => stats({ errors: [{ courtType: 'economic', error: 'x' }, { courtType: 'civil', error: 'x' }] })

beforeEach(() => {
  __resetSnapshotsForTests()
  fs.rmSync(DIR, { recursive: true, force: true })
  for (const part of ['stats', 'info', 'bills', 'court:economic', 'court:civil'] as const) writeSnapshot(TIN, part, `old-${part}`, Date.now() - 3 * 3600_000)
})
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }))

const kept = () => (['stats', 'info', 'bills', 'court:economic', 'court:civil'] as const).filter((p) => readSnapshot(TIN, p))

describe('statsComplete', () => {
  test('court errors or the «STIR …» placeholder name make it incomplete', () => {
    expect(statsComplete(stats())).toBe(true)
    expect(statsComplete(partial())).toBe(false)
    expect(statsComplete(stats({ company: { name: `STIR ${TIN}`, tin: TIN } }))).toBe(false)
  })
})

describe('servedStats', () => {
  test('a forced COMPLETE scrape replaces the stats and retires the parts beside it', async () => {
    const r = await servedStats(TIN, true, async () => stats({ summary: { ...stats().summary, total: 7 } }))
    expect(r.fromSnapshot).toBe(false)
    expect((readSnapshot<CompanyStats>(TIN, 'stats')?.data)?.summary.total).toBe(7)
    expect(kept()).toEqual(['stats'])
  })

  test('a forced INCOMPLETE scrape (the sites are down) keeps every old snapshot untouched', async () => {
    const r = await servedStats(TIN, true, async () => partial())
    expect(r.data.errors).toHaveLength(2) // the caller still sees what the sites said
    expect(kept().sort()).toEqual(['bills', 'court:civil', 'court:economic', 'info', 'stats'])
    expect(readSnapshot(TIN, 'stats')?.data).toBe('old-stats')
  })

  test('a forced scrape that throws keeps every old snapshot untouched', async () => {
    await expect(servedStats(TIN, true, async () => { throw new Error('down') })).rejects.toThrow('down')
    expect(kept()).toHaveLength(5)
  })

  test('a plain open inside the day does not scrape and drops nothing', async () => {
    let calls = 0
    const r = await servedStats(TIN, false, async () => { calls++; return stats() })
    expect(r).toMatchObject({ data: 'old-stats', fromSnapshot: true })
    expect(calls).toBe(0)
    expect(kept()).toHaveLength(5)
  })
})
