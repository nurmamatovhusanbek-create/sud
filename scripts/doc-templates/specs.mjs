// Where the variable values sit in the visa and court originals, by PLACE (table cell / label / marker), never by value.
// build-templates.mjs reads each value out of the original at run time and turns it into a {{key}} placeholder;
// verify-templates.mjs reads the same places to prove the round trip. No name, passport number, phone number or case
// number is written down anywhere in the repository. (The two IIO documents are in iio-specs.mjs, same idea.)
//
// The ops run IN THIS ORDER (it is the order the old text-matched builder used, so the output is byte-identical).
// See `applyOps` in xml-edit.mjs for the op fields. `keep: true` = a company constant (it is also a default in
// src/lib/documents/registry.ts), so the leak check skips it.

// shared pieces of the table row «full name | birth | citizenship | passport | sex | workplace» (visa2, visa3)
const personRow = (tbl) => [
  { key: 'full_name', sel: { tbl, row: 2, cell: 1, p: 0 } },
  { key: 'dob', sel: { tbl, row: 2, cell: 2, p: 0 } },
  { key: 'birthplace', sel: { tbl, row: 2, cell: 2, p: 1 } },
  { key: 'citizenship', sel: { tbl, row: 2, cell: 3, p: 0 } },
  { key: 'passport', sel: { tbl, row: 2, cell: 4, p: 0 } },
  { key: 'sex', sel: { tbl, row: 2, cell: 5, p: 0 }, cell: true },
  { key: 'position', sel: { tbl, row: 2, cell: 6, p: 1 } },
]

// the header table of the Uzbek visa letters: «Chiqish raqami _______» and «2026 yil « ___ » ______» (two paragraphs)
const outNoAndDate = (tbl, row) => [
  { key: 'out_no', ph: 'Chiqish raqami {{out_no}}', sel: { tbl, row, cell: 0, p: 0 }, sub: { trim: true }, as: { from: 'Chiqish raqami ', trim: true }, keep: true },
  { key: 'doc_date', sel: { tbl, row, cell: 0, p: 1 }, sub: { trim: true }, keep: true },
]

// the applicant block of a court petition (Sudya / Ish raqami / Arizachi / Manzil)
const COURT_HEAD = [
  { key: 'court', sel: { tbl: 0, row: 0, cell: 1, p: 0 }, sub: { to: 'iga' }, keep: true },
  { key: 'judge', sel: { tbl: 0, row: 1, cell: 1, p: 0 } },
  { key: 'case_number', sel: { tbl: 0, row: 2, cell: 1, p: 0 } },
]
const COURT_PARTIES = [
  { key: 'rep_name', sel: { tbl: 0, row: 3, cell: 1, p: 0 }, sub: { from: 'vakili ' } },
  { key: 'address', sel: { tbl: 0, row: 4, cell: 1, p: 0 }, keep: true },
  { key: 'plaintiff', sel: { find: 'yurituvida' }, sub: { from: 'vogar ', to: ' va ' } },
  { key: 'contract_subject', sel: { find: 'yurituvida' }, sub: { from: 'rtasidagi ', to: ' yuzasidan' } },
]

