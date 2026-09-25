/**
 * Document-engine registry — the single source of truth for the «Hujjatlar»
 * feature. Describes every generatable .docx (which template file, which
 * placeholders it fills) and every form field (label, default, kind).
 *
 * The templates in ./templates/*.docx were derived from the real company
 * forms with a span-aware placeholder pass (scripts/doc-templates): every
 * variable value is a single `{{key}}` run, so the server fill is a trivial
 * string replace. Keep placeholder keys here in sync with the templates.
 *
 * Pure data + types — imported by BOTH the client view and the server route,
 * so this file must stay free of client/server-only imports.
 */

export type DocTab = 'visa' | 'iio' | 'court'
export type FieldKind = 'text' | 'date' | 'textarea'

export interface FieldDef {
  key: string
  label: string
  kind?: FieldKind
  placeholder?: string
  /** Prefill (company constants / typical values). Applicant fields stay blank. */
  default?: string
  /** Render value in the mono figure font (ids, numbers). */
  mono?: boolean
  hint?: string
}

export interface DocDef {
  id: string
  tab: DocTab
  title: string
  subtitle: string
  /** file name under src/lib/documents/templates */
  file: string
  lang: 'uz' | 'en'
  /** ascii slug for the download filename */
  slug: string
  /** the complete, ordered list of field keys this document fills (its
   *  template placeholders). Each document is its own self-contained form. */
  fields: string[]
  /** extra keywords to widen search matches. */
  keywords?: string
}

/** A category groups documents on the picker; also carries per-category chrome. */
export interface TabDef {
  id: DocTab
  label: string
  intro: string
  /** Combined categories (visa, iio) share ONE form built from these panels —
   *  fill once, generate every document in the category. A document's card
   *  then only adds the fields not already covered here. Separate categories
   *  (court) omit groups. */
  groups?: { title: string; keys: string[] }[]
  /** Separate category: the category opens a grid of document cards, and each
   *  document opens its own full-window form. */
  separate?: boolean
  /** show the letterhead uploader (blank the banner when none). Court
   *  petitions keep their own embedded letterhead, so they omit this. */
  letterhead?: boolean
  /** field key that must be filled before a document can be generated. */
  requireKey?: string
}

// ---- field catalog ----------------------------------------------------------

