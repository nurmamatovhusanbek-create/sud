// Remove what a template must not carry from every .docx in a folder, IN PLACE: the preview image of the original
// first page (readable names / passport numbers) and the author names in the package metadata. Nothing else changes.
//   node scripts/doc-templates/scrub-templates.mjs src/lib/documents/templates
import fs from 'node:fs'
import path from 'node:path'
import { JSZip, scrubPackage, writeZip } from './xml-edit.mjs'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scrub-templates.mjs <folder with .docx templates>')
  process.exit(1)
}
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.docx'))) {
  const file = path.join(dir, f)
  const before = fs.statSync(file).size
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  const xml = await zip.file('word/document.xml').async('string')
  await scrubPackage(zip)
  // the body is untouched byte for byte
  if ((await zip.file('word/document.xml').async('string')) !== xml) throw new Error('document.xml changed: ' + f)
  const after = await writeZip(zip, file, fs)
  console.log(f.padEnd(24), before, '->', after)
}
