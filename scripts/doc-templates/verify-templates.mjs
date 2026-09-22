// Round-trip: fill each template with the ORIGINAL values, extract text, and
// compare to the original doc's text. Also assert no residual PII remains.
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const SRC='/root/.claude/uploads/eefe577e-0365-5422-b318-9c523988a4c3'
const TPL='./out-templates'
const unesc=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'")
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
async function xmlOf(buf){ const z=await JSZip.loadAsync(buf); return z.file('word/document.xml').async('string') }
const textOf=xml=>[...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m=>unesc(m[1])).join('')
function fill(xml, vals){ for(const [k,v] of Object.entries(vals)) xml=xml.split('{{'+k+'}}').join(esc(v)); return xml }

const cases={
 visa1_invitation:{ src:'94f688b9-Invitation_Letter_Ahmed_Saleh.docx', vals:{
   company_en:'JV LLC “ARTIKUL AZIYA KABEL”', company_address_en:'115, Fayzli street, Yangihayot district, Tashkent',
   full_name:'Ahmad Saleh Eid Muhammad', citizenship_en:'Arab Republic of Egypt', passport:'A37041987',
   role_en:'Planning engineer', position:'GM operations', stay_from:'30.07.2026', stay_to:'25.12.2026', director:'Turgunov Sh.A.' } },
 visa2_kafolat:{ src:'9dc3fda2-Kafolat_xati_Ahmed_Saleh.docx', vals:{
   out_no:'_______', doc_date:'2026 yil « ___ » ______', citizenship_sentence:'Misr Arab Respublikasi',
   company:'“Artikul Aziya Kabel” MCHJ QK', full_name:'Ahmed Saleh', dob:'25.02.1979', birthplace:'Kalyobiya',
   citizenship:'Misr', passport:'A37041987', sex:'M', position:'GM operations', director:'Turgunov Sh.A.' } },
 visa3_talabnoma:{ src:'82047ae6-Viza_talabnomasi_Ahmed_Saleh.docx', vals:{
   out_no:'_______', doc_date:'2026 yil « ___ » ______', company:'“Artikul Aziya Kabel” MCHJ QK',
   full_name:'Ahmed Saleh', dob:'25.02.1979', birthplace:'Kalyobiya', citizenship:'Misr', passport:'A37041987',
   sex:'M', position:'GM operations', entries:'ko‘p martalik', travel_from:'30.07.2026', travel_to:'25.12.2026',
   visa_place:'Qohira shahridagi O’zbekiston elchixonasi', cities:'Toshkent', residence:'“Simma” mehmonxonasi',
   reg_justice:'№2013433, 17.10.2014', reg_consular:'20610', responsible:'Jurayev N. +998(93) 433 30 33',
   greeter:'Ganiev H. +998(90) 951 61 00', director:'Turgunov Sh.A.' } },
 iio1_kafolat:{ src:'523e05ce-IIO_FMB_MvaPB.docx', vals:{
   doc_date:'2026 yil « ___ » ______', district_office:'YANGIHAYOT IIO FMB MvaPB', citizenship:'Xitoy',
   full_name:'Mao Hunyu', dob:'12.10.1995', birthplace:'Jilin', passport:'EL7770384', sex:'Erkak',
   company:'“Artikul Aziya Kabel” MCHJ QK', position:'ishlash uchun', director:'Turgunov Sh.A.' } },
 iio2_royxat:{ src:'ded48e95-Royxatga_olish_talabnomasi.docx', vals:{
   full_name:'Mohammad Anas', children:'yo‘q', citizenship:'Hindiston', sex:'Erkak', birthplace:'Uttar Pradesh',
   dob:'09.01.1999', company:'“Artikul Aziya Kabel” MCHJ QK', passport:'S8018606', visa_type:'B2', visa_no:'4933652',
   visa_issuer:'“Alukabel Payrav” MCHJ XK', visa_from:'18.08.2026', visa_to:'18.08.2027', visa_days:'180',
   responsible:'Ganiev Hasan', director:'Turgunov Sh.A.' } },
}

const PII=['Ahmed Saleh','Ahmad Saleh','Mao Hunyu','Mohammad Anas','A37041987','EL7770384','S8018606','4933652','Jurayev','Ganiev','Kalyobiya','Jilin','Uttar Pradesh']
let fail=0
for(const [name,c] of Object.entries(cases)){
  const origXml=await xmlOf(fs.readFileSync(path.join(SRC,c.src)))
  const tplXml=await xmlOf(fs.readFileSync(path.join(TPL,name+'.docx')))
  const orig=textOf(origXml)
  const filled=fill(tplXml, c.vals)
  const got=textOf(filled)
  // residual placeholder check
  const leftover=[...filled.matchAll(/\{\{[a-z_]+\}\}/g)].map(m=>m[0])
  // residual PII in the raw TEMPLATE (before fill)
  const tplText=textOf(tplXml)
  const residualPII=PII.filter(p=>tplText.includes(p))
  const same = got===orig
  console.log(`\n== ${name} ==`)
  console.log('  round-trip text identical:', same)
  console.log('  unfilled placeholders left:', leftover.length? leftover.join(','):'none')
  console.log('  residual PII in template  :', residualPII.length? residualPII.join(','):'none')
  if(!same && !c.allowDiff){
    fail++
    // show first divergence
    let i=0; while(i<Math.min(got.length,orig.length)&&got[i]===orig[i]) i++
    console.log('  DIVERGES at', i)
    console.log('   orig:', JSON.stringify(orig.slice(i-20,i+40)))
    console.log('   got :', JSON.stringify(got.slice(i-20,i+40)))
  }
  if(same && c.allowDiff) console.log('  (allowDiff set but identical anyway)')
  if(!same && c.allowDiff){
    let i=0; while(i<Math.min(got.length,orig.length)&&got[i]===orig[i]) i++
    console.log('  expected diff (position unification). first diff at',i)
    console.log('   orig:', JSON.stringify(orig.slice(i-10,i+30)))
    console.log('   got :', JSON.stringify(got.slice(i-10,i+30)))
  }
  if(leftover.length||residualPII.length) fail++
}
console.log('\nFAILURES:', fail)
process.exit(fail?1:0)
