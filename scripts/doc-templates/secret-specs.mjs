// Where the variable parts sit in the two «Tijorat siri» originals (the order and the employee agreement), by PLACE.
// Both files are Russian | Uzbek side by side: every paragraph is a cell of a 2-column table, so a place is
// { tbl, row, cell, p } and a span inside it is a literal marker (`at`) or the words around it (`from` / `to`).
// Nothing personal is written down here: the originals carry bracketed blanks («[номер]», «[raqam]») and the
// company's own constants; the values a user types come from the form.
//
// `file` is the original's id (the 8 hex characters its file name starts with; see `srcFile`).
// `fixes` are deliberate corrections of the source, applied before anything is read from it.
// An op is { key | ph, sel, sub } (replace the span with {{key}} or the literal `ph`) or { key, empty: sel } (put
// {{key}} into a blank table cell: the rows of a list the user now fills). Ops run in order.
//
// Derived keys (…_dmy / …_ru / …_uz, terms in words, Cyrillic names) are computed from one input in
// src/lib/documents/derive.ts; here they are just placeholders like any other.

const at = (s, nth) => ({ at: s, ...(nth ? { nth } : {}) })
const P = (tbl, row, cell, p = 0) => ({ tbl, row, cell, p })

// the heading lines of an annex to the order: «к приказу № [номер] от 09.10.2026 г.» | «2026-yil 9-oktyabrdagi [raqam]-sonli buyruqqa»
const orderAnnexHead = (tbl) => [
  { key: 'ts_order_no', sel: P(tbl, 1, 0), sub: at('[номер]') },
  { key: 'ts_order_date_dmy', sel: P(tbl, 1, 0), sub: at('09.10.2026') },
  { key: 'ts_order_date_uz', sel: P(tbl, 1, 1), sub: at('2026-yil 9-oktyabr') },
  { key: 'ts_order_no', sel: P(tbl, 1, 1), sub: at('[raqam]') },
]
// …and of an annex to the agreement
const ndaAnnexHead = (tbl) => [
  { key: 'nda_no', sel: P(tbl, 1, 0), sub: at('NDA-E1') },
  { key: 'nda_date_dmy', sel: P(tbl, 1, 0), sub: at('09.10.2026') },
  { key: 'nda_date_uz', sel: P(tbl, 1, 1), sub: at('2026-yil 9-oktyabr') },
  { key: 'nda_no', sel: P(tbl, 1, 1), sub: at('NDA-E1') },
]

