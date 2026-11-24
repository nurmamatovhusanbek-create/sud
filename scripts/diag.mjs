// Diagnostic report for ONE company: what the app's database and list files hold, what the running app says, and the end of dev.log.
//   bun scripts/diag.mjs 200248856        (or: bun run diag 200248856)
// It only READS (the database is opened read-only, nothing is scraped, nothing is sent anywhere) and writes `diag-<STIR>.txt` next to the project.
// Tokens, keys and passphrases are never read; anything that looks like one is blanked out of the report before it is written.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { execSync } from 'node:child_process'

const tin = process.argv[2] ?? ''
if (!/^\d{9}$/.test(tin)) {
  console.error('Foydalanish: bun scripts/diag.mjs <STIR, 9 ta raqam>')
  process.exit(2)
}
const home = process.env.SUD_HOME || path.join(os.homedir(), '.sud-tizimi')
const dbFile = process.env.SUD_DB || path.join(home, 'sud.db')
const feedFile = path.join(process.env.CASE_STORE_DIR || path.join(home, 'cases'), `${tin}.json.gz`)
const isCaseNumber = (s) => typeof s === 'string' && /^\d+-[\d-]+\/\d+$/.test(s.trim())

const out = []
const line = (s = '') => out.push(s)
const h = (s) => { line(); line(`== ${s} ==`) }

async function openDb() {
  try {
    const { Database } = await import('bun:sqlite')
    return new Database(dbFile, { readonly: true })
  } catch {
    const { DatabaseSync } = await import('node:sqlite')
    return new DatabaseSync(dbFile, { readOnly: true })
  }
}
const sh = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '?' } }

line(`Sud tizimi diagnostikasi · STIR ${tin} · ${new Date().toISOString()}`)
line(`runtime: ${typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`} · ${process.platform}`)
line(`kod: ${sh('git rev-parse --short HEAD')} · ${sh('git log -1 --format=%cs')} · ${sh('git status --short').split('\n').filter(Boolean).length} oʻzgargan fayl`)

let db = null
h('Baza')
try {
  const st = fs.statSync(dbFile)
  line(`${dbFile} · ${(st.size / 1048576).toFixed(1)} MB · oxirgi oʻzgarish ${st.mtime.toISOString()}`)
  db = await openDb()
  const all = (sql, ...a) => db.prepare(sql).all(...a)
  const one = (sql, ...a) => db.prepare(sql).get(...a)
  line(`schema versiyasi: ${one('PRAGMA user_version')?.user_version}`)
  const co = one('SELECT * FROM companies WHERE tin = ?', tin)
  line(`kompaniya yozuvi: ${co ? `birinchi ${new Date(co.first_at).toISOString()} · yangilangan ${new Date(co.refreshed_at).toISOString()} · oxirgi qoʻshilgan ${co.last_added}` : 'YOʻQ'}`)
  const bl = one('SELECT * FROM bill_loads WHERE tin = ?', tin)
  line(`toʻlovlar yuklanishi: ${bl ? `jami ${bl.total_elements} ta · sahifa ${bl.pages_done}/${bl.total_pages} (hajmi ${bl.page_size}) · oʻtish ${bl.pass} · tugagan ${bl.complete} · barqaror ${bl.stable} · ${new Date(bl.loaded_at).toISOString()}` : 'YOʻQ'}`)

  h('Toʻlovlar (bazada)')
  const b = one('SELECT COUNT(*) n, COUNT(case_number) wc, COUNT(DISTINCT case_number) dc, MIN(issued) lo, MAX(issued) hi FROM bills WHERE tin = ?', tin)
  line(`saqlangan: ${b.n} ta (ish raqamli ${b.wc}); har xil ish raqami: ${b.dc}`)
  for (const r of all('SELECT ctype, COUNT(*) n, COUNT(DISTINCT case_number) c FROM bills WHERE tin = ? GROUP BY ctype', tin)) line(`  ${r.ctype ?? '?'}: ${r.n} ta kvitansiya, ${r.c} ta ish raqami`)
  const passes = all('SELECT pass, COUNT(*) n FROM bills WHERE tin = ? GROUP BY pass ORDER BY pass', tin)
  line(`  oʻtishlar boʻyicha: ${passes.map((p) => `${p.pass}:${p.n}`).join(' · ') || '-'}`)

  h('Raqam boʻyicha topilgan ishlar (found_cases / tried / case_details)')
  const foundRows = all('SELECT court, num, status FROM found_cases WHERE tin = ?', tin)
  const byCourt = {}
  for (const r of foundRows) byCourt[r.court] = (byCourt[r.court] ?? 0) + 1
  line(`found_cases: ${foundRows.length} ta ${JSON.stringify(byCourt)}`)
  const tried = all('SELECT found, COUNT(*) n FROM tried WHERE tin = ? GROUP BY found', tin)
  line(`tried: ${tried.map((t) => `${t.found ? 'topilgan' : 'topilmagan'} ${t.n}`).join(' · ') || '-'}`)
  const detail = one('SELECT COUNT(*) n FROM case_details WHERE num IN (SELECT num FROM found_cases WHERE tin = ?)', tin)
  line(`topilgan ishlarning toʻliq tafsiloti saqlangan: ${detail.n} ta`)

  var triedNone = new Set(all('SELECT num FROM tried WHERE tin = ? AND found = 0', tin).map((r) => r.num))
  var billCases = new Set(all('SELECT DISTINCT case_number c FROM bills WHERE tin = ? AND case_number IS NOT NULL', tin).map((r) => r.c))
  var foundNums = new Set(foundRows.map((r) => r.num))
} catch (e) {
  line(`BAZANI OʻQIB BOʻLMADI: ${e instanceof Error ? e.message : e}`)
}

h('Sud roʻyxatlari (fayl)')
const listNums = new Set()
const listRowsByCourtNum = new Set()
let dashRows = 0
try {
  const st = fs.statSync(feedFile)
  line(`${feedFile} · ${(st.size / 1024).toFixed(0)} KB · ${st.mtime.toISOString()}`)
  const feed = JSON.parse(zlib.gunzipSync(fs.readFileSync(feedFile)).toString())
  for (const [key, f] of Object.entries(feed.feeds ?? {})) {
    const items = Array.isArray(f.items) ? f.items : []
    const real = items.filter((i) => isCaseNumber(i.caseNumber))
    dashRows += items.length - real.length
    for (const i of real) { listNums.add(i.caseNumber); listRowsByCourtNum.add(`${key.split('|')[0]}:${i.caseNumber}`) }
    line(`  ${key}: ${items.length} qator (haqiqiy raqamli ${real.length}) · toʻliq=${f.complete} · kesilgan=${!!f.capped} · ETag=${f.etag ? 'bor' : 'yoʻq'} · ${f.t ? new Date(f.t).toISOString() : 'vaqt 0 (zaxiradan)'}`)
  }
} catch (e) {
  line(`roʻyxat fayli yoʻq yoki oʻqilmadi (${e instanceof Error ? e.message : e})`)
}

h('Hisob (app va bot qanday sanaydi)')
if (db) {
  const union = new Set([...listNums, ...foundNums])
  const billOnly = [...billCases].filter((n) => !union.has(n))
  line(`roʻyxatlarda haqiqiy ish (har xil raqam): ${listNums.size}`)
  line(`raqam boʻyicha topilgan: ${foundNums.size}`)
  line(`Statistika = roʻyxatlar + topilganlar (har xil raqam): ${union.size}`)
  line(`zaxiradagi «lists» qatorlari (sud:raqam, botdagi «listed»): ${listRowsByCourtNum.size}`)
  line(`faqat toʻlovlarda nomlangan, roʻyxatda va topilganlarda yoʻq ishlar: ${billOnly.length} (shulardan sud tizimi «topilmadi» degani: ${billOnly.filter((n) => triedNone.has(n)).length}, hali soʻralmagani: ${billOnly.filter((n) => !triedNone.has(n)).length})`)
  line(`botning umumiy koʻrinishi (roʻyxat + topilgan + olinmagan): ${new Set([...union, ...billOnly]).size}`)
  line(`raqamsiz qatorlar (sudga yuborilmagan daʼvolar, sanalmaydi): ${dashRows}`)
}

h('Ishlab turgan ilova (http://localhost:3000)')
const ask = async (p) => {
  try {
    const r = await fetch(`http://localhost:3000${p}`, { headers: { Origin: 'http://localhost:3000', 'Sec-Fetch-Site': 'same-origin' }, signal: AbortSignal.timeout(45000) })
    const t = await r.text()
    return `${r.status} ${t.slice(0, 900)}`
  } catch (e) {
    return `javob yoʻq (${e instanceof Error ? e.message : e}): ilova ishlamayaptimi?`
  }
}
for (const p of [`/api/bill-cases?tin=${tin}`, '/api/settings/backup', '/api/settings/backup/auto', '/api/settings/watch']) {
  line(`GET ${p}`)
  line(`  ${await ask(p)}`)
}

