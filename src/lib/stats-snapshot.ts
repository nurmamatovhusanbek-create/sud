/**
 * The stats route's snapshot policy, apart from the route so it can be tested with a fake scrape.
 *
 * A stats answer is worth keeping for a day only when it is COMPLETE: every court answered and the company was found
 * (otherwise its name is the «STIR …» placeholder). A forced, complete scrape also retires what was kept beside it from
 * an older day (court lists, company info, bills): the scrape just refilled the first two in the server's memory, so
 * the next open re-reads them from there; bills have no memory and scrape on their next open. An incomplete scrape
 * drops nothing and stores nothing: the old snapshots stay exactly as they were.
 */

import type { CompanyStats } from './stats'
import { dropSnapshot, viaSnapshot, type Served } from './snapshot-store'

export const statsComplete = (d: CompanyStats): boolean => d.errors.length === 0 && !d.company.name.startsWith('STIR ')

const DEPENDENT_PARTS = ['court:', 'info', 'bills'] as const

export function servedStats(tin: string, force: boolean, scrape: () => Promise<CompanyStats>): Promise<Served<CompanyStats>> {
  return viaSnapshot<CompanyStats>(tin, 'stats', { force, storable: statsComplete }, async () => {
    const d = await scrape()
    if (force && statsComplete(d)) for (const part of DEPENDENT_PARTS) dropSnapshot(tin, part)
    return d
  })
}
