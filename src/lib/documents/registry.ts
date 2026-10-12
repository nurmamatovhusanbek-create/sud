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

export type DocTab = 'visa' | 'iio' | 'court' | 'secret'
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
  /** the document's language: one language, or both side by side (Russian | Uzbek) */
  lang: 'uz' | 'en' | 'ru-uz'
  /** ascii slug for the download filename */
  slug: string
  /** the complete, ordered list of field keys this document fills (its
   *  template placeholders). Each document is its own self-contained form. */
  fields: string[]
  /** extra keywords to widen search matches. */
  keywords?: string
  /** field that must be filled before THIS document can be generated (overrides the category's) */
  requireKey?: string
  /** field whose value names the downloaded file (default: the applicant / person fields) */
  nameKey?: string
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
  /** Prefill for this category that differs from the field's global default: the same field can mean different things
   *  in two categories («Lavozim» is a job title in a visa letter, «ishlash uchun» in the IIO guarantee letter). */
  defaults?: Record<string, string>
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
  // the real form writes «–» when the person has no visa, and gives who issued it and for how long on ONE line
  visa_type: { key: 'visa_type', label: 'Viza turi', default: '–', placeholder: 'Masalan: B2', hint: 'Viza boʻlmasa «–» qoldiring' },
  visa_no: { key: 'visa_no', label: 'Viza raqami', default: '–', placeholder: 'Raqam', mono: true },
  visa_issuer: {
    key: 'visa_issuer', label: 'Viza kim tomonidan va muddati', default: '–',
    placeholder: '“Kompaniya” MCHJ, 18.08.2026dan 18.08.2027gacha', hint: 'Bitta satr: kim bergan va qaysi muddatga. Viza boʻlmasa «–»',
  },
  visa_days: { key: 'visa_days', label: 'Muddat (kun)', default: '180', mono: true },
  // the rest of the registration request: entry, where the person lives, who gave the housing, who handles the papers
  entry_date: { key: 'entry_date', label: 'Oʻzbekistonga kirgan sana', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  stay_address: { key: 'stay_address', label: 'Vaqtinchalik yashash manzili', placeholder: 'MFY, koʻcha, uy, xonadon' },
  host_name: { key: 'host_name', label: 'Uy-joy bergan shaxs (F.I.Sh)', placeholder: 'Familiya Ism Otasining ismi' },
  host_phone: { key: 'host_phone', label: 'Uy-joy bergan shaxsning telefoni', placeholder: '+998 00 000 00 00', mono: true },
  resp_name: { key: 'resp_name', label: 'Masʼul shaxs (F.I.Sh)', placeholder: 'Hujjatlarni rasmiylashtiruvchi: Familiya Ism' },
  resp_passport: { key: 'resp_passport', label: 'Masʼul shaxsning pasporti', placeholder: 'AA 0000000', mono: true },
  resp_phone: { key: 'resp_phone', label: 'Masʼul shaxs: xizmat tel.', placeholder: '+998 00 000 00 00', mono: true },
  resp_mobile: { key: 'resp_mobile', label: 'Masʼul shaxs: uyali tel.', placeholder: '+998 00 000 00 00', mono: true },

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

  // ---- Tijorat siri: the order and the employee agreement (Russian | Uzbek side by side) ----------------------------
  // One input, both halves: dates, terms and Cyrillic names are derived (derive.ts); a field that is also derived
  // (the «ruscha» name) shows the derived text as its hint and takes what is typed instead.
  sc_company_ru: { key: 'sc_company_ru', label: 'Korxona nomi (ruscha)', default: 'СП ООО «Artikul Aziya Kabel»' },
  sc_company_uz: { key: 'sc_company_uz', label: 'Korxona nomi (oʻzbekcha)', default: '“Artikul Aziya Kabel” MChJ QK' },
  sc_addr_ru: { key: 'sc_addr_ru', label: 'Manzil (ruscha)', default: 'г. Ташкент, Янгихаётский район, Южная промзона, Файзли МСГ' },
  sc_addr_uz: { key: 'sc_addr_uz', label: 'Manzil (oʻzbekcha)', default: 'Toshkent sh., Yangihayot tumani, Janubiy ishlab chiqarish hududi, Fayzli MFY' },
  sc_tin: { key: 'sc_tin', label: 'STIR', placeholder: '000 000 000', mono: true },
  sc_email: { key: 'sc_email', label: 'E-mail', default: 'vedartikul@gmail.com' },
  dir_full: {
    key: 'dir_full', label: 'Direktor (toʻliq, lotinda)', default: 'Turgunov Sherzod Azimjanovich',
    hint: 'Familiya Ism Otasining ismi. «Sh.A. Turgunov», «Ш.А. Тургунов» va kirillcha shakli avtomatik hosil boʻladi',
  },

  ts_order_no: { key: 'ts_order_no', label: 'Buyruq raqami', placeholder: '00', mono: true, hint: 'Kelishuvning 1.3-bandi va ilovalarida ham shu raqam chiqadi' },
  ts_order_date: { key: 'ts_order_date', label: 'Buyruq sanasi', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  ts_regime_date: { key: 'ts_regime_date', label: 'Rejim joriy etiladigan sana', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  resp_ru: { key: 'resp_ru', label: 'Masʼul shaxs (ruscha)', default: 'юриста Нурмаматова Хусана Нурмамат угли', hint: 'Lavozim va F.I.Sh. — «Назначить …» gapidagi (vinitelniy) kelishikda' },
  resp_uz: { key: 'resp_uz', label: 'Masʼul shaxs (oʻzbekcha)', default: 'Yurist Nurmamatov Husan Nurmamat oʻgʻli' },
  conf_years: { key: 'conf_years', label: 'Maxfiylik muddati (yil)', default: '2', mono: true, hint: 'Ishdan boʻshagandan keyin. Buyruq va kelishuvda raqam va soʻz bilan yoziladi' },
  ts_unit_1: { key: 'ts_unit_1', label: 'Boʻlinma 1', placeholder: 'Отдел продаж / Sotuv boʻlimi' },
  ts_unit_2: { key: 'ts_unit_2', label: 'Boʻlinma 2' },
  ts_unit_3: { key: 'ts_unit_3', label: 'Boʻlinma 3' },
  ts_unit_4: { key: 'ts_unit_4', label: 'Boʻlinma 4' },
  ts_unit_5: { key: 'ts_unit_5', label: 'Boʻlinma 5' },
  ts_unit_6: { key: 'ts_unit_6', label: 'Boʻlinma 6' },

  nda_no: { key: 'nda_no', label: 'Kelishuv raqami', placeholder: 'NDA-E1', mono: true },
  nda_date: { key: 'nda_date', label: 'Kelishuv sanasi', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  lookback_months: { key: 'lookback_months', label: 'Mijozlar: necha oy orqaga', default: '24', mono: true, hint: '1.4-band' },
  restrict_months: { key: 'restrict_months', label: 'Cheklov davri (oy)', default: '12', mono: true, hint: '1.7 va 5.1-bandlar' },
  fine_brv: { key: 'fine_brv', label: 'Jarima (BHM baravari)', default: '30', mono: true, hint: '6.1-band, har bir buzilish uchun' },
  fine_cap_brv: { key: 'fine_cap_brv', label: 'Jarimalar yigʻindisi chegarasi (BHM)', default: '50', mono: true },
  dept_head: { key: 'dept_head', label: 'Boʻlim boshligʻi (1-ilova imzosi)', placeholder: 'Familiya Ism Otasining ismi (kirillcha)' },

  emp_name: { key: 'emp_name', label: 'Xodim F.I.Sh (lotinda)', placeholder: 'Familiya Ism Otasining ismi' },
  emp_name_ru: { key: 'emp_name_ru', label: 'Xodim F.I.Sh (kirillcha)', hint: 'Boʻsh qoldirsangiz lotin yozuvidan avtomatik oʻgiriladi; notoʻgʻri boʻlsa shu yerda tuzating' },
  emp_country_uz: { key: 'emp_country_uz', label: 'Fuqaroligi (oʻzbekcha)', default: 'Oʻzbekiston Respublikasi' },
  emp_country_ru: { key: 'emp_country_ru', label: 'Fuqaroligi (ruscha, qaratqich)', default: 'Республики Узбекистан', hint: '«гражданин …» dan keyingi shakl' },
  emp_passport: { key: 'emp_passport', label: 'Pasport (ID-karta) seriyasi va raqami', placeholder: 'AA 0000000', mono: true },
  emp_issued: { key: 'emp_issued', label: 'Kim tomonidan va qachon berilgan', placeholder: 'Toshkent sh. IIB, 01.02.2020' },
  emp_pinfl: { key: 'emp_pinfl', label: 'JShShIR (PINFL)', placeholder: '00000000000000', mono: true },
  emp_address: { key: 'emp_address', label: 'Yashash manzili', placeholder: 'Shahar, tuman, koʻcha, uy' },
  emp_phone: { key: 'emp_phone', label: 'Telefon', placeholder: '+998 00 000 00 00', mono: true },
  emp_position_uz: { key: 'emp_position_uz', label: 'Lavozimi (oʻzbekcha)', placeholder: 'Sotuv menejeri' },
  emp_position_ru: { key: 'emp_position_ru', label: 'Lavozimi (ruscha)', placeholder: 'менеджер по продажам' },
  emp_unit_uz: { key: 'emp_unit_uz', label: 'Boʻlinmasi (oʻzbekcha)', placeholder: 'Sotuv boʻlimi' },
  emp_unit_ru: { key: 'emp_unit_ru', label: 'Boʻlinmasi (ruscha)', placeholder: 'отдела продаж' },
  lc_no: { key: 'lc_no', label: 'Mehnat shartnomasi raqami', placeholder: '00', mono: true },
  lc_date: { key: 'lc_date', label: 'Mehnat shartnomasi sanasi', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  dismiss_date: { key: 'dismiss_date', label: 'Ishdan boʻshatish sanasi', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },

  kc_1_name: { key: 'kc_1_name', label: 'Mijoz 1', placeholder: 'Kompaniya nomi' },
  kc_1_country: { key: 'kc_1_country', label: 'Mijoz 1: davlat', placeholder: 'Китай / Xitoy' },
  kc_2_name: { key: 'kc_2_name', label: 'Mijoz 2' },
  kc_2_country: { key: 'kc_2_country', label: 'Mijoz 2: davlat' },
  kc_3_name: { key: 'kc_3_name', label: 'Mijoz 3' },
  kc_3_country: { key: 'kc_3_country', label: 'Mijoz 3: davlat' },

  act_date: { key: 'act_date', label: 'Dalolatnoma sanasi', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  act_items_uz: { key: 'act_items_uz', label: 'Topshirilgan narsalar (oʻzbekcha)', kind: 'textarea', placeholder: 'noutbuk, telefon, hujjatlar, axborot tashuvchilar, ruxsatnoma' },
  act_items_ru: { key: 'act_items_ru', label: 'Topshirilgan narsalar (ruscha)', kind: 'textarea', placeholder: 'ноутбук, телефон, документы, носители, пропуск' },
  act_accounts_uz: { key: 'act_accounts_uz', label: 'Topshirilgan hisob qaydnomalari (oʻzbekcha)', placeholder: 'ish pochtasi, Telegram' },
  act_accounts_ru: { key: 'act_accounts_ru', label: 'Topshirilgan hisob qaydnomalari (ruscha)', placeholder: 'рабочая почта, Telegram' },
  act_chats_uz: { key: 'act_chats_uz', label: 'Chiqilgan ish chatlari (oʻzbekcha)', placeholder: 'chatlar nomi' },
  act_chats_ru: { key: 'act_chats_ru', label: 'Chiqilgan ish chatlari (ruscha)', placeholder: 'названия чатов' },
  acc_position_uz: { key: 'acc_position_uz', label: 'Qabul qiluvchi lavozimi (oʻzbekcha)', placeholder: 'Yurist' },
  acc_position_ru: { key: 'acc_position_ru', label: 'Qabul qiluvchi lavozimi (ruscha)', placeholder: 'Юрист' },
  acc_name: { key: 'acc_name', label: 'Qabul qiluvchi F.I.Sh (lotinda)', placeholder: 'Familiya Ism Otasining ismi' },
  acc_name_ru: { key: 'acc_name_ru', label: 'Qabul qiluvchi F.I.Sh (kirillcha)', hint: 'Boʻsh qoldirsangiz lotin yozuvidan avtomatik oʻgiriladi' },
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
    fields: [
      'company', 'director', 'out_no', 'doc_date', 'district_office',
      'full_name', 'sex', 'dob', 'birthplace', 'citizenship', 'passport', 'children',
      'visa_type', 'visa_no', 'visa_issuer', 'visa_days',
      'entry_date', 'stay_address', 'host_name', 'host_phone',
      'resp_name', 'resp_passport', 'resp_phone', 'resp_mobile',
    ],
  },
  // ---- Tijorat siri (trade secret): one form, both documents ------------------------------------------------------
  {
    id: 'ts1_buyruq', tab: 'secret', lang: 'ru-uz', slug: 'tijorat-siri-buyrugi',
    title: 'Tijorat siri buyrugʻi', subtitle: 'Tijorat siri rejimini joriy etish (3 ta ilova bilan)',
    file: 'ts1_buyruq.docx', keywords: 'tijorat siri buyruq приказ коммерческая тайна rejim',
    requireKey: 'ts_order_no', nameKey: 'ts_order_no',
    fields: [
      'sc_company_ru', 'sc_company_uz', 'dir_full',
      'ts_order_no', 'ts_order_date', 'ts_regime_date', 'resp_ru', 'resp_uz', 'conf_years',
      'ts_unit_1', 'ts_unit_2', 'ts_unit_3', 'ts_unit_4', 'ts_unit_5', 'ts_unit_6',
    ],
  },
  {
    id: 'ts2_kelishuv', tab: 'secret', lang: 'ru-uz', slug: 'maxfiylik-kelishuvi',
    title: 'Maxfiylik kelishuvi', subtitle: 'Xodim bilan tijorat sirini saqlash va mijozlarni ogʻdirmaslik (2 ta ilova bilan)',
    file: 'ts2_kelishuv.docx', keywords: 'kelishuv nda xodim ishdan boshatish соглашение неразглашение maxfiylik',
    requireKey: 'emp_name', nameKey: 'emp_name',
    fields: [
      'nda_no', 'nda_date', 'sc_company_ru', 'sc_company_uz', 'sc_addr_ru', 'sc_addr_uz', 'sc_tin', 'sc_email', 'dir_full',
      'emp_name', 'emp_name_ru', 'emp_country_uz', 'emp_country_ru', 'emp_passport', 'emp_issued', 'emp_pinfl', 'emp_address', 'emp_phone',
      'emp_position_uz', 'emp_position_ru', 'emp_unit_uz', 'emp_unit_ru', 'lc_no', 'lc_date', 'dismiss_date',
      'ts_order_no', 'ts_order_date', 'lookback_months', 'restrict_months', 'conf_years', 'fine_brv', 'fine_cap_brv',
      'kc_1_name', 'kc_1_country', 'kc_2_name', 'kc_2_country', 'kc_3_name', 'kc_3_country', 'dept_head',
      'act_date', 'act_items_uz', 'act_items_ru', 'act_accounts_uz', 'act_accounts_ru', 'act_chats_uz', 'act_chats_ru',
      'acc_position_uz', 'acc_position_ru', 'acc_name', 'acc_name_ru',
    ],
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
      { title: 'Korxona', keys: ['company', 'director', 'out_no', 'doc_date', 'district_office'] },
      { title: 'Chet ellik xodim', keys: ['full_name', 'sex', 'dob', 'birthplace', 'citizenship', 'passport', 'position'] },
    ],
    letterhead: true,
    requireKey: 'full_name',
    // the guarantee letter's «Ish joyi, lavozimi» cell reads «<company> ishlash uchun»
    defaults: { position: 'ishlash uchun' },
  },
  {
    id: 'secret', label: 'Tijorat siri',
    intro: 'Tijorat siri rejimi buyrugʻi va xodim bilan maxfiylik kelishuvi: bir marta toʻldiring, ikkala hujjat bir vaqtda tayyor boʻladi.',
    groups: [
      { title: 'Korxona', keys: ['sc_company_ru', 'sc_company_uz', 'sc_addr_ru', 'sc_addr_uz', 'sc_tin', 'sc_email', 'dir_full'] },
      { title: 'Buyruq', keys: ['ts_order_no', 'ts_order_date', 'ts_regime_date', 'resp_ru', 'resp_uz', 'conf_years'] },
      { title: 'Xodim', keys: [
        'emp_name', 'emp_name_ru', 'emp_country_uz', 'emp_country_ru', 'emp_passport', 'emp_issued', 'emp_pinfl', 'emp_address', 'emp_phone',
        'emp_position_uz', 'emp_position_ru', 'emp_unit_uz', 'emp_unit_ru', 'lc_no', 'lc_date', 'dismiss_date',
      ] },
      { title: 'Kelishuv', keys: ['nda_no', 'nda_date', 'lookback_months', 'restrict_months', 'fine_brv', 'fine_cap_brv', 'dept_head'] },
      { title: 'Asosiy mijozlar (kelishuv, 1-ilova)', keys: ['kc_1_name', 'kc_1_country', 'kc_2_name', 'kc_2_country', 'kc_3_name', 'kc_3_country'] },
      { title: 'Topshirish dalolatnomasi (kelishuv, 2-ilova)', keys: [
        'act_date', 'act_items_uz', 'act_items_ru', 'act_accounts_uz', 'act_accounts_ru', 'act_chats_uz', 'act_chats_ru',
        'acc_position_uz', 'acc_position_ru', 'acc_name', 'acc_name_ru',
      ] },
      { title: 'Ruxsat berilgan boʻlinmalar (buyruq, 3-ilova)', keys: ['ts_unit_1', 'ts_unit_2', 'ts_unit_3', 'ts_unit_4', 'ts_unit_5', 'ts_unit_6'] },
    ],
  },
  {
    id: 'court', label: 'Sud arizalari',
    intro: 'Sudlarga ariza va iltimosnomalar. Hujjat turini tanlang.',
    separate: true,
    requireKey: 'court',
  },
]

// ---- form sections ----------------------------------------------------------
// Separate categories (court) have no shared panels, so their long field list is
// split into readable sections in the editor. Unlisted keys fall into "Maʼlumotlar".

const FIELD_SECTION: Record<string, string> = {
  court: 'Sud va ish', judge: 'Sud va ish', case_number: 'Sud va ish',
  hearing_date: 'Majlis va asos', hearing_time: 'Majlis va asos', reason: 'Majlis va asos',
  legal_basis: 'Majlis va asos', order_date: 'Majlis va asos', order_number: 'Majlis va asos',
  amount: 'Majlis va asos', beneficiary: 'Majlis va asos',
  company: 'Tomonlar', director: 'Tomonlar', rep_name: 'Tomonlar', address: 'Tomonlar',
  plaintiff: 'Tomonlar', contract_subject: 'Tomonlar', applicant_person: 'Tomonlar',
  phone: 'Tomonlar', passport: 'Tomonlar', executor: 'Tomonlar',
}
const SECTION_ORDER = ['Sud va ish', 'Tomonlar', 'Majlis va asos', 'Maʼlumotlar']

/** Split a flat field list into ordered, titled sections (empty ones dropped). */
export function sectionsFor(keys: string[]): { title: string; keys: string[] }[] {
  const by = new Map<string, string[]>()
  keys.forEach((k) => {
    const t = FIELD_SECTION[k] ?? 'Maʼlumotlar'
    by.set(t, [...(by.get(t) ?? []), k])
  })
  return SECTION_ORDER.filter((t) => by.has(t)).map((t) => ({ title: t, keys: by.get(t)! }))
}

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
  return { ...defaultsFor([...keys]), ...tab.defaults }
}

/** Initial values for a single document's own form. */
export function docDefaults(doc: DocDef): Record<string, string> {
  return defaultsFor(doc.fields)
}
