// Where the variable values sit in the two IIO documents, by PLACE (table cell / label / marker), never by value.
// The builder turns each spot into a {{key}} placeholder; the verifier reads the same spots from the original to get
// the values back and checks the round trip. No name, passport number or phone number is written down anywhere here.
//
//   key   the placeholder (a field in src/lib/documents/registry.ts)
//   sel   { tbl, row, cell, p } | { find: 'phrase' }  — which paragraph
//   sub   { from, fromLast, to, trim }                — which part of it (default: all of it)
//   ph    a literal replacement instead of {{key}} ('' = delete the text; such a spec has no key)
//   keep  the value is a company constant, not personal data (the PII check skips it)

// ---- IIO / Kafolat xati (guarantee letter to the district MvaPB) -----------------------------------------------
export const IIO1_FILE = 'f3ace04c-IIO_FMB_MvaPB.docx'
export const IIO1 = [
  { key: 'doc_date', sel: { tbl: 0, row: 1, cell: 0, p: 0 }, keep: true },
  { key: 'district_office', sel: { tbl: 0, row: 0, cell: 1, p: 1 }, sub: { to: ' BOSHLIG‘IGA' }, keep: true },
  { key: 'company', sel: { find: 'Ushbu xat bilan' }, sub: { from: 'bilan, ', to: ', mazkur' }, keep: true },
  { key: 'citizenship', sel: { find: 'Ushbu xat bilan' }, sub: { from: 'taklif etilayotgan ', to: ' fuqaros' } },
  { key: 'full_name', sel: { tbl: 1, row: 2, cell: 1, p: 0 } },
  { key: 'dob', sel: { tbl: 1, row: 2, cell: 2, p: 0 } },
  { key: 'birthplace', sel: { tbl: 1, row: 2, cell: 2, p: 1 } },
  { key: 'citizenship', sel: { tbl: 1, row: 2, cell: 3, p: 0 } },
  { key: 'passport', sel: { tbl: 1, row: 2, cell: 4, p: 0 } },
  { key: 'sex', sel: { tbl: 1, row: 2, cell: 5, p: 0 } },
  { key: 'company', sel: { tbl: 1, row: 2, cell: 6, p: 0 }, sub: { trim: true }, keep: true },
  { key: 'position', sel: { tbl: 1, row: 2, cell: 6, p: 1 }, keep: true },
  { key: 'director', sel: { tbl: 2, row: 0, cell: 1, p: 0 }, keep: true },
]

// ---- IIO / Roʻyxatga olish talabnomasi (request for temporary registration) ------------------------------------
export const IIO2_FILE = 'da5dc92a-Royxatga_olish_talabnomasi.docx'
const MAIN = { tbl: 1 }
export const IIO2 = [
  // header: «YANGIHAYOT IIO FMB / MvaPB BOSHLIG‘IGA» is two lines; the district goes on the first, «MvaPB» moves up with it
  { key: 'district_office', sel: { tbl: 0, row: 0, cell: 0, p: 1 }, sub: { trim: true }, keep: true },
  { sel: { tbl: 0, row: 0, cell: 0, p: 2 }, sub: { to: 'BOSHLIG‘IGA' }, ph: '' },
  { key: 'out_no', sel: { tbl: 0, row: 1, cell: 0, p: 0 }, sub: { from: '№' }, keep: true },
  { key: 'doc_date', sel: { tbl: 0, row: 2, cell: 0, p: 0 }, sub: { from: 'Sana:' }, keep: true },
  { key: 'company', sel: { find: 'Sizdan' }, sub: { to: ' Sizdan' }, keep: true },

  { key: 'full_name', sel: { ...MAIN, row: 0, cell: 1, p: 0 }, sub: { from: 'F.I.O: ' } },
  { key: 'children', sel: { ...MAIN, row: 1, cell: 1, p: 0 }, sub: { from: 'Farzandlari: ' }, keep: true },
  { key: 'citizenship', sel: { ...MAIN, row: 2, cell: 1, p: 0 }, sub: { from: 'Fuqaroligi: ' } },
  { key: 'sex', sel: { ...MAIN, row: 2, cell: 2, p: 0 }, sub: { from: 'Jinsi: ' } },
  { key: 'birthplace', sel: { ...MAIN, row: 3, cell: 1, p: 0 }, sub: { from: 'sanasi: ', to: ', ' } },
  { key: 'dob', sel: { ...MAIN, row: 3, cell: 1, p: 0 }, sub: { from: ', ', fromLast: true } },
  { key: 'company', sel: { ...MAIN, row: 4, cell: 1, p: 0 }, sub: { from: 'lavozimi: ' }, keep: true },
  { key: 'passport', sel: { ...MAIN, row: 5, cell: 1, p: 0 }, sub: { from: 'hujjati: ' } },
  { key: 'visa_type', sel: { ...MAIN, row: 5, cell: 2, p: 0 }, sub: { from: 'va №: ', to: ', ' }, keep: true },
  { key: 'visa_no', sel: { ...MAIN, row: 5, cell: 2, p: 0 }, sub: { from: ', ', fromLast: true }, keep: true },
  { key: 'visa_issuer', sel: { ...MAIN, row: 6, cell: 1, p: 0 }, sub: { from: 'muddati: ' }, keep: true },
  { key: 'visa_days', sel: { ...MAIN, row: 7, cell: 1, p: 0 }, sub: { to: ' kun' }, keep: true },
  { key: 'entry_date', sel: { ...MAIN, row: 8, cell: 1, p: 0 }, sub: { from: 'sanasi: ' } },
  { key: 'stay_address', sel: { ...MAIN, row: 9, cell: 1, p: 0 }, sub: { from: 'manzili: ' } },
  // the source pads «(tel)» to the right with ~60 spaces; one space keeps a long name from wrapping badly
  { key: 'host_name', sel: { ...MAIN, row: 10, cell: 1, p: 0 }, sub: { from: 'otasining ismi: ', to: '(tel)' }, ph: '{{host_name}} ' },
  { key: 'host_phone', sel: { ...MAIN, row: 10, cell: 1, p: 0 }, sub: { from: '(tel) ' } },
  { key: 'resp_name', sel: { ...MAIN, row: 11, cell: 1, p: 0 }, sub: { from: 'otasining ismi: ', trim: true } },
  { key: 'resp_passport', sel: { ...MAIN, row: 12, cell: 0, p: 0 }, sub: { from: 'raqami: ' } },
  { key: 'resp_phone', sel: { ...MAIN, row: 13, cell: 0, p: 0 }, sub: { from: 'raqami: ' } },
  { key: 'resp_mobile', sel: { ...MAIN, row: 13, cell: 1, p: 0 }, sub: { from: 'raqami: ' } },
  { key: 'company', sel: { ...MAIN, row: 15, cell: 0, p: 0 }, sub: { trim: true }, keep: true },
  { key: 'director', sel: { ...MAIN, row: 15, cell: 1, p: 0 }, keep: true },
]
// (the source's «MvaPB» is deleted from line 3 and carried by district_office on line 2 — the verifier reads it back)
export const IIO2_DISTRICT_EXTRA = { sel: { tbl: 0, row: 0, cell: 0, p: 2 }, sub: { to: ' BOSHLIG‘IGA' } }
