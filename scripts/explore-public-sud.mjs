#!/usr/bin/env node
/**
 * Read-only probe of the public court-order library (public.sud.uz).
 *
 * The site is an Angular app talking to an ANONYMOUS JSON API (no token, no cookies):
 *   GET https://adolatapi1.sud.uz/publications/list?size=&page=&court_type=[&case_number=&is_movable_property=]
 *   GET https://adolatapi1.sud.uz/publications/categories?claim_type=
 *   GET https://adolatapi1.sud.uz/publications/document_types
 *   GET https://adolatapi1.sud.uz/publications/courts?claim_type=
 *   GET https://adolatapi1.sud.uz/public/onStream/<uuid>
 * (that list comes from a browser capture; nothing here writes, posts or logs in.)
 *
 * It only sends the same GETs the site's own page sends, one at a time, a few items each, with a
 * pause between calls. It saves every response under ./sud-explore/ and prints the SHAPES
 * (keys, types, one example) so the scraper can be designed without guessing.
 *
 *   node scripts/explore-public-sud.mjs            # Node 18+
 *   node scripts/explore-public-sud.mjs --deep     # also pages 0..2 and 3 order bodies
 *
 * Then send back the whole sud-explore/ folder (zipped) or just the printed report
 * (sud-explore/REPORT.md). It contains public court data only — no credentials are involved.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const API = process.env.SUD_API || 'https://adolatapi1.sud.uz'
const SITE = process.env.SUD_SITE || 'https://public.sud.uz'
const OUT = 'sud-explore'
const DEEP = process.argv.includes('--deep')
const PAUSE_MS = 400
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = []
const say = (line = '') => {
  console.log(line)
  report.push(line)
}

/** One line per key: type + a short example. Arrays show the first element's shape. */
export function shapeOf(v, depth = 0, maxDepth = 4) {
  const pad = '  '.repeat(depth)
  if (v === null) return 'null'
  if (Array.isArray(v)) {
    if (!v.length) return 'array(0)'
    if (depth >= maxDepth) return `array(${v.length})`
    return `array(${v.length}) of\n${pad}  ${shapeOf(v[0], depth + 1, maxDepth).replace(/\n/g, '\n')}`
  }
  if (typeof v === 'object') {
    if (depth >= maxDepth) return 'object'
    const keys = Object.keys(v)
    return (
      '{\n' +
      keys
        .map((k) => `${pad}  ${k}: ${shapeOf(v[k], depth + 1, maxDepth)}`)
        .join('\n') +
      `\n${pad}}`
    )
  }
  if (typeof v === 'string') return `string ${JSON.stringify(v.length > 70 ? v.slice(0, 70) + '…' : v)}`
  return `${typeof v} ${String(v)}`
}

