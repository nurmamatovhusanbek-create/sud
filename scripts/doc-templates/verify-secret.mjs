// Verify the two «Tijorat siri» templates against the ORIGINALS they were built from.
//   SRC=<folder with the originals> node scripts/doc-templates/verify-secret.mjs [templateDir]
// 1. round trip: put each span's original text back into the template and the text must equal the source's (after the
//    deliberate fixes). The originals' bracketed blanks («[номер]» in Russian, «[raqam]» in Uzbek) share ONE key, so
//    they are compared as «[]»;
// 2. no placeholder is left unfilled and no bracketed blank is left in the template;
// 3. no preview image and no author in the package.
import fs from 'node:fs'
import path from 'node:path'
import { JSZip, srcFile, readAt, unesc } from './xml-edit.mjs'
import { SECRET_SPECS } from './secret-specs.mjs'
import { fixed } from './build-secret.mjs'

const SRC = process.env.SRC || '/root/.claude/uploads/eefe577e-0365-5422-b318-9c523988a4c3'
const TPL = process.argv[2] || './out-templates'
const textOf = (xml) => [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => unesc(m[1])).join('')
const norm = (s) => s.replace(/[\s ]+/g, ' ').replace(/\[[^\]]*\]( \/ \[[^\]]*\])*/g, '[]').trim()

let failures = 0
const fail = (m) => { failures++; console.log('  FAIL', m) }

for (const spec of SECRET_SPECS) {
  console.log(`\n== ${spec.name} ==`)
  const srcZip = await JSZip.loadAsync(fs.readFileSync(srcFile(SRC, spec.file)))
  const srcXml = fixed(await srcZip.file('word/document.xml').async('string'), spec)
  const tplZip = await JSZip.loadAsync(fs.readFileSync(path.join(TPL, spec.name + '.docx')))
  const tplXml = await tplZip.file('word/document.xml').async('string')

  // the value of each key: what the source says there (a bracketed blank counts as «[]»)
  const values = {}
  for (const op of spec.ops) {
    if (!op.key) continue
    const v = op.empty ? '' : readAt(srcXml, op.sel, op.sub)
    const val = /^\[.*\]$/.test(v) ? '[]' : v
    if (values[op.key] !== undefined && values[op.key] !== val) fail(`${op.key} reads differently in two places: ${JSON.stringify(values[op.key])} / ${JSON.stringify(val)}`)
    values[op.key] = val
    // a combined placeholder («{{emp_name_ru}} / {{emp_name}}») stands for one bracketed blank
    for (const k of op.ph?.match(/[a-z_0-9]+(?=\}\})/g) ?? []) values[k] ??= val
  }
  let filled = tplXml.replace(/\{\{([a-z_0-9]+)\}\}/g, (_m, k) => (k in values ? values[k] : `{{${k}}}`))
  const left = [...new Set(filled.match(/\{\{[a-z_0-9]+\}\}/g) ?? [])]
  const want = norm(textOf(srcXml))
  const got = norm(textOf(filled))
  const same = got === want
  console.log('  round-trip text identical        :', same)
  console.log('  placeholders left unfilled       :', left.length ? left.join(',') : 'none')
  console.log('  bracketed blanks left in template:', /\[[^\]]*\]/.test(textOf(tplXml)) ? textOf(tplXml).match(/\[[^\]]*\]/g).join(' ') : 'none')
  if (!same) {
    let i = 0
    while (i < Math.min(got.length, want.length) && got[i] === want[i]) i++
    fail(`diverges at ${i}\n     want: ${JSON.stringify(want.slice(Math.max(0, i - 30), i + 50))}\n     got : ${JSON.stringify(got.slice(Math.max(0, i - 30), i + 50))}`)
  }
  if (left.length) fail('unfilled placeholders: ' + left.join(','))
  if (/\[[^\]]*\]/.test(textOf(tplXml))) fail('a bracketed blank is still in the template')

  const thumbs = Object.keys(tplZip.files).filter((n) => /thumbnail/i.test(n))
  const core = tplZip.file('docProps/core.xml') ? await tplZip.file('docProps/core.xml').async('string') : ''
  const who = [...core.matchAll(/<(?:dc:creator|cp:lastModifiedBy)>([^<]+)</g)].map((m) => m[1])
  console.log('  preview image / authors          :', thumbs.length ? thumbs.join(',') : 'none', '/', who.length ? who.join(',') : 'none')
  if (thumbs.length) fail('preview image still in the package')
  if (who.length) fail('author metadata still in the package')
}
console.log('\nFAILURES:', failures)
process.exit(failures ? 1 : 0)
