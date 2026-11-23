// The «Toʻlovlar» tab: every company's bills (those that name a case) by year, from the backup's own counts: nothing is downloaded until a year is opened.
import { h } from '../ui/h.js'
import { Empty } from '../ui/components.js'
import { icon } from '../ui/icons.js'
import { api } from '../core/api.js'
import { go } from '../core/router.js'
import { num } from '../core/format.js'
import { companyTitle } from './common.js'

export async function billsTab(_route, { signal }) {
  const j = await api.companies({ signal })
  const cs = (j.companies || []).filter((c) => c.bills > 0)
  if (!cs.length) return h('div', { class: 'stack' }, Empty('Zaxirada ish raqamiga bogʻlangan kvitansiya yoʻq.'))
  const total = cs.reduce((a, c) => a + c.bills, 0)
  return h('div', { class: 'stack' },
    h('div', { class: 'section-label' }, `${num(total)} ta kvitansiya · ${cs.length} kompaniya`),
    ...cs.map((c) => h('section', { class: 'card' },
      h('button', { type: 'button', class: 'bcard__head', on: { click: () => go({ name: 'company', key: c.tin, tab: 'bills' }) } },
        h('span', { class: c.name ? 'ccard__name' : 'ccard__tin mono' }, companyTitle(c)), h('span', { class: 'muted small' }, `${num(c.bills)} ta`), h('span', { class: 'row__chev' }, icon('chevron', 18))),
      h('div', { class: 'cardrow cardrow--wrap' }, ...c.billYears.map((y) =>
        h('button', { type: 'button', class: 'mcard mcard--small', on: { click: () => go({ name: 'company', key: c.tin, tab: 'bills', year: String(y.year) }) } },
          h('span', { class: 'mcard__title mono' }, String(y.year)), h('span', { class: 'mcard__big mono' }, num(y.bills))))))),
    h('p', { class: 'muted small hint' }, 'Faqat ishga bogʻlangan kvitansiyalar saqlanadi.'))
}
