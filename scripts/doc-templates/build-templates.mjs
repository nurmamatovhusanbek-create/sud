// Offline template generator: turn the real .docx into {{placeholder}} templates (visa letters and court petitions).
// Byte-precise string surgery on word/document.xml (no DOM reserialization), so Word compatibility is preserved;
// every variable value collapses into a single placeholder run, so the run-time fill is a trivial {{key}} replace.
//
//   SRC=<folder with the originals> node scripts/doc-templates/build-templates.mjs ./out
//
// WHERE each value sits is declared in specs.mjs (by place: table cell / label / marker); the value itself is read
// out of the original here, at run time, so no personal data is written down in this repository. The result is
// scrubbed (no first-page preview image, no author names). The two IIO templates: build-iio.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { JSZip, srcFile, applyOps, scrubPackage, writeZip } from './xml-edit.mjs'
import { normalizeBanner } from './banner.mjs'
import { SPECS } from './specs.mjs'

const SRC = process.env.SRC || '/root/.claude/uploads/eefe577e-0365-5422-b318-9c523988a4c3'
const OUT = process.argv[2] || '/tmp/out-templates'
fs.mkdirSync(OUT, { recursive: true })

for (const spec of SPECS) {
  const zip = await JSZip.loadAsync(fs.readFileSync(srcFile(SRC, spec.file)))
  const xml = await zip.file('word/document.xml').async('string')
  zip.file('word/document.xml', applyOps(xml, spec.ops))
  await scrubPackage(zip) // no preview image of the original, no author names
  await normalizeBanner(zip) // full-width inline banner in a first-page header (banner.mjs)
  const bytes = await writeZip(zip, path.join(OUT, spec.name + '.docx'), fs)
  console.log('OK', spec.name, bytes, 'bytes')
}
console.log('done ->', OUT)
