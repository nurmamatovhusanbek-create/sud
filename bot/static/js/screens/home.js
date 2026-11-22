import { h } from '../ui/h.js'
import { Columns, Empty, Hero } from '../ui/components.js'
import { icon } from '../ui/icons.js'
import { api } from '../core/api.js'
import { go } from '../core/router.js'
import { dmy, num } from '../core/format.js'
import { setHint } from '../shell.js'

/** a company as a card: its identifier, three figures and when its data is from */
function CompanyCard(c) {
  return h('button', { type: 'button', class: 'ccard', on: { click: () => go({ name: 'company', key: c.tin }) } },
    h('div', { class: 'split' }, h('span', { class: 'ccard__tin mono' }, c.tin), h('span', { class: 'row__chev' }, icon('chevron', 18))),
    h('div', { class: 'ccard__figs' },
      h('span', {}, h('b', { class: 'mono' }, num(c.found + c.listed)), ' ish'),
      h('span', {}, h('b', { class: 'mono' }, num(c.bills)), ' toʻlov'),
      h('span', { class: 'muted' }, c.refreshedAt ? `${dmy(c.refreshedAt)} holatiga` : '')))
}

export async function home(_route, { signal }) {
  const j = await api.companies({ signal })
  setHint(j.info)
  const cs = j.companies || []
  const totalCases = cs.reduce((a, c) => a + c.found + c.listed, 0)
  const nodes = [
    Hero({ caption: 'Zaxira', id: num(j.info?.indexed || 0), line: `yozuv · ${cs.length} kompaniya · ${num(totalCases)} ish` }),
  ]
  if (!j.info?.ready) nodes.push(Empty('Zaxira hali yuklanmoqda, bir ozdan soʻng qayta oching.'))
  nodes.push(h('div', { class: 'section-label' }, 'Kompaniyalar'), h('div', { class: 'ccards' }, ...cs.map(CompanyCard)))
  nodes.push(h('p', { class: 'muted small hint' }, 'Qidirish: ish raqami (', h('span', { class: 'mono' }, '2-1004-2603'), '), kvitansiya raqami (6+ raqam) yoki STIR (3+ raqam).'))
  return h('div', { class: 'screen stack' }, ...nodes)
}
