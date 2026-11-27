// The «Toʻlovlar» tab: the bills themselves (those that name a case), one company at a time: a company bar (the biggest first), then the year, a search and the rows in
// pages of 10 / 30 / 50 / 100 with ‹ › (the same list as a company's own «Toʻlovlar» tab).
import { h } from '../ui/h.js'
import { Empty, Picker } from '../ui/components.js'
import { api } from '../core/api.js'
import { remember } from '../core/router.js'
import { num } from '../core/format.js'
import { companyTitle } from './common.js'
import { billsPane } from './company.js'

export async function billsTab(route, { signal }) {
  const j = await api.companies({ signal })
  const cs = (j.companies || []).filter((c) => c.bills > 0)
  if (!cs.length) return h('div', { class: 'stack' }, Empty('Zaxirada ish raqamiga bogʻlangan kvitansiya yoʻq.'))
  const total = cs.reduce((a, c) => a + c.bills, 0)
  const host = h('div', {})
  const draw = (tin, fresh) => {
    const c = cs.find((x) => x.tin === tin)
    const years = c.billYears.slice().sort((a, b) => b.year - a.year) // [{ year, bills }]: the year drop-down shows the counts
    const base = fresh ? { name: 'home', tab: 'bills', tin } : { ...route, name: 'home', tab: 'bills', tin }
    remember(base)
    host.replaceChildren(billsPane(tin, years, base, signal, { name: 'home', tab: 'bills', tin }))
  }
  const first = cs.some((c) => c.tin === route.tin) ? route.tin : cs[0].tin
  const picker = Picker({ label: 'Kompaniya', value: first, onPick: (tin) => draw(tin, true),
    items: cs.map((c) => ({ value: c.tin, title: companyTitle(c), sub: `STIR ${c.tin} · ${c.billYears.length} yil`, big: num(c.bills) })) })
  draw(first, false)
  return h('div', { class: 'stack' }, h('div', { class: 'section-label' }, `${num(total)} ta kvitansiya · ${cs.length} kompaniya`), picker, host)
}
