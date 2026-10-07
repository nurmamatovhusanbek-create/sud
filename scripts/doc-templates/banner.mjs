// Letterhead banner normalization: every banner-carrying template gets the SAME clean construction, so the banner
// always touches both page edges and its height follows the picture (never stretched).
//
//   a first-page header (word/header1.xml, w:titlePg) holding ONE paragraph: an INLINE picture as wide as the page,
//   the paragraph indented by minus the page margins, header distance 0, so the picture starts at the page's top-left
//   corner and ends at its right edge. The body then simply starts below the header (Word grows the header; no
//   anchors, no wrap polygons, no spacer paragraphs).
//
// Why not keep the originals' anchors: they sit at hand-tuned offsets (page / margin / paragraph relative, inside a
// table cell, wrapNone / wrapTight), the box ratio rarely equals the picture's, and a different letterhead swapped in
// at fill time (src/lib/documents/banner.ts) was stretched and could miss an edge. The runtime only changes the
// picture's height to match whatever PNG it gets.
//
//   node scripts/doc-templates/banner.mjs src/lib/documents/templates     (idempotent; also run by the builders)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSZip, writeZip } from './xml-edit.mjs'

const HEADER = 'word/header1.xml'
const HEADER_RELS = 'word/_rels/header1.xml.rels'
const MEDIA = 'word/media/image1.png'
const EMU = 635 // EMU per twip
const GAP = 120 // twips of air between the banner and the body text

const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) })
const attr = (xml, re) => Number((xml.match(re) || [])[1])

