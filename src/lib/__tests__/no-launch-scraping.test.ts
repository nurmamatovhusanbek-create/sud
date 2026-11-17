import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * AGENTS.md: «nothing starts by itself — loading, refreshing or switching pages never scrapes». The launcher and
 * Kuzatuv once fetched every company's status / stats / hearings on load, which made the app slow to open. These
 * two views must only read the registry cache; fetching starts from a click.
 */
const read = (rel: string) => readFileSync(join(import.meta.dir, '..', '..', rel), 'utf8')

describe('no scraping on load', () => {
  test('Kuzatuv does not enrich companies from an effect', () => {
    const src = read('components/views/watchlist.tsx')
    expect(src).not.toMatch(/setTimeout\(\s*\(\)\s*=>\s*void enrichCompany/)
    expect(src).toContain('refreshAll') // the click-started refresh exists
  })

  test('the launcher does not look up company status in the background', () => {
    const src = read('components/views/launcher.tsx')
    expect(src).not.toContain('getCompanyInfo')
    expect(src).not.toContain('statusTried')
  })
})
