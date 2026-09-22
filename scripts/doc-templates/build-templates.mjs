// Offline template generator: turn the real .docx into {{placeholder}} templates.
// Byte-precise string surgery on word/document.xml (no DOM reserialization),
// so Word compatibility is preserved. Collapses run-fragmented values into a
// single placeholder run; run-time filling is then trivial {{key}} replace.
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const SRC = '/root/.claude/uploads/eefe577e-0365-5422-b318-9c523988a4c3'
const OUT = process.argv[2] || '/tmp/out-templates'
fs.mkdirSync(OUT, { recursive: true })

const unesc = (s) => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'")
const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

function tokenize(xml){
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
  const runs = []
  let m
  while((m = re.exec(xml))){
    const tagStart = m.index
    const innerStart = m.index + m[0].indexOf('>') + 1
    const innerEnd = m.index + m[0].length - '</w:t>'.length
    runs.push({ tagStart, innerStart, innerEnd, inner: m[1] })
  }
  const texts = runs.map(r => unesc(r.inner))
  return { runs, texts }
}

// editsMap: Map<runIndex, newUnescapedInner>
function editRuns(xml, editsMap){
  const { runs } = tokenize(xml)
  const idx = [...editsMap.keys()].sort((a,b)=>b-a)
  for(const i of idx){
    const r = runs[i]
    const repl = `<w:t xml:space="preserve">${esc(editsMap.get(i))}</w:t>`
    xml = xml.slice(0, r.tagStart) + repl + xml.slice(r.innerEnd + '</w:t>'.length)
  }
  return xml
}

function locate(texts, target, occ){
  // returns {r0,r1,localStart,localEnd} for occ-th occurrence in the concat, or null
  const bounds = []
  let acc = 0
  for(const t of texts){ bounds.push(acc); acc += t.length }
  const full = texts.join('')
  let from = 0, found = -1, seen = 0
  for(;;){
    const p = full.indexOf(target, from)
    if(p < 0) break
    if(occ === 'all' || seen === occ){ found = p; if(occ !== 'all') break }
    seen++; from = p + Math.max(1,target.length)
    if(occ === 'all' && found>=0) break
  }
  if(occ === 'all'){
    // handled by caller looping; here return first
  }
  if(found < 0) return null
  const start = found, end = found + target.length
  const runOf = (pos, isEnd) => {
    for(let i=0;i<texts.length;i++){
      const s = bounds[i], e = bounds[i] + texts[i].length
      if(isEnd){ if(pos > s && pos <= e) return i } else { if(pos >= s && pos < e) return i }
    }
    return texts.length - 1
  }
  const r0 = runOf(start,false), r1 = runOf(end,true)
  return { r0, r1, localStart: start - bounds[r0], localEnd: end - bounds[r1] }
}

function paraReplace(xml, target, ph, occ='all'){
  if(occ === 'all'){
    let guard = 0
    for(;;){
      const { texts } = tokenize(xml)
      const loc = locate(texts, target, 0)
      if(!loc) break
      xml = applyLoc(xml, texts, loc, ph)
      if(++guard > 200) throw new Error('loop guard '+target)
    }
    if(guard === 0) throw new Error('NOT FOUND (all): '+target)
    return xml
  } else {
    const { texts } = tokenize(xml)
    const loc = locate(texts, target, occ)
    if(!loc) throw new Error(`NOT FOUND (occ ${occ}): ${target}`)
    return applyLoc(xml, texts, loc, ph)
  }
}

function applyLoc(xml, texts, loc, ph){
  const { r0, r1, localStart, localEnd } = loc
  const edits = new Map()
  if(r0 === r1){
    edits.set(r0, texts[r0].slice(0,localStart) + ph + texts[r0].slice(localEnd))
  } else {
    edits.set(r0, texts[r0].slice(0,localStart) + ph)
    for(let i=r0+1;i<r1;i++) edits.set(i,'')
    edits.set(r1, texts[r1].slice(localEnd))
  }
  return editRuns(xml, edits)
}