export const SECRET_SPECS = [
  {
    name: 'ts1_buyruq',
    file: 'cfda1cd4',
    // Annex 3 says «от 08.10.2026» while the order and annexes 1 and 2 say 09.10.2026: one order, one date.
    fixes: [
      ['от 08.10.2026', 'от 09.10.2026'],
      ['2026-yil 8-oktyabrdagi', '2026-yil 9-oktyabrdagi'],
    ],
    ops: [
      // heading
      { key: 'sc_company_ru_q', sel: P(0, 0, 0) },
      { key: 'sc_company_uz', sel: P(0, 0, 1) },
      { key: 'ts_order_no', sel: P(0, 1, 0), sub: at('[номер]') },
      { key: 'ts_order_no', sel: P(0, 1, 1), sub: at('[raqam]') },
      { key: 'ts_order_date_dmy', sel: P(0, 2, 0), sub: at('09.10.2026') },
      { key: 'ts_order_date_dmy', sel: P(0, 2, 1), sub: at('09.10.2026') },
      // 1. the regime starts on…
      { key: 'sc_company_ru', sel: P(0, 6, 0), sub: { from: 'Установить в ', to: ' (далее' } },
      { key: 'ts_regime_date_dmy', sel: P(0, 6, 0), sub: at('08.10.2026') },
      { key: 'sc_company_uz', sel: P(0, 6, 1), sub: { from: '1. ', to: 'da (bundan' } },
      { key: 'ts_regime_date_uz', sel: P(0, 6, 1), sub: at('2026-yil 8-oktyabr') },
      // 4. the responsible person (title and name, in the case the sentence needs)
      { key: 'resp_ru', sel: P(0, 9, 0), sub: { from: 'Назначить ', to: ' ответственным' } },
      { key: 'resp_uz', sel: P(0, 9, 1), sub: { from: '4. ', to: ' tijorat siri rejimiga' } },
      // 11. how long the duty to keep the secret outlives the employment
      { key: 'conf_ru_nom', sel: P(0, 18, 0), sub: at('2 (два) года') },
      { key: 'conf_uz', sel: P(0, 18, 1), sub: at('2 (ikki)') },
      // signature
      { key: 'dir_short_ru', sel: P(1, 0, 0), sub: { from: '______________ ' } },
      { key: 'dir_short_uz', sel: P(1, 0, 1), sub: { from: '______________ ' } },
      // annexes 1–3
      ...orderAnnexHead(2),
      ...orderAnnexHead(3),
      ...orderAnnexHead(4),
      // annex 3: the units whose employees have access
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ key: `ts_unit_${n}`, empty: P(4, 3 + n, 1) })),
    ],
  },
  {
    name: 'ts2_kelishuv',
    file: '9986083c',
    fixes: [],
    ops: [
      // heading: number, date
      { key: 'nda_no', sel: P(0, 0, 0), sub: at('NDA-E1') },
      { key: 'nda_no', sel: P(0, 0, 1), sub: at('NDA-E1') },
      { key: 'nda_date_dmy', sel: P(0, 2, 0), sub: at('09.10.2026') },
      { key: 'nda_date_dmy', sel: P(0, 2, 1), sub: at('09.10.2026') },
      // parties
      { key: 'sc_company_ru', sel: P(0, 3, 0), sub: { to: ' (далее' } },
      { key: 'dir_short_ru_gen', sel: P(0, 3, 0), sub: { from: 'в лице Директора ', to: ', действующего' } },
      { key: 'emp_country_ru', sel: P(0, 3, 0, 1), sub: at('[Республики Узбекистан]') },
      { key: 'emp_name_ru', sel: P(0, 3, 0, 1), sub: at('[Фамилия Имя Отчество]') },
      { key: 'emp_passport', sel: P(0, 3, 0, 1), sub: at('[серия и номер]') },
      { key: 'emp_issued', sel: P(0, 3, 0, 1), sub: at('[кем и когда]') },
      { key: 'emp_pinfl', sel: P(0, 3, 0, 1), sub: at('[ПИНФЛ]') },
      { key: 'emp_address', sel: P(0, 3, 0, 1), sub: at('[адрес]') },
      { key: 'sc_company_uz', sel: P(0, 3, 1), sub: { to: ' (bundan buyon' } },
      { key: 'dir_short_uz', sel: P(0, 3, 1), sub: { from: 'Direktor ', to: ', bir tomondan' } },
      { key: 'emp_country_uz', sel: P(0, 3, 1, 1), sub: at('[Oʻzbekiston Respublikasi]') },
      { key: 'emp_name', sel: P(0, 3, 1, 1), sub: at('[Familiyasi Ismi Otasining ismi]') },
      { key: 'emp_passport', sel: P(0, 3, 1, 1), sub: at('[seriyasi va raqami]') },
      { key: 'emp_issued', sel: P(0, 3, 1, 1), sub: at('[kim tomonidan va qachon]') },
      { key: 'emp_pinfl', sel: P(0, 3, 1, 1), sub: at('[JShShIR]') },
      { key: 'emp_address', sel: P(0, 3, 1, 1), sub: at('[manzil]') },
      // 1.1 the employment contract
      { key: 'lc_no', sel: P(0, 5, 0), sub: at('[номер]') },
      { key: 'lc_date_dmy', sel: P(0, 5, 0), sub: at('[дата]') },
      { key: 'emp_position_ru', sel: P(0, 5, 0), sub: at('[должность]') },
      { key: 'emp_unit_ru', sel: P(0, 5, 0), sub: at('[подразделение]') },
      { key: 'emp_position_uz', sel: P(0, 5, 1), sub: at('[lavozim]') },
      { key: 'emp_unit_uz', sel: P(0, 5, 1), sub: at('[boʻlinma]') },
      { key: 'lc_date_dmy', sel: P(0, 5, 1), sub: at('[sana]') },
      { key: 'lc_no', sel: P(0, 5, 1), sub: at('[raqam]') },
      // 1.2 the dismissal date
      { key: 'dismiss_date_ru', sel: P(0, 6, 0), sub: at('9 октября 2026') },
      { key: 'dismiss_date_uz', sel: P(0, 6, 1), sub: at('2026-yil 9-oktyabr') },
      // 1.3 the order that approved the list of secrets (the same order the buyruq form fills)
      { key: 'ts_order_no', sel: P(0, 7, 0), sub: at('[номер]') },
      { key: 'ts_order_date_dmy', sel: P(0, 7, 0), sub: at('09.10.2026') },
      { key: 'ts_order_date_uz', sel: P(0, 7, 1), sub: at('2026-yil 9-oktyabr') },
      { key: 'ts_order_no', sel: P(0, 7, 1), sub: at('[raqam]') },
      // the terms
      { key: 'lookback_ru', sel: P(0, 8, 0), sub: at('24 (двадцати четырёх) месяцев') },
      { key: 'lookback_uz', sel: P(0, 8, 1), sub: at('24 (yigirma toʻrt)') },
      { key: 'restrict_ru_nom', sel: P(0, 11, 0), sub: at('12 (двенадцать) месяцев') },
      { key: 'restrict_uz', sel: P(0, 11, 1), sub: at('12 (oʻn ikki)') },
      { key: 'conf_ru_gen', sel: P(0, 19, 0), sub: at('2 (двух) лет') },
      { key: 'conf_uz', sel: P(0, 19, 1), sub: at('2 (ikki)') },
      { key: 'restrict_ru_gen', sel: P(0, 28, 0), sub: at('12 (двенадцати) месяцев') },
      { key: 'restrict_uz', sel: P(0, 28, 1), sub: at('12 (oʻn ikki)') },
      { key: 'fine_ru', sel: P(0, 33, 0), sub: at('30 (тридцати) базовых расчётных величин') },
      { key: 'cap_ru', sel: P(0, 33, 0), sub: at('50 (пятидесяти) базовых расчётных величин') },
      { key: 'fine_uz', sel: P(0, 33, 1), sub: at('30 (oʻttiz)') },
      { key: 'cap_uz', sel: P(0, 33, 1), sub: at('50 (ellik)') },
      // 9. requisites
      { key: 'sc_company_ru', sel: P(0, 48, 0), sub: { to: 'Адрес' } },
      { key: 'sc_addr_ru', sel: P(0, 48, 0), sub: { from: 'Адрес: ', trim: true } },
      { key: 'sc_tin', sel: P(0, 48, 0, 1), sub: { from: 'ИНН: ', to: 'E-mail' } },
      { key: 'sc_email', sel: P(0, 48, 0, 1), sub: { from: 'E-mail: ' } },
      { key: 'sc_company_uz', sel: P(0, 48, 1), sub: { to: ' Manzil' } },
      { key: 'sc_addr_uz', sel: P(0, 48, 1), sub: { from: 'Manzil: ', to: 'STIR' } },
      { key: 'sc_tin', sel: P(0, 48, 1), sub: { from: 'STIR: ', to: 'E-mail' } },
      { key: 'sc_email', sel: P(0, 48, 1), sub: { from: 'E-mail: ' } },
      { key: 'emp_name_ru', sel: P(0, 49, 0), sub: at('[Фамилия Имя Отчество]') },
      { key: 'emp_passport', sel: P(0, 49, 0), sub: at('[серия и номер]') },
      { key: 'emp_pinfl', sel: P(0, 49, 0), sub: at('[ПИНФЛ]') },
      { key: 'emp_address', sel: P(0, 49, 0), sub: at('[адрес]') },
      { key: 'emp_phone', sel: P(0, 49, 0), sub: at('[телефон]') },
      { key: 'emp_name', sel: P(0, 49, 1), sub: at('[Familiyasi Ismi Otasining ismi]') },
      { key: 'emp_passport', sel: P(0, 49, 1), sub: at('[seriyasi va raqami]') },
      { key: 'emp_pinfl', sel: P(0, 49, 1), sub: at('[JShShIR]') },
      { key: 'emp_address', sel: P(0, 49, 1), sub: at('[manzil]') },
      { key: 'emp_phone', sel: P(0, 49, 1), sub: at('[telefon]') },
      { key: 'dir_short_ru', sel: P(0, 50, 0, 2), sub: { from: '______________________ ' } },
      { key: 'emp_name_ru', sel: P(0, 50, 1, 2), sub: at('[Ф.И.О.]') },
      // annex 1: the key clients, and who signs
      ...ndaAnnexHead(2),
      ...[1, 2, 3].flatMap((n) => [
        { key: `kc_${n}_name`, sel: P(2, 3 + n, 1), sub: at('[наименование / nomi]') },
        { key: `kc_${n}_country`, sel: P(2, 3 + n, 2), sub: at('[страна / mamlakat]') },
      ]),
      { key: 'dir_full_ru', sel: P(3, 0, 0, 1), sub: { from: '______________________ ' } },
      { key: 'dept_head', sel: P(3, 1, 0, 2), sub: { from: '______________________ ' } },
      { key: 'emp_name_ru', ph: '{{emp_name_ru}} / {{emp_name}}', sel: P(3, 2, 0, 2), sub: at('[Ф.И.О. / F.I.Sh.]') },
      // annex 2: the return act
      ...ndaAnnexHead(4),
      { key: 'act_date_ru', sel: P(4, 3, 0), sub: at('[дата] 2026') },
      { key: 'act_date_uz', sel: P(4, 3, 1), sub: at('2026-yil [sana]') },
      { key: 'act_items_ru', sel: P(4, 4, 0), sub: at('[перечень: ноутбук, телефон, документы, носители, пропуск]') },
      { key: 'act_items_uz', sel: P(4, 4, 1), sub: at('[roʻyxat: noutbuk, telefon, hujjatlar, axborot tashuvchilar, ruxsatnoma]') },
      { key: 'act_accounts_ru', sel: P(4, 6, 0), sub: at('[перечень]') },
      { key: 'act_chats_ru', sel: P(4, 6, 0), sub: at('[перечень]') },
      { key: 'act_accounts_uz', sel: P(4, 6, 1), sub: at('[roʻyxat]') },
      { key: 'act_chats_uz', sel: P(4, 6, 1), sub: at('[roʻyxat]') },
      { key: 'acc_position_ru', sel: P(5, 0, 0), sub: at('[должность]') },
      { key: 'acc_position_uz', sel: P(5, 0, 0), sub: at('[lavozim]') },
      { key: 'acc_name_ru', ph: '{{acc_name_ru}} / {{acc_name}}', sel: P(5, 0, 0, 1), sub: at('[Ф.И.О. / F.I.Sh.]') },
      { key: 'emp_name_ru', ph: '{{emp_name_ru}} / {{emp_name}}', sel: P(5, 0, 1, 2), sub: at('[Ф.И.О. / F.I.Sh.]') },
    ],
  },
]
