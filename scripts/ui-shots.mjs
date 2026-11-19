#!/usr/bin/env node
/**
 * UI screenshots + «did anything move?» (docs/ui-split-plan.md, milestone M0).
 *
 *   bun run ui:shots                      # shoot every screen at 1300 / 960 / 700 px, light + dark, into ui-shots/current
 *   bun run ui:shots -- --accept          # make the current run the accepted one (ui-shots/accepted)
 *   bun run ui:shots -- --only=Kuzatuv    # only screens whose name contains this
 *   bun run ui:shots -- --looks=premium,navy --widths=1300 --themes=light
 *   bun run ui:shots -- --base=http://localhost:3000
 *
 * Needs the app running (bun run dev) and Playwright (not a dependency of the app: install it where you run this; in the cloud sandbox it is
 * preinstalled). Live scraping does not work here, so every /api/* call is MOCKED from scripts/ui-shots/fixtures.json, localStorage is
 * seeded, motion is switched off («Animatsiya: off») and the clock is fixed, so two runs of the same commit are byte-identical. After a shot
 * the run compares each file with the accepted run and prints what changed, what is new and what disappeared. Exit code 1 when anything
 * changed, so a «no visual change» commit (a split, a refactor) can be checked with one command.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d
const flag = (k) => process.argv.includes(`--${k}`)
const BASE = arg('base', 'http://localhost:3000')
const WIDTHS = arg('widths', '1300,960,700').split(',').map(Number)
const THEMES = arg('themes', 'light,dark').split(',')
const LOOKS = arg('looks', 'premium').split(',')
const ONLY = arg('only', '')
const ROOT = path.resolve('ui-shots')
const CUR = path.join(ROOT, 'current')
const ACC = path.join(ROOT, 'accepted')

const require = createRequire(import.meta.url)
let chromium
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break } catch { /* try the next */ }
}
if (!chromium) { console.error('Playwright topilmadi: o‘rnating (npm i -g playwright) yoki bulutdagi muhitda ishga tushiring.'); process.exit(2) }

if (flag('accept')) {
  if (!fs.existsSync(CUR)) { console.error('ui-shots/current yoʻq: avval `bun run ui:shots`.'); process.exit(2) }
  fs.rmSync(ACC, { recursive: true, force: true }); fs.cpSync(CUR, ACC, { recursive: true })
  console.log(`accepted: ${fs.readdirSync(ACC).length} ta rasm → ui-shots/accepted`); process.exit(0)
}

const F = JSON.parse(fs.readFileSync(new URL('./ui-shots/fixtures.json', import.meta.url), 'utf8'))
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
const hearing = (iso, no, court, time, judge) => ({ isoDate: iso, hearingDate: iso.split('-').reverse().join('.'), caseNumber: no, courtName: court, courtType: 'economic', courtTypeLabel: 'Iqtisodiy', hearingTime: time, judge, status: 'scheduled' })
const HEARINGS = [hearing('2026-11-24', '4-1001-2609/0877', 'Toshkent shahar iqtisodiy sudi', '10:30', 'Rahimov B.K.'), hearing('2026-11-27', '4-1001-2608/0452', 'Samarqand viloyat iqtisodiy sudi', '09:00', 'Karimova D.S.'), hearing('2026-12-09', '4-1001-2605/1450', 'Andijon viloyat iqtisodiy sudi', '14:00', 'Nazarov T.')]
const NOW = new Date('2026-11-18T09:00:00')

const registry = (now) => ({
  '302121267': { stir: '302121267', name: 'PROCAB', watched: true, watchedAt: now, lastVisitedAt: now, meta: { status: 'Faol', rating: 'AA', score: 94, cases: 6, winRate: 50, nextHearingIso: '2026-11-24', nextHearingCourt: 'Toshkent shahar iqtisodiy sudi', nextHearingCase: '4-1001-2609/0877', nextHearingTime: '10:30' } },
  '200000002': { stir: '200000002', name: 'Demo Qurilish AJ', watched: true, watchedAt: now, lastVisitedAt: now, meta: { status: 'Faol', rating: 'B', score: 61, cases: 5, winRate: 40, nextHearingIso: '2026-12-09', nextHearingCourt: 'Samarqand viloyat iqtisodiy sudi', nextHearingCase: '4-1001-2610/0301', nextHearingTime: '14:00' } },
})

