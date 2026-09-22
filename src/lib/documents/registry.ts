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

export type DocTab = 'visa' | 'iio'
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
  /** doc-specific field keys rendered inside this doc's card (beyond the shared groups) */
  extra: string[]
}

export interface TabDef {
  id: DocTab
  label: string
  intro: string
  groups: { title: string; keys: string[] }[]
  docs: DocDef[]
  /** per-tab default overrides (a key can mean different things in each tab) */
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

  // applicant
  full_name: { key: 'full_name', label: 'F.I.Sh (toʻliq)', placeholder: 'Ahmed Saleh' },
  sex: { key: 'sex', label: 'Jinsi', placeholder: 'Erkak / M' },
  dob: { key: 'dob', label: 'Tugʻilgan sana', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  birthplace: { key: 'birthplace', label: 'Tugʻilgan joyi', placeholder: 'Kalyobiya' },
  citizenship: { key: 'citizenship', label: 'Fuqaroligi', placeholder: 'Misr' },
  citizenship_en: { key: 'citizenship_en', label: 'Citizenship (EN)', placeholder: 'Arab Republic of Egypt' },
  citizenship_sentence: {
    key: 'citizenship_sentence', label: 'Fuqaroligi (matnda)',
    placeholder: 'Misr Arab Respublikasi', hint: 'Kafolat xati matnida «… fuqarolarini» dan oldin turadi',
  },
  passport: { key: 'passport', label: 'Pasport raqami', placeholder: 'A37041987', mono: true },
  position: { key: 'position', label: 'Lavozim', placeholder: 'GM operations' },
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
  responsible: { key: 'responsible', label: 'Masʼul shaxs (rasmiylashtiruvchi)', default: 'Jurayev N. +998(93) 433 30 33' },
  greeter: { key: 'greeter', label: 'Kutib oluvchi / hamroh shaxs', default: 'Ganiev H. +998(90) 951 61 00' },

  // ro'yxatga olish extras
  children: { key: 'children', label: 'Farzandlari', default: 'yo‘q' },
  visa_type: { key: 'visa_type', label: 'Viza turi', default: 'B2' },
  visa_no: { key: 'visa_no', label: 'Viza raqami', placeholder: '4933652', mono: true },
  visa_issuer: { key: 'visa_issuer', label: 'Viza kim tomonidan berilgan', default: '“Alukabel Payrav” MCHJ XK' },
  visa_from: { key: 'visa_from', label: 'Viza amal qiladi — dan', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  visa_to: { key: 'visa_to', label: 'Viza amal qiladi — gacha', kind: 'date', placeholder: 'kk.oo.yyyy', mono: true },
  visa_days: { key: 'visa_days', label: 'Muddat (kun)', default: '180', mono: true },
}

// ---- documents & tabs -------------------------------------------------------

export const DOCS: DocDef[] = [
  {
    id: 'visa1_invitation', tab: 'visa', lang: 'en', slug: 'invitation-letter',
    title: 'Invitation Letter', subtitle: 'Elchixona konsulligiga taklifnoma (EN)',
    file: 'visa1_invitation.docx', extra: ['role_en'],
  },
  {
    id: 'visa2_kafolat', tab: 'visa', lang: 'uz', slug: 'kafolat-xati',
    title: 'Kafolat xati', subtitle: 'TIV Konsulligi boshqarmasiga kafolat',
    file: 'visa2_kafolat.docx', extra: [],
  },
  {
    id: 'visa3_talabnoma', tab: 'visa', lang: 'uz', slug: 'viza-talabnomasi',
    title: 'Viza talabnomasi', subtitle: 'TIV Konsullik-huquqiy boshqarmasiga',
    file: 'visa3_talabnoma.docx',
    extra: ['entries', 'travel_from', 'travel_to', 'visa_place', 'cities', 'residence', 'responsible', 'greeter', 'reg_justice', 'reg_consular'],
  },
  {
    id: 'iio1_kafolat', tab: 'iio', lang: 'uz', slug: 'iio-kafolat-xati',
    title: 'Kafolat xati (IIO)', subtitle: 'Tuman IIO FMB MvaPB boshligʻiga',
    file: 'iio1_kafolat.docx', extra: [],
  },
  {
    id: 'iio2_royxat', tab: 'iio', lang: 'uz', slug: 'royxatga-olish-talabnomasi',
    title: 'Roʻyxatga olish talabnomasi', subtitle: 'Vaqtincha roʻyxatga olish (MvaPB)',
    file: 'iio2_royxat.docx',
    extra: ['children', 'visa_type', 'visa_no', 'visa_issuer', 'visa_from', 'visa_to', 'visa_days', 'responsible'],
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
    docs: DOCS.filter((d) => d.tab === 'visa'),
  },
  {
    id: 'iio', label: 'Ichki ishlar',
    intro: 'Tuman IIO / MvaPB uchun kafolat xati va vaqtincha roʻyxatga olish talabnomasi.',
    groups: [
      { title: 'Korxona', keys: ['company', 'director', 'doc_date', 'district_office'] },
      { title: 'Chet ellik xodim', keys: ['full_name', 'sex', 'dob', 'birthplace', 'citizenship', 'passport', 'position'] },
    ],
    docs: DOCS.filter((d) => d.tab === 'iio'),
    defaults: { responsible: 'Ganiev Hasan' },
  },
]

/** All field keys a tab touches (shared groups + every doc's extras). */
export function tabFieldKeys(tab: TabDef): string[] {
  const keys = new Set<string>()
  tab.groups.forEach((g) => g.keys.forEach((k) => keys.add(k)))
  tab.docs.forEach((d) => d.extra.forEach((k) => keys.add(k)))
  return [...keys]
}

/** Initial values for a tab: catalog defaults + per-tab overrides. */
export function tabDefaults(tab: TabDef): Record<string, string> {
  const out: Record<string, string> = {}
  tabFieldKeys(tab).forEach((k) => { out[k] = FIELDS[k]?.default ?? '' })
  if (tab.defaults) Object.assign(out, tab.defaults)
  return out
}

export function docById(id: string): DocDef | undefined {
  return DOCS.find((d) => d.id === id)
}
