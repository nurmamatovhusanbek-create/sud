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
import { JSZip, srcFile, readAt } from './xml-edit.mjs'
import { checkTemplate } from './verify-lib.mjs'
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
for (const c of cases) {
  const srcZip = await JSZip.loadAsync(fs.readFileSync(srcFile(SRC, c.file)))
  const srcXml = await srcZip.file('word/document.xml').async('string')
  const values = {}
  const personal = []
  for (const s of c.specs) {
    if (!s.key) continue
    const v = readAt(srcXml, s.sel, s.sub).trim()
    if (values[s.key] !== undefined && values[s.key] !== v) {
      failures++
      console.log(`  FAIL ${c.name}: ${s.key} reads differently in two places`)
    }
    values[s.key] = v
    if (!s.keep && v.length >= 4) personal.push([s.key, v])
  }
  c.patch?.(values, srcXml)
  const tplZip = await JSZip.loadAsync(fs.readFileSync(path.join(TPL, c.name + '.docx')))
  failures += await checkTemplate({ name: c.name, srcZip, tplZip, values, personal })
}
console.log('\nFAILURES:', failures)
process.exit(failures ? 1 : 0)