/** Pull every distinct query-parameter-looking token out of the site's JS near the API paths. */
export function findParams(js) {
  const out = new Set()
  for (const m of js.matchAll(/publications\/[a-z_/]+/g)) out.add('path:' + m[0])
  for (const m of js.matchAll(/\/public\/[A-Za-z_/]+/g)) out.add('path:' + m[0])
  // snake_case tokens inside quotes are almost always API params in this codebase
  for (const m of js.matchAll(/["'`]([a-z]{2,}(?:_[a-z0-9]{1,}){1,4})["'`]/g)) out.add('param:' + m[1])
  // minified object literals use bare keys: {court_type:t,case_number:n}
  for (const m of js.matchAll(/[{,]([a-z]{2,}(?:_[a-z0-9]{1,}){1,4}):/g)) out.add('param:' + m[1])
  return [...out].sort()
}

async function get(path, { save, label, accept = 'application/json, text/plain, */*', base = API } = {}) {
  const url = path.startsWith('http') ? path : base + path
  const t0 = Date.now()
  let res
  try {
    res = await fetch(url, {
      headers: { Accept: accept, Origin: SITE, Referer: SITE + '/', 'User-Agent': UA },
    })
  } catch (e) {
    say(`  ✗ ${label || url} — network error: ${e.message}`)
    return null
  }
  const ct = res.headers.get('content-type') || ''
  const buf = Buffer.from(await res.arrayBuffer())
  say(`  ${res.ok ? '✓' : '✗'} ${res.status} ${label || url}  [${ct.split(';')[0] || '?'}, ${buf.length} B, ${Date.now() - t0} ms]`)
  if (save) await writeFile(join(OUT, save), buf)
  await sleep(PAUSE_MS)
  if (!res.ok) return { status: res.status, ct, text: buf.toString('utf8').slice(0, 400) }
  let json = null
  if (/json/i.test(ct) || /^[\s]*[[{]/.test(buf.toString('utf8', 0, 20))) {
    try {
      json = JSON.parse(buf.toString('utf8'))
    } catch {
      /* not JSON */
    }
  }
  return { status: res.status, ct, buf, json, text: json ? null : buf.toString('utf8', 0, 600) }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  say(`# public.sud.uz probe — ${new Date().toISOString()}`)
  say(`API ${API} · site ${SITE} · deep=${DEEP}`)

  // 1. dictionaries
  say('\n## Dictionaries')
  const claimTypes = ['ECONOMIC', 'CIVIL', 'ADMINISTRATIVE', 'CRIMINAL']
  for (const ct of claimTypes) {
    for (const ep of ['categories', 'courts']) {
      const r = await get(`/publications/${ep}?claim_type=${ct}`, { save: `${ep}-${ct}.json`, label: `${ep} ${ct}` })
      if (r?.json) {
        const arr = Array.isArray(r.json) ? r.json : r.json.content || r.json.data || []
        say(`    ${Array.isArray(arr) ? arr.length : '?'} rows · shape: ${shapeOf(Array.isArray(arr) ? arr.slice(0, 1) : r.json, 0, 2).replace(/\n\s*/g, ' ')}`)
      } else if (r) say(`    ${r.text?.replace(/\s+/g, ' ')}`)
    }
  }
  const dt = await get('/publications/document_types', { save: 'document_types.json', label: 'document_types' })
  if (dt?.json) say(`    ${shapeOf(dt.json, 0, 2).replace(/\n\s*/g, ' ').slice(0, 600)}`)

  // 2. list, page 0 (and more when --deep)
  say('\n## List')
  const pages = DEEP ? [0, 1, 2] : [0]
  let first = null
  let firstAll = []
  for (const p of pages) {
    const r = await get(`/publications/list?size=${DEEP ? 30 : 5}&page=${p}&court_type=ECONOMIC`, {
      save: `list-ECONOMIC-p${p}.json`,
      label: `list ECONOMIC page ${p}`,
    })
    if (!r?.json) continue
    if (p === 0) {
      say('  --- response shape ---')
      say(shapeOf(r.json, 0, 4).split('\n').map((l) => '  ' + l).join('\n'))
    }
    const rows = Array.isArray(r.json) ? r.json : r.json.content || r.json.data || r.json.items || []
    firstAll = firstAll.concat(rows)
    if (p === 0) first = rows[0] || null
  }
  say(`  rows collected: ${firstAll.length}`)

  // 3. filters: same query the site sent (case number + movable property flag), using a real number
  if (first) {
    const cn = first.case_number || first.caseNumber || first.number
    if (cn) {
      say('\n## Filters')
      await get(`/publications/list?size=5&page=0&court_type=ECONOMIC&case_number=${encodeURIComponent(cn)}`, {
        save: 'list-by-case-number.json',
        label: `list by case_number=${cn}`,
      })
      await get(`/publications/list?size=5&page=0&court_type=ECONOMIC&is_movable_property=true`, {
        save: 'list-movable.json',
        label: 'list is_movable_property=true',
      })
    }
  }

  // 4. order bodies. The site calls /public/onStream/<uuid>; find the uuid-looking field on each row.
  say('\n## Order bodies')
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const idsOf = (row) =>
    Object.entries(row || {})
      .filter(([, v]) => typeof v === 'string' && uuidRe.test(v))
      .map(([k, v]) => ({ k, v }))
  const targets = firstAll.slice(0, DEEP ? 3 : 1)
  if (!targets.length) say('  (no rows to open)')
  for (const [i, row] of targets.entries()) {
    const ids = idsOf(row)
    say(`  row ${i}: uuid-like fields → ${ids.map((x) => x.k).join(', ') || 'none'}`)
    for (const { k, v } of ids.slice(0, 3)) {
      const r = await get(`/public/onStream/${v}`, { save: `onStream-${i}-${k}.bin`, label: `onStream via ${k}` })
      if (r?.json) say('    JSON shape:\n' + shapeOf(r.json, 0, 3).split('\n').map((l) => '    ' + l).join('\n'))
      else if (r?.text) say(`    starts with: ${JSON.stringify(r.text.slice(0, 200))}`)
    }
  }

  // 5. the site's own JS: which query params does the list accept?
  say('\n## Site bundle: API paths and parameter-looking tokens')
  const home = await get(`${SITE}/report/ECONOMIC_NEW`, { label: 'site html', accept: 'text/html' })
  if (home?.buf) {
    const html = home.buf.toString('utf8')
    const srcs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]).filter((s) => /main|common|\d+\./.test(s))
    const found = new Set()
    for (const s of srcs.slice(0, 40)) {
      const r = await get(new URL(s, SITE + '/').href, { label: s, accept: '*/*' })
      const js = r?.buf?.toString('utf8') || ''
      if (js.includes('publications/list') || js.includes('adolatapi')) {
        await writeFile(join(OUT, 'bundle-' + s.replace(/[^a-z0-9.]/gi, '_')), js)
        for (const p of findParams(js)) found.add(p)
      }
    }
    const list = [...found]
    say(`  API paths:\n    ${list.filter((x) => x.startsWith('path:')).map((x) => x.slice(5)).join('\n    ') || '(none found)'}`)
    say(`  parameter-looking tokens (${list.filter((x) => x.startsWith('param:')).length}):`)
    say('    ' + list.filter((x) => x.startsWith('param:')).map((x) => x.slice(6)).join(', '))
  }

  await writeFile(join(OUT, 'REPORT.md'), report.join('\n'))
  say(`\nDone. Everything is in ./${OUT}/ — zip that folder (or paste REPORT.md) and send it back.`)
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('explore-public-sud.mjs')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