h('dev.log oxiri (oxirgi 200 qator)')
try {
  const f = ['dev.log', 'server.log'].find((n) => fs.existsSync(n))
  if (!f) line('dev.log topilmadi: dasturni loyiha papkasida ishga tushiring (Sud.bat) va shu papkadan buyruqni bajaring')
  else {
    const buf = fs.readFileSync(f)
    const tail = buf.subarray(Math.max(0, buf.length - 96 * 1024)).toString('utf8').split('\n').slice(-200)
    line(`${f} · ${(buf.length / 1024).toFixed(0)} KB`)
    for (const l of tail) line(l)
  }
} catch (e) {
  line(`log oʻqilmadi: ${e instanceof Error ? e.message : e}`)
}

// nothing that looks like a secret leaves this machine in the file
const redact = (s) => s
  .replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, '[bot-token]')
  .replace(/\bAQ\.[A-Za-z0-9_-]{20,}\b/g, '[kalit]')
  .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[kalit]')
  .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[kalit]')
  .replace(/(Bearer|Authorization:?)\s+[A-Za-z0-9._~+/=-]{16,}/gi, '$1 [yashirilgan]')
const file = `diag-${tin}.txt`
fs.writeFileSync(file, redact(out.join('\n')) + '\n')
console.log(redact(out.slice(0, out.indexOf('== dev.log oxiri (oxirgi 200 qator) ==') > 0 ? out.indexOf('== dev.log oxiri (oxirgi 200 qator) ==') : out.length).join('\n')))
console.log(`\nTayyor: ${path.resolve(file)}\nShu faylni yuboring (token va kalitlar yashirilgan).`)
