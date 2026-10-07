// Build the two IIO templates (iio1_kafolat, iio2_royxat) from the real documents.
//   node scripts/doc-templates/build-iio.mjs ./out-templates      (SRC=<folder with the originals>)
// The values are found by PLACE (iio-specs.mjs), so this file and the specs hold no personal data. The result is
// scrubbed (no preview image, no author metadata). Verify with verify-iio.mjs, then copy into src/lib/documents/templates/.
import fs from 'node:fs'
import path from 'node:path'
import { JSZip, applySpecs, scrubPackage, writeZip } from './xml-edit.mjs'
import { IIO1, IIO1_FILE, IIO2, IIO2_FILE } from './iio-specs.mjs'

const SRC = process.env.SRC || '/root/.claude/uploads/eefe577e-0365-5422-b318-9c523988a4c3'
const OUT = process.argv[2] || './out-templates'
fs.mkdirSync(OUT, { recursive: true })

async function build(name, srcFile, specs) {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(SRC, srcFile)))
  const xml = await zip.file('word/document.xml').async('string')
  zip.file('word/document.xml', applySpecs(xml, specs))
  await scrubPackage(zip)
  const bytes = await writeZip(zip, path.join(OUT, name + '.docx'), fs)
  console.log('OK', name, bytes, 'bytes')
}

await build('iio1_kafolat', IIO1_FILE, IIO1)
await build('iio2_royxat', IIO2_FILE, IIO2)
console.log('done ->', OUT)