// find <w:tc ...>...</w:tc> spans (non-nested assumption) and set occ-th whose
// stripped text === cellText to a single placeholder run.
function cellSet(xml, cellText, ph, occ=0){
  const re = /<w:tc\b[\s\S]*?<\/w:tc>/g
  let m, seen = 0
  while((m = re.exec(xml))){
    const span = m[0]
    const inners = [...span.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(x=>unesc(x[1]))
    const txt = inners.join('').trim()
    if(txt === cellText){
      if(seen === occ){
        // edit runs within this tc: first -> ph, rest -> ''
        const abs = m.index
        const { runs } = tokenize(xml)
        const within = runs.map((r,i)=>({r,i})).filter(o=>o.r.tagStart>=abs && o.r.tagStart<abs+span.length)
        const edits = new Map()
        within.forEach((o,k)=> edits.set(o.i, k===0 ? ph : ''))
        return editRuns(xml, edits)
      }
      seen++
    }
  }
  throw new Error(`CELL NOT FOUND occ ${occ}: ${cellText}`)
}

async function build(name, srcFile, fn){
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(SRC, srcFile)))
  let xml = await zip.file('word/document.xml').async('string')
  xml = fn(xml)
  zip.file('word/document.xml', xml)
  const buf = await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE', compressionOptions:{ level:6 } })
  fs.writeFileSync(path.join(OUT, name + '.docx'), buf)
  console.log('OK', name, buf.length, 'bytes')
}

// ---- per-document replacement specs ----
const P = (s)=>s // marker

await build('visa1_invitation','94f688b9-Invitation_Letter_Ahmed_Saleh.docx', (xml)=>{
  xml = paraReplace(xml, 'JV LLC “ARTIKUL AZIYA KABEL”', '{{company_en}}')
  xml = paraReplace(xml, '115, Fayzli street, Yangihayot district, Tashkent', '{{company_address_en}}')
  xml = paraReplace(xml, 'Ahmad Saleh Eid Muhammad', '{{full_name}}')
  xml = paraReplace(xml, 'Arab Republic of Egypt', '{{citizenship_en}}')
  xml = paraReplace(xml, 'A37041987', '{{passport}}')
  xml = paraReplace(xml, 'Planning engineer', '{{position}}')
  xml = paraReplace(xml, 'GM operations', '{{position}}')
  xml = paraReplace(xml, '30.07.2026', '{{stay_from}}')
  xml = paraReplace(xml, '25.12.2026', '{{stay_to}}')
  xml = paraReplace(xml, 'Turgunov Sh.A.', '{{director}}')
  return xml
})

await build('visa2_kafolat','9dc3fda2-Kafolat_xati_Ahmed_Saleh.docx', (xml)=>{
  xml = paraReplace(xml, 'Chiqish raqami _______', 'Chiqish raqami {{out_no}}')
  xml = paraReplace(xml, '2026 yil « ___ » ______', '{{doc_date}}')
  xml = paraReplace(xml, 'Misr Arab Respublikasi', '{{citizenship_sentence}}')
  xml = paraReplace(xml, '“Artikul Aziya Kabel” MCHJ QK', '{{company}}')
  xml = paraReplace(xml, 'Ahmed Saleh', '{{full_name}}')
  xml = paraReplace(xml, '25.02.1979', '{{dob}}')
  xml = paraReplace(xml, 'Kalyobiya', '{{birthplace}}')
  xml = paraReplace(xml, 'Misr', '{{citizenship}}')
  xml = paraReplace(xml, 'A37041987', '{{passport}}')
  xml = cellSet(xml, 'M', '{{sex}}', 0)
  xml = paraReplace(xml, 'GM operations', '{{position}}')
  xml = paraReplace(xml, 'Turgunov Sh.A.', '{{director}}')
  return xml
})

