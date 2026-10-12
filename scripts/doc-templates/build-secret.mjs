// Build the two «Tijorat siri» templates (the order and the employee agreement) from the originals.
//   SRC=<folder with the originals> node scripts/doc-templates/build-secret.mjs ./out
// Where each variable part sits is declared in secret-specs.mjs; verify-secret.mjs proves the round trip.
import fs from 'node:fs'
import path from 'node:path'
import { JSZip, srcFile, fixSource, setAt, setCellText, scrubPackage, writeZip } from './xml-edit.mjs'
import { normalizeBanner } from './banner.mjs'
import { SECRET_SPECS } from './secret-specs.mjs'

const SRC = process.env.SRC || '/root/.claude/uploads/eefe577e-0365-5422-b318-9c523988a4c3'
const OUT = process.argv[2] || './out-templates'

/** the source with its deliberate fixes applied: what every value is read from */
export const fixed = (xml, spec) => fixSource(xml, spec.fixes)

export function applySecretOps(xml, ops) {
  for (const op of ops) {
    const ph = op.ph !== undefined ? op.ph : `{{${op.key}}}`
    xml = op.empty ? setCellText(xml, op.empty, ph) : setAt(xml, op.sel, op.sub, ph)
  }
  return xml
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  fs.mkdirSync(OUT, { recursive: true })
  for (const spec of SECRET_SPECS) {
    const zip = await JSZip.loadAsync(fs.readFileSync(srcFile(SRC, spec.file)))
    const xml = fixed(await zip.file('word/document.xml').async('string'), spec)
    zip.file('word/document.xml', applySecretOps(xml, spec.ops))
    await scrubPackage(zip)
    await normalizeBanner(zip)
    const bytes = await writeZip(zip, path.join(OUT, spec.name + '.docx'), fs)
    console.log('OK', spec.name, bytes, 'bytes')
  }
  console.log('done ->', OUT)
}
