// Verify the two IIO templates against the ORIGINAL documents they were built from.
//   node scripts/doc-templates/verify-iio.mjs [templateDir]      (SRC=<folder with the originals>)
// 1. round trip: read every value out of the original (by place), fill the template with them, and the text must be
//    identical to the original's (whitespace collapsed: the source pads «(tel)» with ~60 spaces);
// 2. no placeholder is left unfilled;
// 3. none of the PERSONAL values appears anywhere in the package (body, header, preview image, metadata);
// 4. no preview image and no author in the package metadata.
// Nothing here knows a personal value: they all come out of the original at run time.
import fs from 'node:fs'
import path from 'node:path'
import { JSZip, esc, readAt, unesc } from './xml-edit.mjs'
import { IIO1, IIO1_FILE, IIO2, IIO2_FILE, IIO2_DISTRICT_EXTRA } from './iio-specs.mjs'

const SRC = process.env.SRC || '/root/.claude/uploads/eefe577e-0365-5422-b318-9c523988a4c3'
const TPL = process.argv[2] || './out-templates'
const collapse = (s) => s.replace(/[\s ]+/g, ' ').trim()
const textOf = (xml) => [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => unesc(m[1])).join('')

const cases = [
  { name: 'iio1_kafolat', file: IIO1_FILE, specs: IIO1 },
  {
    name: 'iio2_royxat',
    file: IIO2_FILE,
    specs: IIO2,
    // «MvaPB» was moved from line 3 up to the district on line 2
    patch: (v, xml) => {
      v.district_office = `${v.district_office} ${readAt(xml, IIO2_DISTRICT_EXTRA.sel, IIO2_DISTRICT_EXTRA.sub).trim()}`
    },
  },
]

let failures = 0
const fail = (msg) => {
  failures++
  console.log('  FAIL', msg)
}

for (const c of cases) {
  console.log(`\n== ${c.name} ==`)
  const src = await JSZip.loadAsync(fs.readFileSync(path.join(SRC, c.file)))
  const srcXml = await src.file('word/document.xml').async('string')

  // values, read from the original by place
  const values = {}
  const personal = []
  for (const s of c.specs) {
    if (!s.key) continue
    const v = readAt(srcXml, s.sel, s.sub).trim()
    if (values[s.key] !== undefined && values[s.key] !== v) fail(`${s.key} reads differently in two places: ${JSON.stringify(values[s.key])} vs ${JSON.stringify(v)}`)
    values[s.key] = v
    if (!s.keep && v.length >= 4) personal.push([s.key, v])
  }
  c.patch?.(values, srcXml)

  const tpl = await JSZip.loadAsync(fs.readFileSync(path.join(TPL, c.name + '.docx')))
  const tplXml = await tpl.file('word/document.xml').async('string')

  // 1 + 2: round trip, nothing left unfilled
  let filled = tplXml
  for (const [k, v] of Object.entries(values)) filled = filled.split(`{{${k}}}`).join(esc(v))
  const left = [...filled.matchAll(/\{\{[a-z_]+\}\}/g)].map((m) => m[0])
  const got = collapse(textOf(filled))
  const want = collapse(textOf(srcXml))
  const same = got === want
  console.log('  round-trip text identical        :', same)
  console.log('  placeholders left unfilled       :', left.length ? left.join(',') : 'none')
  if (!same) {
    let i = 0
    while (i < Math.min(got.length, want.length) && got[i] === want[i]) i++
    fail(`diverges at ${i}\n     want: ${JSON.stringify(want.slice(Math.max(0, i - 25), i + 45))}\n     got : ${JSON.stringify(got.slice(Math.max(0, i - 25), i + 45))}`)
  }
  if (left.length) fail('unfilled placeholders: ' + left.join(','))

  // 3: personal values anywhere in the package (as UTF-8 and UTF-16, so an image's text records are caught too)
  const hits = []
  for (const name of Object.keys(tpl.files)) {
    if (tpl.files[name].dir) continue
    const raw = Buffer.from(await tpl.file(name).async('uint8array'))
    const hay = [raw.toString('utf8'), raw.toString('utf16le'), raw.subarray(1).toString('utf16le')]
    for (const [k, v] of personal) {
      const variants = [v, v.replace(/\s+/g, ' ')]
      if (variants.some((x) => hay.some((h) => h.includes(x)))) hits.push(`${name}:${k}`)
    }
  }
  console.log('  personal values found in package :', hits.length ? hits.join(', ') : 'none', `(${personal.length} checked)`)
  if (hits.length) fail('personal data left in the template: ' + hits.join(', '))

  // 4: hygiene
  const thumbs = Object.keys(tpl.files).filter((n) => /thumbnail/i.test(n))
  const core = tpl.file('docProps/core.xml') ? await tpl.file('docProps/core.xml').async('string') : ''
  const who = [...core.matchAll(/<(?:dc:creator|cp:lastModifiedBy)>([^<]+)</g)].map((m) => m[1])
  console.log('  preview image / authors          :', thumbs.length ? thumbs.join(',') : 'none', '/', who.length ? who.join(',') : 'none')
  if (thumbs.length) fail('preview image still in the package')
  if (who.length) fail('author metadata still in the package')
}

console.log('\nFAILURES:', failures)
process.exit(failures ? 1 : 0)