await build('visa3_talabnoma','82047ae6-Viza_talabnomasi_Ahmed_Saleh.docx', (xml)=>{
  xml = paraReplace(xml, 'Chiqish raqami _______', 'Chiqish raqami {{out_no}}')
  xml = paraReplace(xml, '2026 yil « ___ » ______', '{{doc_date}}')
  xml = paraReplace(xml, '“Artikul Aziya Kabel” MCHJ QK', '{{company}}', 'all')
  xml = paraReplace(xml, 'Ahmed Saleh', '{{full_name}}')
  xml = paraReplace(xml, '25.02.1979', '{{dob}}')
  xml = paraReplace(xml, 'Kalyobiya', '{{birthplace}}')
  xml = paraReplace(xml, 'Misr', '{{citizenship}}')
  xml = paraReplace(xml, 'A37041987', '{{passport}}')
  xml = cellSet(xml, 'M', '{{sex}}', 0)
  xml = paraReplace(xml, 'GM operations', '{{position}}')
  // numbered rows
  xml = cellSet(xml, 'ko‘p martalik', '{{entries}}', 0)
  xml = paraReplace(xml, '30.07.2026', '{{travel_from}}')
  xml = paraReplace(xml, '25.12.2026', '{{travel_to}}')
  xml = cellSet(xml, 'Qohira shahridagi O’zbekiston elchixonasi', '{{visa_place}}', 0)
  // purpose cell ("…MCHJ QKda ishlash uchun") auto-derives from {{company}} above
  xml = cellSet(xml, 'Toshkent', '{{cities}}', 0)
  xml = cellSet(xml, '“Simma” mehmonxonasi', '{{residence}}', 0)
  xml = cellSet(xml, '№2013433, 17.10.2014', '{{reg_justice}}', 0)
  xml = cellSet(xml, '20610', '{{reg_consular}}', 0)
  xml = cellSet(xml, 'Jurayev N. +998(93) 433 30 33', '{{responsible}}', 0)
  xml = cellSet(xml, 'Ganiev H. +998(90) 951 61 00', '{{greeter}}', 0)
  xml = paraReplace(xml, 'Turgunov Sh.A.', '{{director}}')
  return xml
})

await build('iio1_kafolat','523e05ce-IIO_FMB_MvaPB.docx', (xml)=>{
  xml = paraReplace(xml, '2026 yil « ___ » ______', '{{doc_date}}')
  xml = paraReplace(xml, 'YANGIHAYOT IIO FMB MvaPB', '{{district_office}}')
  xml = paraReplace(xml, 'Xitoy', '{{citizenship}}', 'all')
  xml = paraReplace(xml, 'Mao Hunyu', '{{full_name}}')
  xml = paraReplace(xml, '12.10.1995', '{{dob}}')
  xml = paraReplace(xml, 'Jilin', '{{birthplace}}')
  xml = paraReplace(xml, 'EL7770384', '{{passport}}')
  xml = cellSet(xml, 'Erkak', '{{sex}}', 0)
  xml = paraReplace(xml, '“Artikul Aziya Kabel” MCHJ QK', '{{company}}', 'all')
  xml = paraReplace(xml, 'ishlash uchun', '{{position}}')
  xml = paraReplace(xml, 'Turgunov Sh.A.', '{{director}}')
  return xml
})

await build('iio2_royxat','ded48e95-Royxatga_olish_talabnomasi.docx', (xml)=>{
  xml = paraReplace(xml, 'Mohammad Anas', '{{full_name}}')
  xml = paraReplace(xml, 'Farzandlari: yo‘q', 'Farzandlari: {{children}}')
  xml = paraReplace(xml, 'Hindiston', '{{citizenship}}')
  xml = paraReplace(xml, 'Jinsi: Erkak', 'Jinsi: {{sex}}')
  xml = paraReplace(xml, 'Uttar Pradesh', '{{birthplace}}')
  xml = paraReplace(xml, '09.01.1999', '{{dob}}')
  xml = paraReplace(xml, '“Artikul Aziya Kabel” MCHJ QK', '{{company}}', 'all')
  xml = paraReplace(xml, 'S8018606', '{{passport}}')
  xml = paraReplace(xml, 'B2, 4933652', '{{visa_type}}, {{visa_no}}')
  xml = paraReplace(xml, '“Alukabel Payrav” MCHJ XK', '{{visa_issuer}}')
  xml = paraReplace(xml, '18.08.2026', '{{visa_from}}')
  xml = paraReplace(xml, '18.08.2027', '{{visa_to}}')
  xml = paraReplace(xml, '180 kun', '{{visa_days}} kun')
  xml = paraReplace(xml, 'Ganiev Hasan', '{{responsible}}')
  xml = paraReplace(xml, 'Turgunov Sh.A.', '{{director}}')
  return xml
})

console.log('done ->', OUT)
