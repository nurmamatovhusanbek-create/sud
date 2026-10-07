// Offline template generator: turn the real .docx into {{placeholder}} templates.
// Byte-precise string surgery on word/document.xml (no DOM reserialization),
// so Word compatibility is preserved. Collapses run-fragmented values into a
// single placeholder run; run-time filling is then trivial {{key}} replace.
//
// The helpers live in xml-edit.mjs (shared with build-iio.mjs). The two IIO templates (iio1_kafolat, iio2_royxat) are
// built by build-iio.mjs, which finds values by PLACE instead of by value (so it holds no personal data).
import fs from 'node:fs'
import path from 'node:path'
import { JSZip, paraReplace, cellSet, scrubPackage, writeZip } from './xml-edit.mjs'

const SRC = process.env.SRC || '/root/.claude/uploads/eefe577e-0365-5422-b318-9c523988a4c3'
const OUT = process.argv[2] || '/tmp/out-templates'
fs.mkdirSync(OUT, { recursive: true })

async function build(name, srcFile, fn){
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(SRC, srcFile)))
  let xml = await zip.file('word/document.xml').async('string')
  xml = fn(xml)
  zip.file('word/document.xml', xml)
  await scrubPackage(zip) // no preview image of the original, no author names
  const bytes = await writeZip(zip, path.join(OUT, name + '.docx'), fs)
  console.log('OK', name, bytes, 'bytes')
}

// ---- per-document replacement specs ----
const P = (s)=>s // marker

await build('visa1_invitation','94f688b9-Invitation_Letter_Person_Person.docx', (xml)=>{
  xml = paraReplace(xml, 'JV LLC “ARTIKUL AZIYA KABEL”', '{{company_en}}')
  xml = paraReplace(xml, '115, Fayzli street, Yangihayot district, Tashkent', '{{company_address_en}}')
  xml = paraReplace(xml, 'Test Person', '{{full_name}}')
  xml = paraReplace(xml, 'Arab Republic of Egypt', '{{citizenship_en}}')
  xml = paraReplace(xml, 'ZZ 0000000', '{{passport}}')
  // Two distinct role spots kept as separate fields: the sentence role
  // ("invites the …") vs the Subject/Position line.
  xml = paraReplace(xml, 'Planning engineer', '{{role_en}}')
  xml = paraReplace(xml, 'GM operations', '{{position}}')
  xml = paraReplace(xml, '30.07.2026', '{{stay_from}}')
  xml = paraReplace(xml, '25.12.2026', '{{stay_to}}')
  xml = paraReplace(xml, 'Turgunov Sh.A.', '{{director}}')
  return xml
})

await build('visa2_kafolat','9dc3fda2-Kafolat_xati_Person_Person.docx', (xml)=>{
  xml = paraReplace(xml, 'Chiqish raqami _______', 'Chiqish raqami {{out_no}}')
  xml = paraReplace(xml, '2026 yil « ___ » ______', '{{doc_date}}')
  xml = paraReplace(xml, 'Misr Arab Respublikasi', '{{citizenship_sentence}}')
  xml = paraReplace(xml, '“Artikul Aziya Kabel” MCHJ QK', '{{company}}')
  xml = paraReplace(xml, 'Test Person', '{{full_name}}')
  xml = paraReplace(xml, '01.01.2000', '{{dob}}')
  xml = paraReplace(xml, 'Person', '{{birthplace}}')
  xml = paraReplace(xml, 'Misr', '{{citizenship}}')
  xml = paraReplace(xml, 'ZZ 0000000', '{{passport}}')
  xml = cellSet(xml, 'M', '{{sex}}', 0)
  xml = paraReplace(xml, 'GM operations', '{{position}}')
  xml = paraReplace(xml, 'Turgunov Sh.A.', '{{director}}')
  return xml
})

await build('visa3_talabnoma','82047ae6-Viza_talabnomasi_Person_Person.docx', (xml)=>{
  xml = paraReplace(xml, 'Chiqish raqami _______', 'Chiqish raqami {{out_no}}')
  xml = paraReplace(xml, '2026 yil « ___ » ______', '{{doc_date}}')
  xml = paraReplace(xml, '“Artikul Aziya Kabel” MCHJ QK', '{{company}}', 'all')
  xml = paraReplace(xml, 'Test Person', '{{full_name}}')
  xml = paraReplace(xml, '01.01.2000', '{{dob}}')
  xml = paraReplace(xml, 'Person', '{{birthplace}}')
  xml = paraReplace(xml, 'Misr', '{{citizenship}}')
  xml = paraReplace(xml, 'ZZ 0000000', '{{passport}}')
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
  xml = cellSet(xml, 'Person N. +998 00 000 00 00', '{{responsible}}', 0)
  xml = cellSet(xml, 'Person H. +998 00 000 00 00', '{{greeter}}', 0)
  xml = paraReplace(xml, 'Turgunov Sh.A.', '{{director}}')
  return xml
})

// iio1_kafolat and iio2_royxat: see build-iio.mjs (built from the 2026-10 originals, values located by place)

// ---- court petitions (Sud arizalari) ----------------------------------------

