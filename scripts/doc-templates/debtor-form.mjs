// The demand-letter templates (pretenzia.docx, talabnoma-uz.docx) were built with the sample debtor's legal form
// written into the text («АО «…»», ««…» AJ»). The form now comes from the sheet: this puts {{debtor_form}} there.
//   node scripts/doc-templates/debtor-form.mjs src/lib/documents/templates      (idempotent)
// build-pretenzia.mjs / build-talabnoma-uz.mjs do the same when they rebuild the templates from the originals.
import fs from 'node:fs'
import path from 'node:path'
import { JSZip, paraReplace, tokenize, writeZip } from './xml-edit.mjs'

const PAIRS = {
  'pretenzia.docx': [['АО «{{debtor_name}}»', '{{debtor_form}} «{{debtor_name}}»']],
  'talabnoma-uz.docx': [['«{{debtor_name}}» AJ', '«{{debtor_name}}» {{debtor_form}}']],
}

const dir = process.argv[2] || 'src/lib/documents/templates'
for (const [name, pairs] of Object.entries(PAIRS)) {
  const file = path.join(dir, name)
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  let xml = await zip.file('word/document.xml').async('string')
  let n = 0
  for (const [from, to] of pairs) {
    while (tokenize(xml).texts.join('').includes(from)) {
      xml = paraReplace(xml, from, to, 0)
      n++
    }
  }
  if (!n) {
    console.log('already ok ', name)
    continue
  }
  zip.file('word/document.xml', xml)
  await writeZip(zip, file, fs)
  console.log('patched', n, name)
}
