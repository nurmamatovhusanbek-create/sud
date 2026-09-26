// Build the Претензия/Talabnoma template from a real sample letter.
// Byte-precise span surgery on word/document.xml (same approach as
// build-templates.mjs): collapse each variable value into a single
// {{placeholder}} run so runtime filling is a trivial string replace.
//
// Base sample: the K1125545 letter (partial-payment variant) — it exercises
// the «(частичная оплата …)» clause; the no-payment wording is produced at
// fill time via {{payment_clause}}.
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const SRC = '/root/.claude/uploads/eefe577e-0365-5422-b318-9c523988a4c3'
const BASE = '3f9a41f2-Talabnoma_K1125545_HET_17_09_2026.docx'
const OUT = path.join(process.cwd(), 'src/lib/documents/templates')

const unesc = (s) => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/ /g,' ')
const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

function tokenize(xml){
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
  const runs = []
  let m
  while((m = re.exec(xml))){
    const innerStart = m.index + m[0].indexOf('>') + 1
    const innerEnd = m.index + m[0].length - '</w:t>'.length
    runs.push({ tagStart: m.index, innerStart, innerEnd, inner: m[1] })
  }
  return { runs, texts: runs.map(r => unesc(r.inner)) }
}

function editRuns(xml, editsMap){
  const { runs } = tokenize(xml)
  for(const i of [...editsMap.keys()].sort((a,b)=>b-a)){
    const r = runs[i]
    const repl = `<w:t xml:space="preserve">${esc(editsMap.get(i))}</w:t>`
    xml = xml.slice(0, r.tagStart) + repl + xml.slice(r.innerEnd + '</w:t>'.length)
  }
  return xml
}

function locate(texts, target){
  const bounds = []
  let acc = 0
  for(const t of texts){ bounds.push(acc); acc += t.length }
  const full = texts.join('')
  const found = full.indexOf(target)
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

function replace(xml, target, ph, { all=false }={}){
  let guard = 0, hit = false
  for(;;){
    const { texts } = tokenize(xml)
    const loc = locate(texts, target)
    if(!loc) break
    xml = applyLoc(xml, texts, loc, ph)
    hit = true
    if(!all) break
    if(++guard > 200) throw new Error('loop guard: '+target)
  }
  if(!hit) throw new Error('NOT FOUND: '+target)
  return xml
}

const zip = await JSZip.loadAsync(fs.readFileSync(path.join(SRC, BASE)))
let xml = await zip.file('word/document.xml').async('string')

// Order: longest / most-specific first so no target is a substring of another.
xml = replace(xml, 'пять миллиардов пятьсот тридцать восемь миллионов семьсот тридцать тысяч пятьсот восемнадцать сум 42 тийин', '{{main_debt_words}}')
xml = replace(xml, 'два миллиарда сто семьдесят один миллион сто восемьдесят две тысячи триста шестьдесят три сум 22 тийин', '{{penalty_words}}')
xml = replace(xml, '(частичная оплата составила 272 628 881,58 сум)', '{{payment_clause}}')
xml = replace(xml, 'Юнусабадский район ул. Осиё 8-дом', '{{debtor_address}}')
xml = replace(xml, 'Ташкентский межрайонный экономический суд', '{{court_name}}')
xml = replace(xml, 'HUDUDIY ELEKTR TARMOQLARI', '{{debtor_name}}', { all: true })
xml = replace(xml, 'ARTIKUL AZIYA KABEL', '{{creditor_name}}')
xml = replace(xml, '5 811 359 400,00', '{{supplied}}')
xml = replace(xml, '5 538 730 518,42', '{{main_debt}}', { all: true })
xml = replace(xml, '2 171 182 363,22', '{{penalty}}', { all: true })
xml = replace(xml, '98 дней', '{{days}} {{day_word}}', { all: true })
xml = replace(xml, '05.06.2026', '{{contract_date}}')
xml = replace(xml, '12.06.2026', '{{delay_start}}')
xml = replace(xml, '17.09.2026', '{{claim_date}}')
xml = replace(xml, 'K1125545', '{{contract_no}}')
xml = replace(xml, 'Тургунов Ш.А.', '{{director}}')
xml = replace(xml, 'Нурмаматов Ҳ.', '{{executor}}')
xml = replace(xml, '+998 91 773 22 72', '{{executor_phone}}')

zip.file('word/document.xml', xml)
const buf = await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE', compressionOptions:{ level:6 } })
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'pretenzia.docx'), buf)
console.log('OK pretenzia.docx', buf.length, 'bytes')
