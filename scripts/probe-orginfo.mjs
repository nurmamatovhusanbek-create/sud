#!/usr/bin/env node
/**
 * Why does the company profile come up empty? Fetches ONE orginfo.uz search page three ways and prints the status:
 *   1. through your first worker (what the app tries first)
 *   2. directly from this machine with browser headers (the app's fallback)
 *   3. through the worker again — compare with 1 after you redeploy cloudflare-worker/proxy.js
 *
 *   node scripts/probe-orginfo.mjs 200248856
 */
import { readFileSync } from 'node:fs'

const tin = process.argv[2] || '200248856'
const target = `https://orginfo.uz/uz/search/all/?q=${tin}`
let worker = process.env.CF_WORKER_URL || ''
try {
  worker ||= JSON.parse(readFileSync(new URL('../workers.json', import.meta.url), 'utf8')).workers?.[0]?.url || ''
} catch { /* no workers.json */ }
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
}
async function probe(label, url) {
  const t0 = Date.now()
  try {
    const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) })
    const body = await r.text()
    console.log(`${label.padEnd(10)} HTTP ${r.status}  ${body.length} bytes  ${Date.now() - t0} ms  organization links: ${(body.match(/\/uz\/organization\/[a-f0-9]+\//g) || []).length}`)
    if (!r.ok) console.log('           ' + body.slice(0, 160).replace(/\s+/g, ' '))
  } catch (e) {
    console.log(`${label.padEnd(10)} FAILED ${e.message}`)
  }
}
console.log('target:', target, '\nworker:', worker || '(none)')
if (worker) await probe('worker', worker + target)
await probe('direct', target)