/** The paragraph + inline picture. `graphic` is the original <a:graphic> (blip embed rewritten to rId1). */
function bannerXml(graphic, cx, cy, left, right) {
  return (
    `<w:p><w:pPr><w:spacing w:before="0" w:after="${GAP}" w:line="240" w:lineRule="auto"/><w:ind w:left="-${left}" w:right="-${right}"/></w:pPr>` +
    `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="1" name="Banner"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `${graphic}</wp:inline></w:drawing></w:r></w:p>`
  )
}

const ROOT =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'

const lastIndexOfRe = (s, re, before) => {
  let last = -1
  for (let m; (m = re.exec(s)) && m.index < before; ) last = m.index
  return last
}

/** Drop empty paragraphs (no text, no picture, no table) that directly follow `at` in a body, up to the first real block. */
function dropBlanksAfter(xml, at) {
  let out = xml
  for (;;) {
    const m = /^<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/.exec(out.slice(at))
    if (!m || /<w:t\b|<w:drawing|<w:pict|<w:tbl\b/.test(m[0])) break
    out = out.slice(0, at) + out.slice(at + m[0].length)
  }
  return out
}

/**
 * Normalize ONE package in place. Returns false when it carries no banner (nothing touched), 'already' when it was
 * normalized before (nothing touched), true when it was rewritten.
 */
export async function normalizeBanner(zip) {
  const media = zip.file(MEDIA)
  if (!media) return false
  const docRels = await zip.file('word/_rels/document.xml.rels').async('string')
  let doc = await zip.file('word/document.xml').async('string')
  if (/w:titlePg\/>/.test(doc) && /name="Banner"/.test((await zip.file(HEADER)?.async('string')) ?? '')) return 'already'

  // where is the picture? in an existing header part, or in the body
  const hdrOld = zip.file(HEADER) ? await zip.file(HEADER).async('string') : null
  const inHeader = !!hdrOld && /<w:drawing>/.test(hdrOld)
  const src = inHeader ? hdrOld : doc
  const d0 = src.indexOf('<w:drawing>')
  const d1 = src.indexOf('</w:drawing>', d0) + '</w:drawing>'.length
  if (d0 < 0) throw new Error('banner image present but no drawing found')
  const drawing = src.slice(d0, d1)
  if ((src.match(/<w:drawing>/g) || []).length !== 1) throw new Error('expected exactly one drawing')
  const blip = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(drawing)
  if (!blip) throw new Error('drawing has no blip')
  let graphic = /<a:graphic\b[\s\S]*<\/a:graphic>/.exec(drawing)[0].replace(/r:embed="[^"]+"/, 'r:embed="rId1"')

  // geometry: full page width; height from the picture's own proportions (visible part when cropped)
  const sect = /<w:sectPr\b[\s\S]*?<\/w:sectPr>/.exec(doc)
  if ((doc.match(/<w:sectPr\b/g) || []).length !== 1) throw new Error('expected exactly one section')
  const pgW = attr(sect[0], /<w:pgSz\b[^>]*w:w="(\d+)"/)
  const left = attr(sect[0], /<w:pgMar\b[^>]*w:left="(\d+)"/)
  const right = attr(sect[0], /<w:pgMar\b[^>]*w:right="(\d+)"/)
  const { w, h } = pngSize(await media.async('nodebuffer'))
  const crop = (n) => attr(graphic, new RegExp(`<a:srcRect\\b[^>]*\\b${n}="(-?\\d+)"`)) || 0
  const vis = { w: 1 - (crop('l') + crop('r')) / 100000, h: 1 - (crop('t') + crop('b')) / 100000 }
  const cx = pgW * EMU
  const cy = Math.round((cx * (h * vis.h)) / (w * vis.w))
  graphic = graphic.replace(/<a:ext cx="\d+" cy="\d+"\/>/, `<a:ext cx="${cx}" cy="${cy}"/>`)

  // the header part
  zip.file(HEADER, `${ROOT}${bannerXml(graphic, cx, cy, left, right)}</w:hdr>`)
  zip.file(HEADER_RELS, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>')

  // take the picture out of the body (its run, and the paragraph if that left it empty)
  let rel = docRels
  if (!inHeader) {
    const rStart = lastIndexOfRe(doc, /<w:r[ >]/g, d0)
    const rEnd = doc.indexOf('</w:r>', d1) + '</w:r>'.length
    doc = doc.slice(0, rStart) + doc.slice(rEnd)
    const pStart = lastIndexOfRe(doc, /<w:p[ >]/g, rStart)
    const pEnd = doc.indexOf('</w:p>', rStart) + '</w:p>'.length
    const para = doc.slice(pStart, pEnd)
    if (!/<w:t\b|<w:drawing|<w:tab\/>/.test(para) && /<w:body>$/.test(doc.slice(0, pStart))) {
      doc = doc.slice(0, pStart) + doc.slice(pEnd)
      doc = dropBlanksAfter(doc, pStart)
    }
    // a floating table (tblpPr) was placed by hand from the page's top edge; it would sit under a taller banner
    doc = doc.replace(/<w:tblpPr\b[^>]*\/>/g, '')
    rel = rel.replace('</Relationships>', '<Relationship Id="rIdBanner" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>')
  }

  // section: first-page header only, header distance 0, no default header
  const refId = !inHeader ? null : /<w:headerReference\b[^>]*r:id="([^"]+)"/.exec(sect[0])?.[1]
  let sectNew = sect[0].replace(/<w:headerReference\b[^>]*\/>/g, '').replace(/<w:pgMar\b([^>]*)w:header="\d+"/, '<w:pgMar$1w:header="0"')
  sectNew = sectNew.replace(/(<w:sectPr\b[^>]*>)/, `$1<w:headerReference w:type="first" r:id="${refId || 'rIdBanner'}"/>`)
  sectNew = /<w:titlePg\/>/.test(sectNew) ? sectNew : sectNew.replace(/<w:docGrid\b|<\/w:sectPr>/, (m) => `<w:titlePg/>${m}`)
  doc = doc.replace(sect[0], sectNew)

  zip.file('word/document.xml', doc)
  zip.file('word/_rels/document.xml.rels', rel)
  const ct = await zip.file('[Content_Types].xml').async('string')
  if (!/PartName="\/word\/header1\.xml"/.test(ct)) {
    zip.file('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'))
  }
  return true
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || 'src/lib/documents/templates'
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.docx'))) {
    const file = path.join(dir, f)
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    const r = await normalizeBanner(zip)
    if (r === true) await writeZip(zip, file, fs)
    console.log(r === true ? 'banner normalized' : r === 'already' ? 'already ok       ' : 'no banner        ', f)
  }
}
