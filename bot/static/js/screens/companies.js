// The «Kompaniyalar» tab: a card per company: its figures, when its data is from and how many hearings are coming.
import { h } from '../ui/h.js'
import { Empty } from '../ui/components.js'
import { icon } from '../ui/icons.js'
import { api } from '../core/api.js'
import { go } from '../core/router.js'
import { dayDmy, dmy, num } from '../core/format.js'
import { companyTitle } from './common.js'

export async function companiesTab(_route, { signal }) {
  const j = await api.companies({ signal })
  // the hearings are a nice-to-have: a failure here must not hide the companies
  const hs = await api.hearings({ days: 90, limit: 1 }, { signal }).then((r) => r.page.companies).catch((e) => { if (e?.name === 'AbortError') throw e; return [] })
  const cs = j.companies || []
  if (!cs.length) return h('div', { class: 'stack' }, Empty('Zaxirada kompaniya yoʻq.'))
  return h('div', { class: 'stack' }, h('div', { class: 'ccards' }, ...cs.map((c) => {
    const hc = hs.find((x) => x.tin === c.tin)
    return h('button', { type: 'button', class: 'ccard', on: { click: () => go({ name: 'company', key: c.tin }) } },
      h('div', { class: 'split' }, h('span', { class: c.name ? 'ccard__name' : 'ccard__tin mono' }, companyTitle(c)), h('span', { class: 'row__chev' }, icon('chevron', 18))),
      c.name && h('div', { class: 'ccard__id mono muted' }, `STIR ${c.tin}`),
      h('div', { class: 'ccard__figs' },
        h('span', {}, h('b', { class: 'mono' }, num(c.found + c.listed)), ' ish'),
        h('span', {}, h('b', { class: 'mono' }, num(c.bills)), ' toʻlov'),
        h('span', {}, h('b', { class: 'mono' }, num(hc?.count || 0)), ' majlis (90 kun)')),
      h('div', { class: 'ccard__meta muted' },
        hc ? h('div', {}, `Birinchi majlis: ${dayDmy(hc.nextDay)} ${hc.nextTime || ''}`.trim()) : null,
        h('div', {}, c.refreshedAt ? `Maʼlumot ${dmy(c.refreshedAt)} holatiga` : '')))
  })))
}
