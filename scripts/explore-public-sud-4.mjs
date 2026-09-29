#!/usr/bin/env node
/**
 * Probe #4 — could we build a LOCAL INDEX of the public orders instead of searching a slow API? (read-only)
 *
 * Probe #3 showed: a bare case-number search is a slow scan (35–113 s), but a plain DATE WINDOW is
 * indexed and fast (2 days, 1,734 hits, 0.14 s). If that holds at size=100 and across pages, a one-time
 * backfill by date window plus a small daily top-up gives an instant local lookup by case number.
 * This probe checks the four things that decide it (same GETs the site's form sends, sequential unless
 * stated, each capped at 60 s, a short pause between calls):
 *
 *   1. what date do startDate/endDate filter on?  (a known order: case 4-1001-2619/21743, APPEAL, decided 12 May 2026)
 *   2. is  court_id + one day  fast, and does adding case_number to it stay fast?
 *   3. crawl rate: 10 consecutive pages of size 100 in a 2-day window (rows/s), then 3 pages in parallel
 *   4. does deep paging stay fast? (page 50 of a 2-day window)
 *
 *   bun scripts/explore-public-sud-4.mjs 2>&1 | tee sud-explore4-console.txt
 *
 * Output: ./sud-explore4/REPORT.md. Public data only, no credentials.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const API = process.env.SUD_API || 'https://adolatapi1.sud.uz'
const SITE = process.env.SUD_SITE || 'https://public.sud.uz'
const OUT = 'sud-explore4'
const CAP_MS = 60000
const PAUSE_MS = 300
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const KNOWN = { case: '4-1001-2619/21743', day: '2026-05-12', court: 'Тошкент туманлараро иқтисодий суди' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = []
const say = (l = '') => {
  console.log(l)
  report.push(l)
}
const q = (o) =>
  Object.entries(o)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')

async function get(path, label, { pause = true } = {}) {
  const t0 = Date.now()
  try {
    const res = await fetch(API + path, {
      headers: { Accept: 'application/json, text/plain, */*', Origin: SITE, Referer: SITE + '/', 'User-Agent': UA },
      signal: AbortSignal.timeout(CAP_MS),
    })
    const json = await res.json().catch(() => null)
    const ms = Date.now() - t0
    const n = json?.content?.length
    say(`  ${res.ok ? '✓' : '✗'} ${res.status} ${String(ms).padStart(6)} ms  ${label}  → rows ${n ?? '?'}, total ${json?.totalElements ?? 'null'}`)
    if (pause) await sleep(PAUSE_MS)
    return { ok: res.ok, ms, json }
  } catch (e) {
    const ms = Date.now() - t0
    say(`  ✗ ${e.name === 'TimeoutError' ? 'TIMEOUT' : e.message} after ${ms} ms  ${label}`)
    if (pause) await sleep(PAUSE_MS)
    return { ok: false, ms, json: null }
  }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  say(`# public.sud.uz probe #4 — ${new Date().toISOString()}`)
  const base = { court_type: 'ECONOMIC', size: 100, page: 0 }

  say('\n## 0. Court id of the known case')
  const courts = (await get('/publications/courts?claim_type=ECONOMIC', 'courts')).json || []
  const court = courts.find((c) => (c.names?.uz_cyr || c.names?.uz || '').trim() === KNOWN.court)
  say(`  ${KNOWN.court} → ${court?.id ?? 'NOT FOUND'}`)

  say('\n## 1. What do startDate / endDate filter on?  (known order: decided ' + KNOWN.day + ')')
  const day = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
  const found = []
  for (const [label, s, e] of [
    ['exactly the decision day', KNOWN.day, KNOWN.day],
    ['day before only', day(KNOWN.day, -1), day(KNOWN.day, -1)],
    ['day after only', day(KNOWN.day, 1), day(KNOWN.day, 1)],
    ['a week later (publication lag?)', day(KNOWN.day, 1), day(KNOWN.day, 7)],
  ]) {
    const r = await get('/publications/list?' + q({ ...base, ...(court ? { court_id: court.id } : {}), startDate: s, endDate: e }), `court + ${label} (${s}..${e})`)
    const hit = (r.json?.content || []).some((x) => x.case_number === KNOWN.case)
    found.push([label, hit, r.json?.totalElements ?? null])
    say(`      contains ${KNOWN.case}? ${hit ? 'YES' : 'no'}`)
  }

  say('\n## 2. court + day, then + case_number')
  const win = { startDate: KNOWN.day, endDate: KNOWN.day }
  await get('/publications/list?' + q({ ...base, ...(court ? { court_id: court.id } : {}), ...win }), 'court + day, size 100')
  await get('/publications/list?' + q({ ...base, ...(court ? { court_id: court.id } : {}), ...win, case_number: KNOWN.case }), 'court + day + case_number')
  await get('/publications/list?' + q({ ...base, ...win, case_number: KNOWN.case }), 'day + case_number (no court)')

  say('\n## 3. Crawl rate: 10 consecutive pages of a 2-day window, size 100')
  const w2 = { startDate: '2026-06-01', endDate: '2026-06-02' }
  let rows = 0
  const t0 = Date.now()
  for (let p = 0; p < 10; p++) {
    const r = await get('/publications/list?' + q({ ...base, ...w2, page: p }), `2-day window page ${p}`, { pause: false })
    rows += r.json?.content?.length || 0
    if (p === 0 && r.json?.totalElements) say(`      window total ${r.json.totalElements} rows`)
    await sleep(PAUSE_MS)
    if (!r.ok || !(r.json?.content?.length)) break
  }
  const sec = (Date.now() - t0) / 1000
  say(`  → ${rows} rows in ${sec.toFixed(1)} s = ${(rows / Math.max(sec, 0.1)).toFixed(0)} rows/s incl. pauses`)

  say('\n## 3b. Three pages in parallel (is concurrency 3 tolerated?)')
  const tp = Date.now()
  const par = await Promise.all([10, 11, 12].map((p) => get('/publications/list?' + q({ ...base, ...w2, page: p }), `parallel page ${p}`, { pause: false })))
  say(`  → wall time ${Date.now() - tp} ms for ${par.reduce((a, r) => a + (r.json?.content?.length || 0), 0)} rows`)

  say('\n## 4. Deep paging')
  await get('/publications/list?' + q({ ...base, ...w2, page: 50 }), '2-day window page 50')

  await writeFile(join(OUT, 'REPORT.md'), report.join('\n'))
  say(`\nDone. Send ./${OUT}/REPORT.md (or the console text).`)
}

if (process.argv[1]?.endsWith('explore-public-sud-4.mjs')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
