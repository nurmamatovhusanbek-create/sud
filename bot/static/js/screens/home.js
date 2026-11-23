import { h } from '../ui/h.js'
import { Columns, Empty, Hero } from '../ui/components.js'
import { icon } from '../ui/icons.js'
import { api } from '../core/api.js'
import { go } from '../core/router.js'
import { courtName } from './common.js'
import { dayDmy, dmy, nextDay, num } from '../core/format.js'
import { d } from '../core/text.js'
import { Row } from '../ui/components.js'
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

/** the next two weeks' hearings, grouped by day; today and tomorrow are named */
function Hearings(list, today) {
  if (!list.length) return null
  const nodes = [h('div', { class: 'section-label' }, `Yaqin majlislar (14 kun): ${list.length} ta`)]
  let day = 0
  let rows = []
  const flush = () => { if (rows.length) nodes.push(h('div', { class: 'list' }, ...rows)); rows = [] }
  for (const x of list) {
    if (x.day !== day) {
      flush()
      day = x.day
      const name = day === today ? 'Bugun' : day === nextDay(today) ? 'Ertaga' : ''
      nodes.push(h('div', { class: 'day-label' }, [name, dayDmy(day)].filter(Boolean).join(', ')))
    }
    const sides = [d(x.plaintiff), d(x.defendant)].filter(Boolean).join(' — ')
    rows.push(Row({ icon: 'case', title: x.caseNumber, tag: x.time || undefined, sub: [courtName(x.court), sides].filter(Boolean).join(' · '), onOpen: () => go({ name: 'case', key: x.caseNumber }) }))
  }
  flush()
  return h('div', { class: 'stack' }, ...nodes)
}

export async function home(_route, { signal }) {
  const j = await api.companies({ signal })
  // the hearings are a nice-to-have: a failure here must not hide the companies
  const hs = await api.hearings(14, { signal }).catch((e) => { if (e?.name === 'AbortError') throw e; return null })
  setHint(j.info)
  const cs = j.companies || []
  const totalCases = cs.reduce((a, c) => a + c.found + c.listed, 0)
  const nodes = [
    Hero({ caption: 'Zaxira', id: num(j.info?.indexed || 0), line: `yozuv · ${cs.length} kompaniya · ${num(totalCases)} ish` }),
  ]
  if (!j.info?.ready) nodes.push(Empty('Zaxira hali yuklanmoqda, bir ozdan soʻng qayta oching.'))
  if (hs) nodes.push(Hearings(hs.hearings || [], hs.today))
  nodes.push(h('div', { class: 'section-label' }, 'Kompaniyalar'), h('div', { class: 'ccards' }, ...cs.map(CompanyCard)))
  nodes.push(h('p', { class: 'muted small hint' }, 'Qidirish: ish raqami (', h('span', { class: 'mono' }, '2-1004-2603'), '), kvitansiya raqami (6+ raqam) yoki STIR (3+ raqam).'))
  return h('div', { class: 'screen stack' }, ...nodes)
}
