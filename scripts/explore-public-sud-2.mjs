#!/usr/bin/env node
/**
 * Probe #2 for the public court-order library (public.sud.uz) — read-only.
 *
 * Probe #1 (explore-public-sud.mjs) showed: the list rows carry a `result` enum, an `instance`,
 * judges, court, categories and a `pdf: { id, … }` — but NO party names and NO STIR, and opening
 * `/public/onStream/<row id>` returned 0 bytes (the row id is the publication, not the file).
 * The site's list component lives in lazy JS chunks probe #1 never downloaded, so the accepted
 * query parameters are still unknown. This probe answers, with the same polite GETs the site sends:
 *
 *   1. which query parameters does the list accept?  (read out of the site's lazy chunks)
 *   2. does `/public/onStream/<pdf.id>` give the PDF?  (saved, magic bytes checked)
 *   3. how big is each court type's library, and what page size does the API allow?
 *   4. how slow is the case-number search (it took 75 s once), and is a repeat faster?
 *
 *   bun scripts/explore-public-sud-2.mjs 2>&1 | tee sud-explore2-console.txt        # or: node …
 *
 * Output goes to ./sud-explore2/ (REPORT.md + raw files). Public data only, no credentials.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const API = process.env.SUD_API || 'https://adolatapi1.sud.uz'
const SITE = process.env.SUD_SITE || 'https://public.sud.uz'
const OUT = 'sud-explore2'
const PAUSE_MS = 250
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = []
const say = (l = '') => {
  console.log(l)
  report.push(l)
}

/** webpack runtime: `{2006:"d6ce91d658b1bb12822f",…}` → ["2006.d6ce91d658b1bb12822f.js", …] */
export function chunkFiles(runtimeJs) {
  const out = new Set()
  for (const m of runtimeJs.matchAll(/["']?([A-Za-z0-9_-]+)["']?:\s*"([0-9a-f]{16,24})"/g)) out.add(`${m[1]}.${m[2]}.js`)
  return [...out]
}

/** What in a chunk tells us about the list API: paths, and parameter names near them. */
export function apiHints(js) {
  const paths = new Set()
  for (const m of js.matchAll(/["'`](\/?(?:api\/)?(?:publications|public|publication)\/[A-Za-z0-9_\-/{}$.]*)["'`]/g)) paths.add(m[1])
  const params = new Set()
  // windows of code around "publications/list" or "onStream" — parameters are named right there
  for (const key of ['publications/list', 'publications/', 'onStream']) {
    let from = 0
    for (;;) {
      const i = js.indexOf(key, from)
      if (i < 0) break
      const win = js.slice(Math.max(0, i - 1500), i + 1500)
      for (const m of win.matchAll(/[{,]\s*["']?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)["']?\s*:/g)) params.add(m[1])
      for (const m of win.matchAll(/["'`]([a-z][a-z0-9]*(?:_[a-z0-9]+)+)["'`]/g)) params.add(m[1])
      from = i + key.length
    }
  }
  return { paths: [...paths].sort(), params: [...params].sort(), hasKey: /publications\/list|onStream/.test(js) }
}

async function get(url, { save, label, accept = 'application/json, text/plain, */*', timeout = 120000 } = {}) {
  const full = url.startsWith('http') ? url : API + url
  const t0 = Date.now()
  let res
  try {
    res = await fetch(full, {
      headers: { Accept: accept, Origin: SITE, Referer: SITE + '/', 'User-Agent': UA },
      signal: AbortSignal.timeout(timeout),
    })
  } catch (e) {
    say(`  ✗ ${label || full} — ${e.message}`)
    return null
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const ct = (res.headers.get('content-type') || '').split(';')[0] || '?'
  const ms = Date.now() - t0
  say(`  ${res.ok ? '✓' : '✗'} ${res.status} ${label || full}  [${ct}, ${buf.length} B, ${ms} ms]`)
  if (save) await writeFile(join(OUT, save), buf)
  await sleep(PAUSE_MS)
  let json = null
  try {
    if (buf.length && /json/.test(ct)) json = JSON.parse(buf.toString('utf8'))
  } catch {
    /* not JSON */
  }
  return { ok: res.ok, status: res.status, ct, buf, ms, json, headers: Object.fromEntries(res.headers) }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  say(`# public.sud.uz probe #2 — ${new Date().toISOString()}`)

  // 1. lazy chunks → list API parameters
  say('\n## 1. Parameters the list accepts (from the site\'s own JS)')
  const home = await get(`${SITE}/report/ECONOMIC_NEW`, { label: 'site html', accept: 'text/html' })
  const html = home?.buf?.toString('utf8') || ''
  const runtimeSrc = (html.match(/src="([^"]*runtime[^"]*\.js)"/) || [])[1]
  const chunks = new Set()
  for (const m of html.matchAll(/src="([^"]+\.js)"/g)) chunks.add(m[1])
  if (runtimeSrc) {
    const rt = await get(new URL(runtimeSrc, SITE + '/').href, { label: runtimeSrc, accept: '*/*' })
    for (const f of chunkFiles(rt?.buf?.toString('utf8') || '')) chunks.add(f)
  }
  say(`  ${chunks.size} scripts to inspect`)
  const paths = new Set()
  const params = new Set()
  const hits = []
  let n = 0
  for (const c of chunks) {
    const r = await get(new URL(c, SITE + '/').href, { label: c, accept: '*/*' })
    n++
    if (!r?.ok) continue
    const js = r.buf.toString('utf8')
    const h = apiHints(js)
    if (h.hasKey) {
      hits.push(c)
      await writeFile(join(OUT, 'chunk-' + c.replace(/[^a-z0-9.]/gi, '_')), js)
      h.paths.forEach((p) => paths.add(p))
      h.params.forEach((p) => params.add(p))
    }
  }
  say(`  inspected ${n} scripts; ${hits.length} mention the list/onStream API: ${hits.join(', ')}`)
  say('  API paths:\n    ' + ([...paths].join('\n    ') || '(none)'))
  say('  parameter-looking names near those calls:\n    ' + ([...params].join(', ') || '(none)'))

  // 2. the PDF
  say('\n## 2. The order file')
  const first = await get('/publications/list?size=3&page=0&court_type=ECONOMIC', { save: 'list-first.json', label: 'list (3 rows)' })
  const rows = first?.json?.content || []
  for (const [i, row] of rows.slice(0, 3).entries()) {
    const fid = row.pdf?.id
    if (!fid) continue
    const r = await get(`/public/onStream/${fid}`, { save: `order-${i}.pdf`, label: `onStream(pdf.id) for ${row.case_number}`, accept: '*/*' })
    if (r?.buf?.length) {
      const magic = r.buf.subarray(0, 5).toString('latin1')
      say(`    starts with ${JSON.stringify(magic)} ${magic.startsWith('%PDF') ? '→ it IS a PDF' : '→ not a PDF'}; headers: ${JSON.stringify({ 'content-type': r.headers['content-type'], 'content-disposition': r.headers['content-disposition'], 'cache-control': r.headers['cache-control'] })}`)
    }
  }

  // 3. sizes + page-size ceiling
  say('\n## 3. Library size per court type, and the page-size limit')
  for (const ct of ['ECONOMIC', 'CIVIL', 'ADMINISTRATIVE', 'CRIMINAL']) {
    const r = await get(`/publications/list?size=1&page=0&court_type=${ct}`, { label: `count ${ct}` })
    if (r?.json) say(`    ${ct}: totalElements=${r.json.totalElements}, totalPages@1=${r.json.totalPages}; row keys: ${Object.keys(r.json.content?.[0] || {}).join(', ')}`)
  }
  for (const size of [50, 100, 500]) {
    const r = await get(`/publications/list?size=${size}&page=0&court_type=ECONOMIC`, { label: `page size ${size}` })
    if (r?.json) say(`    size=${size} → returned ${r.json.content?.length} rows (limit field: ${r.json.limit})`)
  }

  // 4. case-number search timing (two different real numbers, then a repeat of the first)
  say('\n## 4. Case-number search timing')
  const nums = rows.map((r) => r.case_number).filter(Boolean)
  const seq = [nums[0], nums[1], nums[0]].filter(Boolean)
  for (const cn of seq) {
    const r = await get(`/publications/list?size=30&page=0&court_type=ECONOMIC&case_number=${encodeURIComponent(cn)}`, { label: `case_number=${cn}` })
    if (r?.json) say(`    ${r.json.totalElements} order(s): ${(r.json.content || []).map((x) => `${x.instance}/${x.result}`).join(', ')}  — ${r.ms} ms`)
  }

  await writeFile(join(OUT, 'REPORT.md'), report.join('\n'))
  say(`\nDone. Zip ./${OUT}/ (or paste REPORT.md) and send it back.`)
}

if (process.argv[1]?.endsWith('explore-public-sud-2.mjs')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
