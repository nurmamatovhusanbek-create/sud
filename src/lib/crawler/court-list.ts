import 'server-only'
import type { CourtType } from '@/lib/court-case-types'
import { getAllCourts } from '@/lib/court-map'

/**
 * v205 (§5.6): Crawl targets for the docket index.
 *
 * - Civil: the 94 court ids already shipped in court-map.ts (getAllCourts()).
 * - Economic: the {region}.t id pattern — every id below was LIVE-VERIFIED
 *   against jadvalapi.sud.uz/vka/ECONOMIC/{id}/21092026 (future Monday) and
 *   returned real docket rows (11–304 rows per court/day).
 * - Administrative (CONFLICT): the vka court ids for CONFLICT type do not
 *   follow the .t pattern nor reuse the civil ids (probed 2026-09 — all empty).
 *   TODO(owner): source the CONFLICT court ids from the my.sud.uz court
 *   dropdown / jadval2.sud.uz fib pages and fill ADMIN_COURT_IDS. Until then
 *   administrative name-discovery stays offline; administrative-by-TIN keeps
 *   working live as before.
 */

export interface CrawlTarget {
  courtId: string
  courtType: CourtType
  courtName: string
}

/** LIVE-VERIFIED economic court ids (2026-09-21 dockets present). */
const ECONOMIC_COURT_IDS: { id: string; name: string }[] = [
  { id: 'toshkent.t', name: 'Toshkent shahar iqtisodiy sudi' },
  { id: 'andijon.t', name: 'Andijon viloyat iqtisodiy sudi' },
  { id: 'buxoro.t', name: 'Buxoro viloyat iqtisodiy sudi' },
  { id: 'fargona.t', name: 'Fargʻona viloyat iqtisodiy sudi' },
  { id: 'jizzax.t', name: 'Jizzax viloyat iqtisodiy sudi' },
  { id: 'namangan.t', name: 'Namangan viloyat iqtisodiy sudi' },
  { id: 'navoiy.t', name: 'Navoiy viloyat iqtisodiy sudi' },
  { id: 'nukus.t', name: 'Qoraqalpogʻiston Respublikasi iqtisodiy sudi' },
  { id: 'qarshi.t', name: 'Qashqadaryo viloyat iqtisodiy sudi' },
  { id: 'guliston.t', name: 'Sirdaryo viloyat iqtisodiy sudi' },
  { id: 'termiz.t', name: 'Surxondaryo viloyat iqtisodiy sudi' },
  { id: 'urganch.t', name: 'Xorazm viloyat iqtisodiy sudi' },
  // Verified-empty candidates kept for reference; re-check periodically:
  // samarqand.t / toshkent.v returned 0 rows on several weekdays (2026-09) —
  // their real ids still need confirmation from the my.sud.uz dropdown.
]

/** TODO(owner): populate CONFLICT court ids (see class doc). */
const ADMIN_COURT_IDS: { id: string; name: string }[] = []

export function getCrawlTargets(): CrawlTarget[] {
  const targets: CrawlTarget[] = []
  for (const c of getAllCourts()) {
    targets.push({ courtId: c.id, courtType: 'civil', courtName: c.name })
  }
  for (const c of ECONOMIC_COURT_IDS) {
    targets.push({ courtId: c.id, courtType: 'economic', courtName: c.name })
  }
  for (const c of ADMIN_COURT_IDS) {
    targets.push({ courtId: c.id, courtType: 'administrative', courtName: c.name })
  }
  return targets
}
