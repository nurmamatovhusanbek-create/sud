// Shared helpers for the template builders: byte-precise string surgery on word/document.xml
// (no DOM reserialization, so Word compatibility is preserved) plus a package scrub.
//
// Two ways to find a value to replace:
//  - by its TEXT   (`paraReplace`, `cellSet`): needs the literal value, fine for company constants;
//  - by its PLACE  (`setAt` / `readAt`): a table cell + paragraph, or a paragraph found by a phrase, and optionally the
//    text between a label and a marker. This is how PERSONAL values are located: the builder never has to contain a
//    name, a passport number or a phone number, so none of them ends up in the repository.
import JSZip from 'jszip'

// nbsp → normal space so targets typed with normal spaces still match (only affects runs a replacement rewrites).
export const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/ /g, ' ')
export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function tokenize(xml) {
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
  const runs = []
  let m
  while ((m = re.exec(xml))) {
    const tagStart = m.index
    const innerStart = m.index + m[0].indexOf('>') + 1
    const innerEnd = m.index + m[0].length - '</w:t>'.length
    runs.push({ tagStart, innerStart, innerEnd, inner: m[1] })
  }
  const texts = runs.map((r) => unesc(r.inner))
  return { runs, texts }
}

// editsMap: Map<runIndex, newUnescapedInner>
export function editRuns(xml, editsMap) {
  const { runs } = tokenize(xml)
  const idx = [...editsMap.keys()].sort((a, b) => b - a)
  for (const i of idx) {
    const r = runs[i]
    const repl = `<w:t xml:space="preserve">${esc(editsMap.get(i))}</w:t>`
    xml = xml.slice(0, r.tagStart) + repl + xml.slice(r.innerEnd + '</w:t>'.length)
  }
  return xml
}

// returns {r0,r1,localStart,localEnd} for the occ-th occurrence of `target` in the concatenated run text, or null
export function locate(texts, target, occ) {
  const bounds = []
  let acc = 0
  for (const t of texts) {
    bounds.push(acc)
    acc += t.length
  }
  const full = texts.join('')
  let from = 0
  let found = -1
  let seen = 0
  for (;;) {
    const p = full.indexOf(target, from)
    if (p < 0) break
    if (occ === 'all' || seen === occ) {
      found = p
      if (occ !== 'all') break
    }
    seen++
    from = p + Math.max(1, target.length)
    if (occ === 'all' && found >= 0) break
  }
  if (found < 0) return null
  const start = found
  const end = found + target.length
  const runOf = (pos, isEnd) => {
    for (let i = 0; i < texts.length; i++) {
      const s = bounds[i]
      const e = bounds[i] + texts[i].length
      if (isEnd) {
        if (pos > s && pos <= e) return i
      } else if (pos >= s && pos < e) return i
    }
    return texts.length - 1
  }
  const r0 = runOf(start, false)
  const r1 = runOf(end, true)
  return { r0, r1, localStart: start - bounds[r0], localEnd: end - bounds[r1] }
}

export function applyLoc(xml, texts, loc, ph) {
  const { r0, r1, localStart, localEnd } = loc
  const edits = new Map()
  if (r0 === r1) {
    edits.set(r0, texts[r0].slice(0, localStart) + ph + texts[r0].slice(localEnd))
  } else {
    edits.set(r0, texts[r0].slice(0, localStart) + ph)
    for (let i = r0 + 1; i < r1; i++) edits.set(i, '')
    edits.set(r1, texts[r1].slice(localEnd))
  }
  return editRuns(xml, edits)
}

export function paraReplace(xml, target, ph, occ = 'all') {
  if (occ === 'all') {
    let guard = 0
    for (;;) {
      const { texts } = tokenize(xml)
      const loc = locate(texts, target, 0)
      if (!loc) break
      xml = applyLoc(xml, texts, loc, ph)
      if (++guard > 200) throw new Error('loop guard ' + target)
    }
    if (guard === 0) throw new Error('NOT FOUND (all): ' + target)
    return xml
  }
  const { texts } = tokenize(xml)
  const loc = locate(texts, target, occ)
  if (!loc) throw new Error(`NOT FOUND (occ ${occ}): ${target}`)
  return applyLoc(xml, texts, loc, ph)
}

