// Build the Uzbek Talabnoma template from the Russian pretenzia.docx template.
// Same span surgery as build-pretenzia.mjs, but here each Russian paragraph
// (with its {{placeholders}}) is swapped for the Uzbek translation, reordering
// placeholders to Uzbek word order where needed. Layout + letterhead preserved.
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const DIR = path.join(process.cwd(), 'src/lib/documents/templates')
const SRC = path.join(DIR, 'pretenzia.docx')

const unesc = (s) => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/ /g,' ')
const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

function tokenize(xml){
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
  const runs = []
  let m
  while((m = re.exec(xml))){
    const innerEnd = m.index + m[0].length - '</w:t>'.length
    runs.push({ tagStart: m.index, innerEnd, inner: m[1] })
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
  return { r0: runOf(start,false), r1: runOf(end,true), localStart: start - bounds[runOf(start,false)], localEnd: end - bounds[runOf(end,true)] }
}
function replace(xml, target, repl){
  const { texts } = tokenize(xml)
  const loc = locate(texts, target)
  if(!loc) throw new Error('NOT FOUND: '+JSON.stringify(target))
  const { r0, r1, localStart, localEnd } = loc
  const edits = new Map()
  if(r0 === r1){
    edits.set(r0, texts[r0].slice(0,localStart) + repl + texts[r0].slice(localEnd))
  } else {
    edits.set(r0, texts[r0].slice(0,localStart) + repl)
    for(let i=r0+1;i<r1;i++) edits.set(i,'')
    edits.set(r1, texts[r1].slice(localEnd))
  }
  return editRuns(xml, edits)
}

// [RU paragraph text in the template]  →  [Uzbek translation]
const MAP = [
  ['{{claim_date}}г.', '{{claim_date}} y.'],
  ['г.Ташкент', 'Toshkent sh.'],
  ['АО «{{debtor_name}}» г.Ташкент {{debtor_address}}', '«{{debtor_name}}» AJ  {{debtor_address}}'],
  ['ПРЕТЕНЗИЯ', 'TALABNOMA'],
  ['Между СП ООО «{{creditor_name}}» и АО «{{debtor_name}}» был заключён нижеуказанный договор, по которому со стороны Покупателя обязательства по оплате надлежащим образом не исполнялись:',
   '«{{creditor_name}}» QK MChJ bilan «{{debtor_name}}» AJ oʻrtasida quyidagi shartnoma tuzilgan boʻlib, unga koʻra Xaridor tomonidan toʻlov boʻyicha majburiyatlar lozim darajada bajarilmagan:'],
  ['по договору № {{contract_no}} от {{contract_date}} года был поставлен Товар на общую сумму {{supplied}} сум {{payment_clause}}. ',
   '{{contract_date}} yildagi {{contract_no}}-sonli shartnoma boʻyicha jami {{supplied}} soʻmlik Tovar yetkazib berilgan {{payment_clause}}. '],
  ['Согласно условиям договора, оплата должна быть произведена в течение 5 банковских дней после принятия товара. Согласно пункту 4.1 Договора, ответственность Сторон регулируется законодательством Республики Узбекистан, в соответствии со статьей 25 Закона «О договорно-правовой базе деятельности хозяйствующих субъектов» которой начисляется законная пеня в размере 0,4% от суммы просроченного платежа за каждый день просрочки (не более 50% от суммы задолженности).',
   'Shartnoma shartlariga koʻra, toʻlov tovar qabul qilinganidan soʻng 5 bank kuni ichida amalga oshirilishi lozim. Shartnomaning 4.1-bandiga muvofiq, Tomonlarning javobgarligi Oʻzbekiston Respublikasi qonunchiligi bilan tartibga solinadi va «Xoʻjalik yurituvchi subyektlar faoliyatining shartnomaviy-huquqiy bazasi toʻgʻrisida»gi Qonunning 25-moddasiga asosan, muddati oʻtkazib yuborilgan toʻlov summasidan har bir kechiktirilgan kun uchun 0,4% miqdorida penya hisoblanadi (qarz summasining 50% dan oshmagan holda).'],
  ['Итого по состоянию на текущую дату задолженность составляет:', 'Joriy sanaga koʻra jami qarzdorlik quyidagicha:'],
  ['– основной долг: {{main_debt}} сум.', '– asosiy qarz: {{main_debt}} soʻm.'],
  ['– пеня за {{days}} {{day_word}} просрочки (с {{delay_start}} г.):', '– {{days}} {{day_word}} kechikish uchun penya ({{delay_start}} y. dan):'],
  ['{{main_debt}} сум x 0.4% x {{days}} {{day_word}} = {{penalty}} сум.', '{{main_debt}} soʻm x 0.4% x {{days}} {{day_word}} = {{penalty}} soʻm.'],
  ['Общая сумма задолженности: {{main_debt}} ({{main_debt_words}}) сум.', 'Umumiy qarzdorlik summasi: {{main_debt}} ({{main_debt_words}}) soʻm.'],
  ['Общая сумма пени: {{penalty}} ({{penalty_words}}) сум.', 'Umumiy penya summasi: {{penalty}} ({{penalty_words}}) soʻm.'],
  ['В случае неуплаты вышеуказанных сумм мы будем вынуждены обратиться в {{court_name}} для принудительного взыскания с АО «{{debtor_name}}» основного долга, пени, а также всех судебных расходов.',
   'Yuqorida koʻrsatilgan summalar toʻlanmagan taqdirda, biz «{{debtor_name}}» AJ dan asosiy qarz, penya, shuningdek barcha sud xarajatlarini majburiy undirish uchun {{court_name}}ga murojaat qilishga majbur boʻlamiz.'],
  ['Срок для добровольного исполнения требований настоящей претензии – в течение 3 (трёх) дней со дня её получения.',
   'Ushbu talabnoma talablarini ixtiyoriy bajarish muddati – uni olgan kundan boshlab 3 (uch) kun ichida.'],
  ['Генеральный директор:', 'Bosh direktor:'],
  ['Исп. {{executor}} ', 'Ijrochi: {{executor}} '],
]

const zip = await JSZip.loadAsync(fs.readFileSync(SRC))
let xml = await zip.file('word/document.xml').async('string')
for (const [ru, uz] of MAP) xml = replace(xml, ru, uz)
zip.file('word/document.xml', xml)
const buf = await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE', compressionOptions:{ level:6 } })
fs.writeFileSync(path.join(DIR, 'talabnoma-uz.docx'), buf)
console.log('OK talabnoma-uz.docx', buf.length, 'bytes')
