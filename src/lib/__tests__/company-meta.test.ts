/**
 * The two dates per company (lib/company-meta): first scrape (set once), last complete load («as of»), and the fallback for data stored before they existed.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'company-'))
process.env.SUD_DB = path.join(DIR, 'sud.db')
const dbm = await import('../db')
const co = await import('../company-meta')
const admin = await import('../db-admin')

const TIN = '207324986'

beforeEach(() => {
  dbm.closeDb()
  for (const n of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, n), { force: true })
})
afterAll(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('company dates', () => {
  test('nothing is known about a company never scraped', () => {
    expect(co.readCompany(TIN)).toBeNull()
  })
  test('the first date is set once; marking a refresh moves only «refreshed» and «added»', () => {
    co.ensureCompany(TIN, 100)
    co.ensureCompany(TIN, 500)
    expect(co.readCompany(TIN)).toEqual({ tin: TIN, firstAt: 100, refreshedAt: 0, lastAdded: 0 })
    co.markRefreshed(TIN, 300, 42)
    expect(co.readCompany(TIN)).toEqual({ tin: TIN, firstAt: 100, refreshedAt: 300, lastAdded: 42 })
    co.markRefreshed(TIN, 900, -5)
    expect(co.readCompany(TIN)).toMatchObject({ firstAt: 100, refreshedAt: 900, lastAdded: 0 })
  })
  test('data stored before the dates existed takes them from its bills load', () => {
    const db = dbm.getDb()
    db.prepare('INSERT INTO bill_loads (tin, complete, loaded_at) VALUES (?, 1, ?)').run(TIN, 777)
    expect(co.readCompany(TIN)).toEqual({ tin: TIN, firstAt: 777, refreshedAt: 777, lastAdded: 0 })
    db.prepare('UPDATE bill_loads SET complete = 0').run()
    expect(co.readCompany(TIN)).toMatchObject({ firstAt: 777, refreshedAt: 0 })
  })
  test('forgetting a company forgets its dates too', () => {
    co.ensureCompany(TIN, 100)
    admin.forgetCompany(TIN)
    expect(co.readCompany(TIN)).toBeNull()
  })
})
