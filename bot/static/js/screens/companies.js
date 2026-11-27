// The «Kompaniyalar» tab: a card per company: its figures, when its data is from and how many hearings are coming. A search field (name or STIR) and pages of
// 10 / 30 / 50 / 100, because the list only grows.
import { h } from '../ui/h.js'
import { Empty, Field, Pager } from '../ui/components.js'
import { icon } from '../ui/icons.js'
import { api } from '../core/api.js'
import { go, remember } from '../core/router.js'
import { dayDmy, dmy, num } from '../core/format.js'
import { d } from '../core/text.js'
import { pageSize, setPageSize } from '../core/page-size.js'
import { companyTitle } from './common.js'

const card = (c, hs) => {
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
}

export async function companiesTab(route, { signal }) {
  const j = await api.companies({ signal })
  // the hearings are a nice-to-have: a failure here must not hide the companies
  const hs = await api.hearings({ days: 90, limit: 1 }, { signal }).then((r) => r.page.companies).catch((e) => { if (e?.name === 'AbortError') throw e; return [] })
  const cs = j.companies || []
  if (!cs.length) return h('div', { class: 'stack' }, Empty('Zaxirada kompaniya yoʻq.'))
  const st = { q: route.q || '' }
  let page = Math.max(1, Number(route.page) || 1)
  let size = pageSize()
  const host = h('div', { class: 'stack pager-anchor' })
  const keep = () => remember({ ...route, name: 'home', tab: 'companies', q: st.q, page })
  // the search matches the name (in Latin, whatever script the court used) and the STIR
  const hay = new Map(cs.map((c) => [c.tin, `${d(c.name)} ${c.tin}`.toLowerCase()]))
  const draw = () => {
    const q = d(st.q).trim().toLowerCase()
    const shown = q ? cs.filter((c) => hay.get(c.tin).includes(q)) : cs
    const pages = Math.max(1, Math.ceil(shown.length / size))
    if (page > pages) page = pages
    host.replaceChildren()
    if (!shown.length) { host.append(Empty('Bunday kompaniya topilmadi.')); return }
    const turn = (n) => { page = n; keep(); draw(); host.scrollIntoView({ block: 'start' }) }
    const resize = (n) => { size = n; setPageSize(n); page = 1; keep(); draw() }
    const pager = () => Pager({ page, size, total: shown.length, onPage: turn, onSize: resize })
    host.append(h('div', { class: 'section-label' }, q ? `${num(shown.length)} / ${num(cs.length)} kompaniya` : `${num(cs.length)} ta kompaniya`), pager(),
      h('div', { class: 'ccards' }, ...shown.slice((page - 1) * size, page * size).map((c) => card(c, hs))), pager())
  }
  const field = Field({ placeholder: 'Kompaniya nomi yoki STIR…', value: st.q, compact: true, onInput: (v) => { st.q = v.trim(); page = 1; keep(); draw() } })
  draw()
  return h('div', { class: 'stack' }, field.el, host)
}