export const FIELDS: Record<string, FieldDef> = {
  // company / letter chrome
  company: { key: 'company', label: 'Korxona (toʻliq nomi)', default: '“Artikul Aziya Kabel” MCHJ QK', mono: true },
  company_en: { key: 'company_en', label: 'Company (EN)', default: 'JV LLC “ARTIKUL AZIYA KABEL”' },
  company_address_en: { key: 'company_address_en', label: 'Address (EN)', default: '115, Fayzli street, Yangihayot district, Tashkent' },
  director: { key: 'director', label: 'Direktor', default: 'Turgunov Sh.A.' },
  out_no: { key: 'out_no', label: 'Chiqish raqami', default: '_______', mono: true },
  doc_date: { key: 'doc_date', label: 'Sana', default: '2026 yil «___»______' },
  district_office: { key: 'district_office', label: 'IIO / MvaPB boʻlimi', default: 'YANGIHAYOT IIO FMB MvaPB' },
  reg_justice: { key: 'reg_justice', label: 'Adliya roʻyxati raqami', default: '№2013433, 17.10.2014', mono: true },
  reg_consular: { key: 'reg_consular', label: 'TIV Konsullik roʻyxati', default: '20610', mono: true },

  // applicant — placeholders are generic field hints, not sample data
  full_name: { key: 'full_name', label: 'F.I.Sh (toʻliq)', placeholder: 'Ism va familiya' },
  sex: { key: 'sex', label: 'Jinsi', placeholder: 'Erkak / Ayol' },
  dob: { key: 'dob', label: 'Tugʻilgan sana', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  birthplace: { key: 'birthplace', label: 'Tugʻilgan joyi', placeholder: 'Shahar, davlat' },
  citizenship: { key: 'citizenship', label: 'Fuqaroligi', placeholder: 'Davlat' },
  citizenship_en: { key: 'citizenship_en', label: 'Citizenship (EN)', placeholder: 'Country' },
  citizenship_sentence: {
    key: 'citizenship_sentence', label: 'Fuqaroligi (matnda)',
    placeholder: 'Davlatning toʻliq nomi', hint: 'Kafolat xati matnida «… fuqarolarini» dan oldin turadi',
  },
  passport: { key: 'passport', label: 'Pasport raqami', placeholder: 'Seriya va raqam', mono: true },
  position: { key: 'position', label: 'Lavozim', placeholder: 'Lavozim' },
  role_en: { key: 'role_en', label: 'Role in sentence (EN)', default: 'Planning engineer', hint: '«…officially invites the ___» — matndagi lavozim' },
  stay_from: { key: 'stay_from', label: 'Boʻlish muddati — dan', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  stay_to: { key: 'stay_to', label: 'Boʻlish muddati — gacha', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },

  // viza talabnomasi extras
  entries: { key: 'entries', label: 'Kirishlar soni', default: 'ko‘p martalik' },
  travel_from: { key: 'travel_from', label: 'Safar muddati — dan', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  travel_to: { key: 'travel_to', label: 'Safar muddati — gacha', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  visa_place: { key: 'visa_place', label: 'Viza olish joyi', default: 'Qohira shahridagi O’zbekiston elchixonasi' },
  cities: { key: 'cities', label: 'Boriladigan shaharlar', default: 'Toshkent' },
  residence: { key: 'residence', label: 'Oʻzbekistondagi yashash joyi', default: '“Simma” mehmonxonasi' },
  responsible: { key: 'responsible', label: 'Masʼul shaxs (rasmiylashtiruvchi)', placeholder: 'F.I.Sh · telefon' },
  greeter: { key: 'greeter', label: 'Kutib oluvchi / hamroh shaxs', placeholder: 'F.I.Sh · telefon' },

  // ro'yxatga olish extras
  children: { key: 'children', label: 'Farzandlari', default: 'yo‘q' },
  visa_type: { key: 'visa_type', label: 'Viza turi', placeholder: 'Masalan: B2' },
  visa_no: { key: 'visa_no', label: 'Viza raqami', placeholder: 'Raqam', mono: true },
  visa_issuer: { key: 'visa_issuer', label: 'Viza kim tomonidan berilgan', placeholder: 'Korxona / tashkilot' },
  visa_from: { key: 'visa_from', label: 'Viza amal qiladi — dan', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  visa_to: { key: 'visa_to', label: 'Viza amal qiladi — gacha', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  visa_days: { key: 'visa_days', label: 'Muddat (kun)', default: '180', mono: true },

  // ---- court petitions (Sud arizalari) --------------------------------------
  court: { key: 'court', label: 'Sud nomi', placeholder: 'Toshkent tumanlararo iqtisodiy sud', hint: '«sud» bilan tugasin — «…ga», «…ning» avtomatik qoʻshiladi' },
  judge: { key: 'judge', label: 'Sudya', placeholder: 'F.I.Sh' },
  case_number: { key: 'case_number', label: 'Ish raqami', placeholder: '4-1001-2609/00000', mono: true },
  rep_name: { key: 'rep_name', label: 'Ishonchli vakil', placeholder: 'F.I.Sh' },
  address: { key: 'address', label: 'Manzil', default: 'Toshkent shahar, Yangihayot tumani, Janubiy sanoat hududi, Fayzli MFY' },
  plaintiff: { key: 'plaintiff', label: 'Daʼvogar', placeholder: 'Tashkilot nomi' },
  contract_subject: { key: 'contract_subject', label: 'Shartnoma predmeti', placeholder: 'masalan: kommunal xizmat koʻrsatish shartnomasi' },
  hearing_date: { key: 'hearing_date', label: 'Sud majlisi sanasi', placeholder: '2026-yil 00-oy' },
  hearing_time: { key: 'hearing_time', label: 'Sud majlisi vaqti', placeholder: '00:00', mono: true },
  reason: { key: 'reason', label: 'Keyinga qoldirish sababi', kind: 'textarea', placeholder: 'Majlisga qatnasha olmaslik sababini yozing…' },
  legal_basis: { key: 'legal_basis', label: 'Huquqiy asos (kodeks moddalari)', default: 'Iqtisodiy protsessual kodeksining 42, 43 va 171-moddalari' },
  phone: { key: 'phone', label: 'Telefon', placeholder: '+998 00 000 00 00', mono: true },
  applicant_person: { key: 'applicant_person', label: 'Ariza beruvchi (F.I.Sh)', placeholder: 'F.I.Sh' },
  order_date: { key: 'order_date', label: 'Sud buyrugʻi sanasi', placeholder: 'kk.oo.yyyy', mono: true },
  order_number: { key: 'order_number', label: 'Sud buyrugʻi raqami', placeholder: '2-0000-0000/00000', mono: true },
  beneficiary: { key: 'beneficiary', label: 'Undiruvchi (foydasiga)', kind: 'textarea', placeholder: 'Tashkilot / shaxs nomi' },
  amount: { key: 'amount', label: 'Undiriladigan summa', placeholder: '0 000 000', mono: true },
  executor: { key: 'executor', label: 'Ijrochi (F.I.Sh · telefon)', placeholder: 'F.I.Sh · +998 …' },
}

// ---- documents & tabs -------------------------------------------------------

export const DOCS: DocDef[] = [
  {
    id: 'visa1_invitation', tab: 'visa', lang: 'en', slug: 'invitation-letter',
    title: 'Invitation Letter', subtitle: 'Elchixona konsulligiga taklifnoma (EN)',
    file: 'visa1_invitation.docx',
    fields: ['company_en', 'company_address_en', 'full_name', 'citizenship_en', 'passport', 'role_en', 'position', 'stay_from', 'stay_to', 'director'],
  },
  {
    id: 'visa2_kafolat', tab: 'visa', lang: 'uz', slug: 'kafolat-xati',
    title: 'Kafolat xati', subtitle: 'TIV Konsulligi boshqarmasiga kafolat',
    file: 'visa2_kafolat.docx',
    fields: ['company', 'director', 'out_no', 'doc_date', 'citizenship_sentence', 'full_name', 'sex', 'dob', 'birthplace', 'citizenship', 'passport', 'position'],
  },
  {
    id: 'visa3_talabnoma', tab: 'visa', lang: 'uz', slug: 'viza-talabnomasi',
    title: 'Viza talabnomasi', subtitle: 'TIV Konsullik-huquqiy boshqarmasiga',
    file: 'visa3_talabnoma.docx',
    fields: ['company', 'director', 'out_no', 'doc_date', 'full_name', 'sex', 'dob', 'birthplace', 'citizenship', 'passport', 'position', 'entries', 'travel_from', 'travel_to', 'visa_place', 'cities', 'residence', 'responsible', 'greeter', 'reg_justice', 'reg_consular'],
  },
  {
    id: 'iio1_kafolat', tab: 'iio', lang: 'uz', slug: 'iio-kafolat-xati',
    title: 'Kafolat xati (IIO)', subtitle: 'Tuman IIO FMB MvaPB boshligʻiga',
    file: 'iio1_kafolat.docx',
    fields: ['company', 'director', 'doc_date', 'district_office', 'full_name', 'sex', 'dob', 'birthplace', 'citizenship', 'passport', 'position'],
  },
  {
    id: 'iio2_royxat', tab: 'iio', lang: 'uz', slug: 'royxatga-olish-talabnomasi',
    title: 'Roʻyxatga olish talabnomasi', subtitle: 'Vaqtincha roʻyxatga olish (MvaPB)',
    file: 'iio2_royxat.docx',
    fields: ['company', 'director', 'full_name', 'sex', 'dob', 'birthplace', 'citizenship', 'passport', 'children', 'visa_type', 'visa_no', 'visa_issuer', 'visa_from', 'visa_to', 'visa_days', 'responsible'],
  },
  // ---- court petitions (Sud arizalari) — separate: one card + form per doc ----
  {
    id: 'court_copy', tab: 'court', lang: 'uz', slug: 'ish-hujjatlaridan-nusxa-olish',
    title: 'Ish hujjatlaridan nusxa olish', subtitle: 'Iqtisodiy sudga ariza',
    file: 'court_copy.docx', keywords: 'nusxa kochirma copy',
    fields: ['court', 'judge', 'case_number', 'company', 'rep_name', 'address', 'plaintiff', 'contract_subject', 'hearing_date', 'hearing_time'],
  },
  {
    id: 'court_postpone', tab: 'court', lang: 'uz', slug: 'sud-majlisini-qoldirish',
    title: 'Sud majlisini qoldirish', subtitle: 'Majlisni keyinga qoldirish arizasi',
    file: 'court_postpone.docx', keywords: 'qoldirish keyinga majlis postpone',
    fields: ['court', 'judge', 'case_number', 'company', 'rep_name', 'address', 'plaintiff', 'contract_subject', 'hearing_date', 'hearing_time', 'reason', 'legal_basis', 'phone'],
  },
  {
    id: 'court_deadline', tab: 'court', lang: 'uz', slug: 'muddatni-tiklash',
    title: 'Muddatni tiklash', subtitle: 'Protsessual muddatni tiklash iltimosnomasi',
    file: 'court_deadline.docx', keywords: 'muddat tiklash deadline',
    fields: ['court', 'applicant_person', 'phone', 'passport'],
  },
  {
    id: 'court_cancel', tab: 'court', lang: 'uz', slug: 'sud-buyrugini-bekor-qilish',
    title: 'Sud buyrugʻini bekor qilish', subtitle: 'Buyruqqa eʼtiroz / bekor qilish arizasi',
    file: 'court_cancel.docx', keywords: 'buyruq bekor cancel etiroz',
    fields: ['court', 'company', 'rep_name', 'order_date', 'order_number', 'beneficiary', 'amount', 'director', 'executor'],
  },
]

export const TABS: TabDef[] = [
  {
    id: 'visa', label: 'Viza hujjatlari',
    intro: 'Elchixona va TIV Konsulligi uchun taklifnoma, kafolat va viza talabnomasi.',
    groups: [
      { title: 'Korxona', keys: ['company', 'company_en', 'company_address_en', 'director', 'out_no', 'doc_date'] },
      { title: 'Chet ellik xodim', keys: ['full_name', 'sex', 'dob', 'birthplace', 'citizenship', 'citizenship_sentence', 'citizenship_en', 'passport', 'position', 'stay_from', 'stay_to'] },
    ],
    letterhead: true,
    requireKey: 'full_name',
  },
  {
    id: 'iio', label: 'Ichki ishlar',
    intro: 'Tuman IIO / MvaPB uchun kafolat xati va vaqtincha roʻyxatga olish talabnomasi.',
    groups: [
      { title: 'Korxona', keys: ['company', 'director', 'doc_date', 'district_office'] },
      { title: 'Chet ellik xodim', keys: ['full_name', 'sex', 'dob', 'birthplace', 'citizenship', 'passport', 'position'] },
    ],
    letterhead: true,
    requireKey: 'full_name',
  },
  {
    id: 'court', label: 'Sud arizalari',
    intro: 'Sudlarga ariza va iltimosnomalar. Hujjat turini tanlang.',
    separate: true,
    requireKey: 'court',
  },
]

// ---- helpers ----------------------------------------------------------------

export function tabById(id: DocTab): TabDef | undefined {
  return TABS.find((t) => t.id === id)
}

export function docsByTab(id: DocTab): DocDef[] {
  return DOCS.filter((d) => d.tab === id)
}

export function docById(id: string): DocDef | undefined {
  return DOCS.find((d) => d.id === id)
}

/** All field keys shared by a combined category's panels. */
export function groupKeys(tab: TabDef): string[] {
  return tab.groups?.flatMap((g) => g.keys) ?? []
}

/** A document's fields NOT already covered by the category's shared panels
 *  (i.e. what its own card adds in a combined category). */
export function docExtraFields(doc: DocDef, tab: TabDef): string[] {
  const shared = new Set(groupKeys(tab))
  return doc.fields.filter((k) => !shared.has(k))
}

function defaultsFor(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  keys.forEach((k) => { out[k] = FIELDS[k]?.default ?? '' })
  return out
}

/** Initial values for a combined category (union of every doc's fields + panels). */
export function categoryDefaults(tab: TabDef): Record<string, string> {
  const keys = new Set<string>(groupKeys(tab))
  docsByTab(tab.id).forEach((d) => d.fields.forEach((k) => keys.add(k)))
  return defaultsFor([...keys])
}

/** Initial values for a single document's own form. */
export function docDefaults(doc: DocDef): Record<string, string> {
  return defaultsFor(doc.fields)
}