// find <w:tc ...>...</w:tc> spans (non-nested assumption) and set the occ-th whose stripped text === cellText to a
// single placeholder run.
export function cellSet(xml, cellText, ph, occ = 0) {
  const re = /<w:tc\b[\s\S]*?<\/w:tc>/g
  let m
  let seen = 0
  while ((m = re.exec(xml))) {
    const span = m[0]
    const inners = [...span.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((x) => unesc(x[1]))
    const txt = inners.join('').trim()
    if (txt === cellText) {
      if (seen === occ) {
        const abs = m.index
        const { runs } = tokenize(xml)
        const within = runs.map((r, i) => ({ r, i })).filter((o) => o.r.tagStart >= abs && o.r.tagStart < abs + span.length)
        const edits = new Map()
        within.forEach((o, k) => edits.set(o.i, k === 0 ? ph : ''))
        return editRuns(xml, edits)
      }
      seen++
    }
  }
  throw new Error(`CELL NOT FOUND occ ${occ}: ${cellText}`)
}

// ---- locating by PLACE ------------------------------------------------------------------------------------------

/**
 * For every text run: which top-level table / row / cell / paragraph it sits in. Paragraphs get a global id (`pid`).
 * Assumes no nested tables and no text boxes (checked by the specs' own tests: a source that has them fails loudly).
 */
function placeRuns(xml, runs) {
  const ev = []
  const re = /<w:(tbl|tr|tc|p)(?=[ >/])[^>]*?(\/?)>|<\/w:(tbl|tr|tc|p)>/g
  let m
  while ((m = re.exec(xml))) {
    if (m[3]) ev.push({ pos: m.index, kind: m[3], open: false })
    else if (m[2] !== '/') ev.push({ pos: m.index, kind: m[1], open: true })
    // a self-closing element holds no runs: ignored
  }
  let tbl = -1
  let row = -1
  let cell = -1
  let pInCell = -1
  let bodyP = -1
  let pid = -1
  let inTbl = false
  let inP = false
  let e = 0
  return runs.map((r) => {
    while (e < ev.length && ev[e].pos < r.tagStart) {
      const { kind, open } = ev[e++]
      if (kind === 'tbl') {
        if (open) {
          tbl++
          row = -1
          inTbl = true
        } else inTbl = false
      } else if (kind === 'tr' && open) {
        row++
        cell = -1
      } else if (kind === 'tc' && open) {
        cell++
        pInCell = -1
      } else if (kind === 'p') {
        if (open) {
          pid++
          if (inTbl) pInCell++
          else bodyP++
          inP = true
        } else inP = false
      }
    }
    return { pid, tbl: inTbl ? tbl : -1, row: inTbl ? row : -1, cell: inTbl ? cell : -1, p: inTbl ? pInCell : bodyP, inP }
  })
}

/** A selector is { tbl, row, cell, p = 0 } (a table cell's paragraph), { body: n } or { find: 'phrase' } (the one paragraph containing it). */
function paragraphRuns(xml, sel) {
  const { runs, texts } = tokenize(xml)
  const where = placeRuns(xml, runs)
  const groups = new Map()
  runs.forEach((_, i) => {
    const w = where[i]
    if (w.pid < 0) return
    if (!groups.has(w.pid)) groups.set(w.pid, { w, idx: [] })
    groups.get(w.pid).idx.push(i)
  })
  let hit = []
  for (const g of groups.values()) {
    const text = g.idx.map((i) => texts[i]).join('')
    let ok
    if (sel.find !== undefined) ok = text.includes(sel.find)
    else if (sel.body !== undefined) ok = g.w.tbl < 0 && g.w.p === sel.body
    else ok = g.w.tbl === sel.tbl && g.w.row === sel.row && g.w.cell === sel.cell && g.w.p === (sel.p ?? 0)
    if (ok) hit.push(g)
  }
  if (hit.length !== 1) throw new Error(`selector ${JSON.stringify(sel)} matched ${hit.length} paragraphs`)
  return { idx: hit[0].idx, texts }
}

/** The span of a paragraph a spec points at: whole, or between `from` (label) and `to` (marker); `trim` drops outer spaces. */
function span(sel, sub = {}, para) {
  const { idx, texts } = para
  const bounds = []
  let acc = 0
  for (const i of idx) {
    bounds.push(acc)
    acc += texts[i].length
  }
  const full = idx.map((i) => texts[i]).join('')
  let start = 0
  let end = full.length
  if (sub.from !== undefined) {
    const p = sub.fromLast ? full.lastIndexOf(sub.from) : full.indexOf(sub.from)
    if (p < 0) throw new Error(`label ${JSON.stringify(sub.from)} not found in ${JSON.stringify(sel)}`)
    start = p + sub.from.length
  }
  if (sub.to !== undefined) {
    const p = full.indexOf(sub.to, start)
    if (p < 0) throw new Error(`marker ${JSON.stringify(sub.to)} not found in ${JSON.stringify(sel)}`)
    end = p
  }
  if (sub.trim) {
    while (start < end && /\s/.test(full[start])) start++
    while (end > start && /\s/.test(full[end - 1])) end--
  }
  if (end <= start) throw new Error(`empty span for ${JSON.stringify(sel)} ${JSON.stringify(sub)}`)
  const runAt = (pos, isEnd) => {
    for (let k = 0; k < idx.length; k++) {
      const s = bounds[k]
      const e = s + texts[idx[k]].length
      if (isEnd ? pos > s && pos <= e : pos >= s && pos < e) return k
    }
    return idx.length - 1
  }
  const k0 = runAt(start, false)
  const k1 = runAt(end, true)
  return { r0: idx[k0], r1: idx[k1], localStart: start - bounds[k0], localEnd: end - bounds[k1], text: full.slice(start, end) }
}

/** The text a spec points at (the personal value, read from the SOURCE document). */
export function readAt(xml, sel, sub) {
  return span(sel, sub, paragraphRuns(xml, sel)).text
}

/** Replace what a spec points at with `ph`. */
export function setAt(xml, sel, sub, ph) {
  const para = paragraphRuns(xml, sel)
  const loc = span(sel, sub, para)
  return applyLoc(xml, para.texts, loc, ph)
}

/** Apply a list of specs { key | ph, sel, sub } in order: each becomes `{{key}}` (or the literal `ph`, '' deletes). */
export function applySpecs(xml, specs) {
  for (const s of specs) xml = setAt(xml, s.sel, s.sub, s.ph !== undefined ? s.ph : `{{${s.key}}}`)
  return xml
}

// ---- by-place ops (value read from the ORIGINAL at a place, then replaced like the old text-matched specs did) ------

/**
 * An op describes one placeholder:
 *   key | ph   the placeholder `{{key}}`, or the literal `ph` (may carry fixed words around the placeholder)
 *   sel, sub   WHERE the value sits in the original (see `readAt`); `read: [{sel, sub}, …]` joins several places
 *   occ        'all' (default): every occurrence of the value; a number: that occurrence only
 *   cell       the value is a whole table cell: replaced through `cellSet`
 *   keep       the value is a company constant, not personal data (the verifier's leak check skips it)
 *   fix        [from, to]: a deliberate wording fix of the original (no value involved)
 *   as         { from, to, trim }: when the replaced span is wider than the value (it includes fixed words that stay
 *              around the placeholder in `ph`), where the VALUE itself is — used by the verifier to fill it back
 * The value is read from the original once, up front, so the order of ops cannot change what a later op reads.
 */
export function readOp(srcXml, op) {
  const parts = op.read ?? [{ sel: op.sel, sub: op.sub }]
  return parts.map((p) => readAt(srcXml, p.sel, p.sub)).join('')
}

/** The value a placeholder stands for (the verifier fills it back): the replaced span, or its `as` part. */
export function valueOf(srcXml, op) {
  return op.as ? readAt(srcXml, op.sel, op.as) : readOp(srcXml, op)
}

export function applyOps(srcXml, ops) {
  let xml = srcXml
  for (const op of ops) {
    if (op.fix) {
      xml = paraReplace(xml, op.fix[0], op.fix[1], 'all')
      continue
    }
    const value = readOp(srcXml, op)
    const ph = op.ph !== undefined ? op.ph : `{{${op.key}}}`
    xml = op.cell ? cellSet(xml, value.trim(), ph, op.occ ?? 0) : paraReplace(xml, value, ph, op.occ ?? 'all')
  }
  return xml
}

// ---- package hygiene --------------------------------------------------------------------------------------------

/**
 * A template must carry nothing of the document it was made from. Word stores a PREVIEW IMAGE of the first page
 * (docProps/thumbnail.emf: the original names and passport numbers, readable) and the author names in the package
 * metadata; neither is needed to open or fill the document.
 */
export async function scrubPackage(zip) {
  for (const name of Object.keys(zip.files)) if (/^docProps\/thumbnail\./i.test(name)) zip.remove(name)

  const rels = zip.file('_rels/.rels')
  if (rels) {
    const x = await rels.async('string')
    zip.file('_rels/.rels', x.replace(/<Relationship\b[^>]*\/metadata\/thumbnail"[^>]*\/>/g, ''))
  }
  // the emf content type is only needed while an .emf part exists
  if (!Object.keys(zip.files).some((n) => /\.emf$/i.test(n))) {
    const ct = zip.file('[Content_Types].xml')
    if (ct) zip.file('[Content_Types].xml', (await ct.async('string')).replace(/<Default Extension="emf"[^>]*\/>/i, ''))
  }
  const blank = (x, tags) => tags.reduce((s, t) => s.replace(new RegExp(`(<${t}(?:\\s[^>]*)?>)[^<]*(</${t}>)`, 'g'), '$1$2'), x)
  const core = zip.file('docProps/core.xml')
  if (core) zip.file('docProps/core.xml', blank(await core.async('string'), ['dc:creator', 'cp:lastModifiedBy', 'dc:description', 'dc:subject', 'cp:keywords']))
  const app = zip.file('docProps/app.xml')
  if (app) zip.file('docProps/app.xml', blank(await app.async('string'), ['Company', 'Manager']))
}

export async function writeZip(zip, outFile, fs) {
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  fs.writeFileSync(outFile, buf)
  return buf.length
}

export { JSZip }