async function mock(page) {
  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname
    if (p === '/api/stats') return r.fulfill(ok({ ...F.stats, company: { name: 'PROCAB', tin: '302121267', region: 'Toshkent sh.', status: 'Faoliyat yuritmoqda', officialName: F.info.company.officialName, shortName: 'PROCAB' } }))
    if (p === '/api/company-info') return r.fulfill(ok({ company: F.info.company, rating: F.info.rating }))
    if (p === '/api/rating') return r.fulfill(ok({ rating: { category: 'AA', score: 94 }, name: 'PROCAB' }))
    if (p === '/api/upcoming-hearings') return r.fulfill(ok({ tin: '302121267', count: HEARINGS.length, hearings: HEARINGS }))
    if (p === '/api/court-cases') return r.fulfill(ok({ cases: F.stats.cases.map((c, i) => ({ caseNumber: c.caseNumber, caseType: c.category, caseStatus: c.classification === 'pending' ? 'Ish yuritishda' : 'Hal qilindi', result: c.result, courtName: c.court, dateFiled: c.regDate, plaintiff: c.role === 'plaintiff' ? 'PROCAB' : c.counterparty, defendant: c.role === 'plaintiff' ? c.counterparty : 'PROCAB', claimAmount: F.cases[i % F.cases.length]?.claimAmount ?? '0', hearingDate: '', hearingTime: '', judge: 'Karimov B.' })) }))
    if (p === '/api/bills') return r.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'meta', total: 0 }) + '\n' + JSON.stringify({ type: 'done' }) + '\n' })
    if (/settings\/(version|health|workers)|presence/.test(p)) return r.fallback()
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'mock', status: 503 }) })
  })
}

const nav = async (page, re) => {
  const menu = page.locator('.menu-btn')
  if (await menu.isVisible().catch(() => false)) { await menu.click(); await page.waitForTimeout(250) }
  await page.locator('.side').getByText(re).first().click()
  await page.waitForTimeout(500)
}
const settle = (page) => page.evaluate(() => document.fonts.ready).then(() => page.waitForTimeout(350))

/** name → how to get there from a fresh load of the launcher */
const SCREENS = {
  '01-launcher': async () => {},
  '02-kuzatuv': async (p) => nav(p, /^Kuzatuv/),
  '03-statistika': async (p) => { await nav(p, /^Kuzatuv/); await p.locator('.ccard').first().click(); await p.waitForTimeout(900) },
  '04-sud-ishlari': async (p) => { await SCREENS['03-statistika'](p); await nav(p, /^Sud ishlari/); await p.waitForTimeout(700) },
  '05-case-detail': async (p) => { await SCREENS['04-sud-ishlari'](p); await p.locator('.lrow[data-case]:visible').first().click(); await p.waitForTimeout(700) },
  '06-majlislar': async (p) => { await SCREENS['03-statistika'](p); await nav(p, /^Majlislar/); await p.waitForTimeout(700) },
  '07-kompaniya': async (p) => { await SCREENS['03-statistika'](p); await nav(p, /^Kompaniya/); await p.waitForTimeout(700) },
  '08-qarorlar': async (p) => nav(p, /^Qarorlar/),
  '09-hujjatlar': async (p) => nav(p, /^Hujjatlar/),
  '10-sozlamalar': async (p) => nav(p, /^Sozlamalar/),
  '11-sozlamalar-koʻrinish': async (p) => { await nav(p, /^Sozlamalar/); await p.locator('.set-tab').first().click(); await p.waitForTimeout(400) },
  '12-cmd-k': async (p) => { await p.keyboard.press('Control+k'); await p.waitForTimeout(500) },
}

fs.rmSync(CUR, { recursive: true, force: true }); fs.mkdirSync(CUR, { recursive: true })
const browser = await chromium.launch()
let shots = 0
for (const look of LOOKS) for (const theme of THEMES) for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  try { await page.clock.setFixedTime(NOW) } catch { /* an older Playwright: dates are then today's, expect countdown differences */ }
  await page.addInitScript(([t, l, reg]) => { localStorage.setItem('theme', t); localStorage.setItem('look', l); localStorage.setItem('motion', 'off'); localStorage.setItem('sud-registry-v1', JSON.stringify(reg)) }, [theme, look, registry(NOW.getTime())])
  await mock(page)
  for (const [name, go] of Object.entries(SCREENS)) {
    if (ONLY && !name.includes(ONLY)) continue
    await page.goto(BASE, { waitUntil: 'networkidle' })
    try { await go(page); await settle(page) } catch (e) { console.warn(`  ! ${name} @${width}: ${String(e.message).split('\n')[0]}`) }
    await page.screenshot({ path: path.join(CUR, `${name}__${look}-${theme}-${width}.png`) })
    shots++
  }
  await ctx.close()
}
await browser.close()

const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')
console.log(`${shots} ta rasm → ui-shots/current`)
if (!fs.existsSync(ACC)) { console.log('accepted run yoʻq: `bun run ui:shots -- --accept` bilan qabul qiling.'); process.exit(0) }
const cur = new Set(fs.readdirSync(CUR)), acc = new Set(fs.readdirSync(ACC))
const changed = [...cur].filter((f) => acc.has(f) && sha(path.join(CUR, f)) !== sha(path.join(ACC, f)))
const added = [...cur].filter((f) => !acc.has(f)), gone = [...acc].filter((f) => !cur.has(f) && (!ONLY || f.includes(ONLY)))
for (const [t, l] of [['changed', changed], ['new', added], ['missing', gone]]) if (l.length) console.log(`\n${t} (${l.length}):\n  ${l.join('\n  ')}`)
if (!changed.length && !added.length && !gone.length) console.log('Hech narsa oʻzgarmagan: 0 piksel farq.')
process.exit(changed.length || added.length || gone.length ? 1 : 0)