export const SPECS = [
  // ---- visa ---------------------------------------------------------------------------------------------------
  {
    name: 'visa1_invitation',
    file: '94f688b9-Invitation_Letter_Person_Person.docx',
    ops: [
      { key: 'company_en', sel: { find: 'We hereby confirm' }, sub: { from: 'confirm that ', to: ', registered at' }, keep: true },
      { key: 'company_address_en', sel: { find: 'We hereby confirm' }, sub: { from: 'registered at ', to: ', Republic of Uzbekistan' }, keep: true },
      { key: 'full_name', sel: { find: 'Full name: ' }, sub: { from: 'Full name: ' } },
      { key: 'citizenship_en', sel: { find: 'Citizenship: ' }, sub: { from: 'Citizenship: ' } },
      { key: 'passport', sel: { find: 'Passport ' }, sub: { from: '№: ' } },
      // two distinct role spots kept as separate fields: the sentence role («invites the …») vs the Subject / Position line
      { key: 'role_en', sel: { find: 'officially invites' }, sub: { from: 'invites the ', to: ':' } },
      { key: 'position', sel: { find: 'Position: ' }, sub: { from: 'Position: ' } },
      { key: 'stay_from', sel: { find: 'planned period of stay' }, sub: { from: 'is from ', to: ' to ' } },
      { key: 'stay_to', sel: { find: 'planned period of stay' }, sub: { from: ' to ', to: ' with' } },
      { key: 'director', sel: { tbl: 1, row: 0, cell: 0, p: 0 }, keep: true },
    ],
  },
  {
    name: 'visa2_kafolat',
    file: '9dc3fda2-Kafolat_xati_Person_Person.docx',
    ops: [
      ...outNoAndDate(0, 1),
      { key: 'citizenship_sentence', sel: { find: 'Ushbu xat bilan' }, sub: { from: 'etilayotgan ', to: ' fuqarolarini' } },
      { key: 'company', sel: { find: 'Ushbu xat bilan' }, sub: { from: 'bilan, ', to: ', mazkur' }, keep: true },
      ...personRow(1),
      { key: 'director', sel: { tbl: 2, row: 0, cell: 1, p: 0 }, keep: true },
    ],
  },
  {
    name: 'visa3_talabnoma',
    file: '82047ae6-Viza_talabnomasi_Person_Person.docx',
    ops: [
      ...outNoAndDate(0, 2),
      { key: 'company', sel: { find: 'yordam berishingizni' }, sub: { to: ' O' }, keep: true },
      ...personRow(1),
      { key: 'entries', sel: { tbl: 2, row: 0, cell: 2, p: 0 }, cell: true, keep: true },
      { key: 'travel_from', sel: { tbl: 2, row: 1, cell: 2, p: 0 }, sub: { to: ' y. dan' } },
      { key: 'travel_to', sel: { tbl: 2, row: 1, cell: 2, p: 0 }, sub: { from: 'dan. ', to: ' y. gacha' } },
      { key: 'visa_place', sel: { tbl: 2, row: 2, cell: 2, p: 0 }, cell: true, keep: true },
      // the purpose cell («…MCHJ QKda ishlash uchun») derives from {{company}} above
      { key: 'cities', sel: { tbl: 2, row: 4, cell: 2, p: 0 }, cell: true, keep: true },
      { key: 'residence', sel: { tbl: 2, row: 5, cell: 2, p: 0 }, cell: true, keep: true },
      { key: 'reg_justice', sel: { tbl: 2, row: 7, cell: 2, p: 0 }, cell: true, keep: true },
      { key: 'reg_consular', sel: { tbl: 2, row: 10, cell: 2, p: 0 }, cell: true, keep: true },
      { key: 'responsible', sel: { tbl: 2, row: 12, cell: 2, p: 0 }, cell: true },
      { key: 'greeter', sel: { tbl: 2, row: 13, cell: 2, p: 0 }, cell: true },
      { key: 'director', sel: { find: 'Turgunov' }, keep: true },
    ],
  },

  // ---- court petitions ----------------------------------------------------------------------------------------
  {
    name: 'court_copy',
    file: '211051e2-ish_hujjatlaridan_nusxa_olish_to_g_risida.docx',
    ops: [
      ...COURT_HEAD,
      { key: 'company', sel: { tbl: 0, row: 3, cell: 1, p: 0 }, sub: { to: ' ishonchli vakili' }, keep: true },
      ...COURT_PARTIES,
      { key: 'hearing_date', sel: { find: 'yurituvida' }, sub: { from: 'majlisi ', to: ' kuni' } },
      { key: 'hearing_time', sel: { find: 'yurituvida' }, sub: { from: 'soat ', to: 'ga ' } },
    ],
  },
  {
    name: 'court_postpone',
    file: 'e0eb5ba2-sud_majlisini_keyinga_qoldirish_to_g_risida.docx',
    ops: [
      ...COURT_HEAD,
      // the reason paragraph BEFORE the company (it contains the company name)
      { key: 'reason', sel: { find: 'oldida qarzdor' }, sub: { trim: true } },
      { key: 'company', sel: { tbl: 0, row: 3, cell: 1, p: 0 }, sub: { to: ' ishonchli vakili' }, keep: true },
      ...COURT_PARTIES,
      { key: 'legal_basis', sel: { find: 'inobatga olib' }, sub: { from: 'Respublikasi ', to: 'ga asosan' }, keep: true },
      { key: 'hearing_date', sel: { find: 'yurituvida' }, sub: { from: 'majlisi ', to: ' kuni' } },
      { key: 'hearing_time', sel: { find: 'yurituvida' }, sub: { from: 'soat ', to: 'ga ' } },
      { key: 'phone', sel: { find: 'Telefon' }, sub: { from: 'Telefon: ' } },
    ],
  },
  {
    name: 'court_deadline',
    file: '1b4c14b2-Muddatni_tiklash_togrisida.docx',
    ops: [
      { key: 'court', sel: { tbl: 0, row: 0, cell: 0, p: 0 }, sub: { to: 'iga' }, keep: true },
      { key: 'applicant_person', sel: { tbl: 0, row: 2, cell: 1, p: 0 } },
      { key: 'phone', sel: { tbl: 0, row: 3, cell: 1, p: 0 } },
      { key: 'passport', sel: { tbl: 0, row: 4, cell: 1, p: 0 } },
    ],
  },
  {
    name: 'court_cancel',
    file: 'f296cd33-Sud_buyrugi_bekor.docx',
    // the original doubles a word («sudi sudi»): a deliberate wording fix, no value involved
    textFix: [['tumanlararo sudi sudi tomonidan', 'tumanlararo sudi tomonidan']],
    ops: [
      { fix: ['tumanlararo sudi sudi tomonidan', 'tumanlararo sudi tomonidan'] },
      {
        key: 'court',
        // «Fuqarolik ishlari bo‘yicha» and «Yakkasaroy tumanlararo sud(iga)» are two paragraphs of the heading cell
        read: [
          { sel: { tbl: 0, row: 0, cell: 1, p: 0 } },
          { sel: { tbl: 0, row: 0, cell: 1, p: 1 }, sub: { to: 'iga' } },
        ],
        keep: true,
      },
      { key: 'company', sel: { tbl: 0, row: 1, cell: 1, p: 0 }, sub: { from: 'Arizachi: ', trim: true }, keep: true },
      { key: 'rep_name', sel: { tbl: 0, row: 1, cell: 1, p: 1 }, sub: { from: 'vakili ', to: 'dan' } },
      { key: 'order_date', sel: { find: 'sud buyrug‘i chiqarilgan' }, sub: { from: 'tomonidan ', to: '-yilda' } },
      { key: 'order_number', sel: { find: 'sud buyrug‘i chiqarilgan' }, sub: { from: 'yilda ', to: '-sonli' } },
      { key: 'beneficiary', sel: { find: 'sud buyrug‘i chiqarilgan' }, sub: { from: 'ko‘ra ', to: ' foydasiga' } },
      { key: 'amount', sel: { find: 'sud buyrug‘i chiqarilgan' }, sub: { from: 'foydasiga ', to: ' qarzdorlik' } },
      { key: 'director', sel: { tbl: 1, row: 0, cell: 2, p: 1 }, keep: true },
      { key: 'executor', sel: { find: 'Ijrochi' }, sub: { from: 'Ijrochi: ' } },
    ],
  },
]