await build('court_copy', '211051e2-ish_hujjatlaridan_nusxa_olish_to_g_risida.docx', (xml) => {
  xml = paraReplace(xml, 'Toshkent tumanlararo iqtisodiy sud', '{{court}}', 'all')
  xml = paraReplace(xml, 'Test Person', '{{judge}}')
  xml = paraReplace(xml, '0-0000-0000/00000', '{{case_number}}', 'all')
  xml = paraReplace(xml, '“ARTIKUL AZIYA KABEL” MCHJ QK', '{{company}}', 'all')
  xml = paraReplace(xml, 'Test Person', '{{rep_name}}')
  xml = paraReplace(xml, 'Toshkent shahar, Yangihayot tumani, Janubiy sanoat hududi, Fayzli MFY', '{{address}}')
  xml = paraReplace(xml, '“Toshkent shahar suv ta`minoti” AJ', '{{plaintiff}}')
  xml = paraReplace(xml, 'kommunal xizmat ko‘rsatish shartnomasi', '{{contract_subject}}')
  xml = paraReplace(xml, '2026-yil 8-sentyabr', '{{hearing_date}}')
  xml = paraReplace(xml, '10:05', '{{hearing_time}}')
  return xml
})

await build('court_postpone', 'e0eb5ba2-sud_majlisini_keyinga_qoldirish_to_g_risida.docx', (xml) => {
  xml = paraReplace(xml, 'Toshkent tumanlararo iqtisodiy sud', '{{court}}', 'all')
  xml = paraReplace(xml, 'Test Person', '{{judge}}')
  xml = paraReplace(xml, '0-0000-0000/00000', '{{case_number}}', 'all')
  // reason paragraph BEFORE company (it contains the company name)
  xml = paraReplace(xml, 'Hozirgi kunda “ARTIKUL AZIYA KABEL” MCHJ QK oldida qarzdor “CHIMQURG‘ON SERVIS INVEST” MCHJga nisbatan toʻlovga qobiliyatsizlik toʻgʻrisidagi ish yuritilayotgan boʻlib, aynan sud majlisi kuni mazkur toʻlovga qobiliyatsizlik ishi boʻyicha kreditorlar yigʻilishida ishtirok etishimiz zarur boʻlib qolmoqda.', '{{reason}}')
  xml = paraReplace(xml, '“ARTIKUL AZIYA KABEL” MCHJ QK', '{{company}}', 'all')
  xml = paraReplace(xml, 'Test Person', '{{rep_name}}')
  xml = paraReplace(xml, 'Toshkent shahar, Yangihayot tumani, Janubiy sanoat hududi, Fayzli MFY', '{{address}}')
  xml = paraReplace(xml, '“Toshkent shahar suv ta`minoti” AJ', '{{plaintiff}}')
  xml = paraReplace(xml, 'kommunal xizmat ko‘rsatish shartnomasi', '{{contract_subject}}')
  xml = paraReplace(xml, 'Iqtisodiy protsessual kodeksining 42, 43 va 171-moddalari', '{{legal_basis}}')
  xml = paraReplace(xml, '2026-yil 8-sentyabr', '{{hearing_date}}', 'all')
  xml = paraReplace(xml, '10:05', '{{hearing_time}}', 'all')
  xml = paraReplace(xml, '+998 00 000 00 00', '{{phone}}')
  return xml
})

await build('court_deadline', '1b4c14b2-Muddatni_tiklash_togrisida.docx', (xml) => {
  xml = paraReplace(xml, 'Shayxontohur tumanlararo fuqarolik sud', '{{court}}', 'all')
  xml = paraReplace(xml, 'Test Person Person', '{{applicant_person}}')
  xml = paraReplace(xml, '+998 00 000 00 00', '{{phone}}')
  xml = paraReplace(xml, 'ZZ 0000000', '{{passport}}')
  return xml
})

await build('court_cancel', 'f296cd33-Sud_buyrugi_bekor.docx', (xml) => {
  // wording fix: the source doubles "sudi sudi"
  xml = paraReplace(xml, 'tumanlararo sudi sudi tomonidan', 'tumanlararo sudi tomonidan')
  xml = paraReplace(xml, 'Fuqarolik ishlari bo‘yicha Yakkasaroy tumanlararo sud', '{{court}}', 'all')
  xml = paraReplace(xml, '“Artikul Aziya Kabel” MCHJ QK', '{{company}}', 'all')
  xml = paraReplace(xml, 'Test Person', '{{rep_name}}')
  xml = paraReplace(xml, '12.08.2026', '{{order_date}}', 'all')
  xml = paraReplace(xml, '0-0000-0000/00000', '{{order_number}}', 'all')
  xml = paraReplace(xml, 'Yangihayot tumani Kambag‘allikni qisqartirish va bandlikka ko‘maklashish bo‘limi (Person Person Person nomidan)', '{{beneficiary}}')
  xml = paraReplace(xml, '8 032 742', '{{amount}}')
  xml = paraReplace(xml, 'Turg‘unov Sh.A', '{{director}}')
  xml = paraReplace(xml, 'Person D.+998 00 000 00 00', '{{executor}}')
  return xml
})

console.log('done ->', OUT)
