// Verify the visa and court templates against the ORIGINAL documents they were built from.
//   SRC=<folder with the originals> node scripts/doc-templates/verify-templates.mjs [templateDir]
// Every value is read out of the original by place (specs.mjs), so this file knows none: the round trip, the leak check
// (none of the personal values anywhere in the package, preview image included) and the hygiene check all run on what
// the original itself says. The IIO templates: verify-iio.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { JSZip, srcFile, valueOf } from './xml-edit.mjs'
import { SPECS } from './specs.mjs'
import { checkTemplate } from './verify-lib.mjs'

const SRC = process.env.SRC || '/root/.claude/uploads/eefe577e-0365-5422-b318-9c523988a4c3'
const TPL = process.argv[2] || './out-templates'

let failures = 0
for (const spec of SPECS) {
  const srcZip = await JSZip.loadAsync(fs.readFileSync(srcFile(SRC, spec.file)))
  const srcXml = await srcZip.file('word/document.xml').async('string')
  const values = {}
  const personal = []
  for (const op of spec.ops) {
    if (!op.key) continue
    const v = valueOf(srcXml, op).trim()
    if (values[op.key] !== undefined && values[op.key] !== v) {
      failures++
      console.log(`  FAIL ${spec.name}: ${op.key} reads differently in two places`)
    }
    values[op.key] = v
    if (!op.keep && v.length >= 4) personal.push([op.key, v])
  }
  const tplZip = await JSZip.loadAsync(fs.readFileSync(path.join(TPL, spec.name + '.docx')))
  failures += await checkTemplate({ name: spec.name, srcZip, tplZip, values, personal, textFix: spec.textFix })
}
console.log('\nFAILURES:', failures)
process.exit(failures ? 1 : 0)
