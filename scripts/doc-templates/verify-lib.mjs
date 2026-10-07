// The checks every template must pass, shared by verify-templates.mjs and verify-iio.mjs. Nothing here knows a
// personal value: the caller reads them out of the ORIGINAL document (by place) at run time.
import { esc, unesc } from './xml-edit.mjs'

const collapse = (s) => s.replace(/[\s ]+/g, ' ').trim()
const textOf = (xml) => [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => unesc(m[1])).join('')

/**
 * @param name      template name (for the report)
 * @param srcZip    the original (JSZip)
 * @param tplZip    the template (JSZip)
 * @param values    { key: value } read from the original
 * @param personal  [[key, value]] values that must appear NOWHERE in the template package
 * @param textFix   [[from, to]] deliberate wording fixes of the original, applied to its text before comparing
 * @returns number of failures
 */
export async function checkTemplate({ name, srcZip, tplZip, values, personal, textFix = [] }) {
  let failures = 0
  const fail = (msg) => {
    failures++
    console.log('  FAIL', msg)
  }
  console.log(`\n== ${name} ==`)
  const srcXml = await srcZip.file('word/document.xml').async('string')
  const tplXml = await tplZip.file('word/document.xml').async('string')

  // 1 + 2: round trip (whitespace collapsed: some originals pad with runs of spaces), nothing left unfilled
  let filled = tplXml
  for (const [k, v] of Object.entries(values)) filled = filled.split(`{{${k}}}`).join(esc(v))
  const left = [...filled.matchAll(/\{\{[a-z_]+\}\}/g)].map((m) => m[0])
  const got = collapse(textOf(filled))
  const want = collapse(textFix.reduce((t, [a, b]) => t.split(a).join(b), textOf(srcXml)))
  const same = got === want
  console.log('  round-trip text identical        :', same, textFix.length ? '(with the deliberate wording fix)' : '')
  console.log('  placeholders left unfilled       :', left.length ? left.join(',') : 'none')
  if (!same) {
    let i = 0
    while (i < Math.min(got.length, want.length) && got[i] === want[i]) i++
    fail(`diverges at ${i}\n     want: ${JSON.stringify(want.slice(Math.max(0, i - 25), i + 45))}\n     got : ${JSON.stringify(got.slice(Math.max(0, i - 25), i + 45))}`)
  }
  if (left.length) fail('unfilled placeholders: ' + left.join(','))

  // 3: personal values anywhere in the package (as UTF-8 and UTF-16, so an image's text records are caught too)
  const hits = []
  for (const file of Object.keys(tplZip.files)) {
    if (tplZip.files[file].dir) continue
    const raw = Buffer.from(await tplZip.file(file).async('uint8array'))
    const hay = [raw.toString('utf8'), raw.toString('utf16le'), raw.subarray(1).toString('utf16le')]
    // Word splits a value across text runs («30» + «.07.2026»): search what a reader SEES, not just the raw XML
    if (/^word\/.*\.xml$/.test(file)) hay.push(textOf(raw.toString('utf8')))
    for (const [k, v] of personal) {
      const variants = [v, v.replace(/\s+/g, ' ')]
      if (variants.some((x) => hay.some((h) => h.includes(x)))) hits.push(`${file}:${k}`)
    }
  }
  console.log('  personal values found in package :', hits.length ? hits.join(', ') : 'none', `(${personal.length} checked)`)
  if (hits.length) fail('personal data left in the template: ' + hits.join(', '))

  // 4: hygiene
  const thumbs = Object.keys(tplZip.files).filter((n) => /thumbnail/i.test(n))
  const core = tplZip.file('docProps/core.xml') ? await tplZip.file('docProps/core.xml').async('string') : ''
  const who = [...core.matchAll(/<(?:dc:creator|cp:lastModifiedBy)>([^<]+)</g)].map((m) => m[1])
  console.log('  preview image / authors          :', thumbs.length ? thumbs.join(',') : 'none', '/', who.length ? who.join(',') : 'none')
  if (thumbs.length) fail('preview image still in the package')
  if (who.length) fail('author metadata still in the package')
  return failures
}
