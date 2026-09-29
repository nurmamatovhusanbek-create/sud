#!/usr/bin/env node
/**
 * Probe #3 — is there a FAST way to find the orders of one case? (read-only)
 *
 * Findings so far (probes #1–#2): the list is `GET /publications/list` with the filters the site's own
 * form sends — case_number, category_id, court_id, startDate, endDate (YYYY-MM-DD), document_type_id,
 * instance (FIRST|APPEAL|CASSATION|CASSATION_REPEATED), judge_id, is_movable_property — plus court_type,
 * size (max 100) and page. A bare case_number search takes 75–112 s (a full scan), which is useless
 * inside the app. This probe times the same search when it is NARROWED by other filters, to find
 * which combination makes it fast. Every request is the kind the site's form sends; sequential,
 * each capped at 60 s, so the whole run is at most ~10 minutes and usually far less.
 *
 *   bun scripts/explore-public-sud-3.mjs 2>&1 | tee sud-explore3-console.txt
 *
 * Output: ./sud-explore3/REPORT.md. Public data only, no credentials.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const API = process.env.SUD_API || 'https://adolatapi1.sud.uz'
const SITE = process.env.SUD_SITE || 'https://public.sud.uz'
const OUT = 'sud-explore3'
const CAP_MS = 60000
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = []
const say = (l = '') => {
  console.log(l)
  report.push(l)
}

async function get(path, label) {
  const t0 = Date.now()
  try {
    const res = await fetch(API + path, {
      headers: { Accept: 'application/json, text/plain, */*', Origin: SITE, Referer: SITE + '/', 'User-Agent': UA },
      signal: AbortSignal.timeout(CAP_MS),
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* not JSON */
    }
    const ms = Date.now() - t0
    say(`  ${res.ok ? '✓' : '✗'} ${res.status} ${String(ms).padStart(6)} ms  ${label}${json?.totalElements !== undefined ? `  → ${json.totalElements} hit(s)` : ''}`)
    await sleep(300)
    return { ok: res.ok, ms, json }
  } catch (e) {
    const ms = Date.now() - t0
    say(`  ✗ ${e.name === 'TimeoutError' ? 'TIMEOUT' : e.message} after ${ms} ms  ${label}`)
    await sleep(300)
    return { ok: false, ms, json: null }
  }
}

const q = (o) =>
  Object.entries(o)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')

async function main() {
  await mkdir(OUT, { recursive: true })
  say(`# public.sud.uz probe #3 — ${new Date().toISOString()}`)

  say('\n## Setup: a real case, its court id and judge')
  const base = await get('/publications/list?' + q({ size: 5, page: 0, court_type: 'ECONOMIC' }), 'list (5 rows)')
  const rows = base.json?.content || []
  const row = rows.find((r) => r.case_number) || null
  if (!row) return say('no rows — stop')
  const courts = (await get('/publications/courts?claim_type=ECONOMIC', 'courts')).json || []
  const name = (row.court_names?.uz_cyr || row.court_names?.uz || '').trim()
  const court = courts.find((c) => (c.names?.uz_cyr || c.names?.uz || '').trim() === name) || null
  say(`  case ${row.case_number} · court "${name}" → id ${court?.id ?? '(not matched)'} · instance ${row.instance} · result ${row.result}`)
  const yy = '20' + (row.case_number.match(/-(\d{2})\d{2}\//)?.[1] || '26')
  const cn = row.case_number
  const seq = cn.split('/')[1]

  say('\n## Narrowing the case-number search (each capped at 60 s)')
  const base0 = { size: 30, page: 0, court_type: 'ECONOMIC' }
  const tests = [
    ['case_number + court_id', { ...base0, case_number: cn, ...(court ? { court_id: court.id } : {}) }, !!court],
    ['case_number + startDate/endDate (whole year)', { ...base0, case_number: cn, startDate: `${yy}-01-01`, endDate: `${yy}-12-31` }, true],
    ['case_number + court_id + year', { ...base0, case_number: cn, ...(court ? { court_id: court.id } : {}), startDate: `${yy}-01-01`, endDate: `${yy}-12-31` }, !!court],
    ['case_number + instance', { ...base0, case_number: cn, instance: row.instance }, true],
    ['case_number, size=1', { size: 1, page: 0, court_type: 'ECONOMIC', case_number: cn }, true],
    ['sequence only (%s) + court_id'.replace('%s', seq), { ...base0, case_number: seq, ...(court ? { court_id: court.id } : {}) }, !!court],
  ]
  const results = []
  for (const [label, params, ok] of tests) {
    if (!ok) {
      say(`  – skipped ${label} (no court id)`)
      continue
    }
    const r = await get('/publications/list?' + q(params), label)
    results.push({ label, ms: r.ms, ok: r.ok, hits: r.json?.totalElements ?? null })
  }

  say('\n## Date-window only (no case number): how fast is a narrow window?')
  const dates = [`${yy}-06-01`, `${yy}-06-02`]
  await get('/publications/list?' + q({ ...base0, startDate: dates[0], endDate: dates[1] }), `list ${dates[0]}..${dates[1]}`)
  if (court) await get('/publications/list?' + q({ ...base0, court_id: court.id }), 'list by court_id only')

  say('\n## Judges and the other count endpoints (cheap dictionaries)')
  if (court) await get(`/publications/judges/${court.id}`, 'judges of that court')
  await get('/publications/count_by_years', 'count_by_years')
  await get('/publications/count_by_court_type?court_type=ECONOMIC', 'count_by_court_type')
  await get('/publications/count_by_instance', 'count_by_instance')

  const fast = results.filter((r) => r.ok && r.ms < 5000)
  say(`\n## Verdict\n  ${fast.length ? 'FAST paths (<5 s): ' + fast.map((f) => `${f.label} (${f.ms} ms)`).join('; ') : 'no narrowed search finished under 5 s'}`)
  await writeFile(join(OUT, 'REPORT.md'), report.join('\n'))
  say(`\nDone. Send ./${OUT}/REPORT.md (or the console text).`)
}

if (process.argv[1]?.endsWith('explore-public-sud-3.mjs')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
