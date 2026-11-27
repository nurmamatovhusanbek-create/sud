import { h } from '../ui/h.js'
import { Bars, Card, Columns, Empty, ErrorBox, Field, Hero, Pager, Row, Select, Skeletons, Stats, Tabs } from '../ui/components.js'
import { billWord } from '../ui/status.js'
import { api } from '../core/api.js'
import { go, remember } from '../core/router.js'
import { pageSize, setPageSize } from '../core/page-size.js'
import { dmy, has, money, num } from '../core/format.js'
import { d } from '../core/text.js'
import { COURT, companyTitle, courtName, TopBar } from './common.js'
import { ordersTab } from './orders.js'
import { hearingsTab } from './hearings.js'

/**
 * a paged list: `fetch(offset, limit)` → { total, rows }, `row(x)` → node, `summary(r)` → the line above. Pages of 10 / 30 / 50 / 100 (one choice for every list,
 * kept on this phone) with ‹ › and first / last, above AND below the rows. Replaces its own body.
 */
function Paged({ fetch, row, summary, empty }) {
  const body = h('div', { class: 'pager-anchor' })
  let page = 1
  let size = pageSize()
  async function load() {
    body.replaceChildren(Skeletons(2))
    try {
      const r = await fetch((page - 1) * size, size)
      const pages = Math.max(1, Math.ceil(r.total / size))
      if (page > pages) { page = pages; return load() }
      body.replaceChildren()
      if (!r.rows.length) { body.append(Empty(empty)); return }
      const turn = (n) => { page = n; load(); body.scrollIntoView({ block: 'start' }) }
      const resize = (n) => { size = n; setPageSize(n); page = 1; load() }
      const pager = () => Pager({ page, size, total: r.total, onPage: turn, onSize: resize })
      body.append(h('div', { class: 'section-label' }, summary(r)), pager(), h('div', { class: 'list' }, ...r.rows.map(row)), pager())
    } catch (e) {
      if (e?.name === 'AbortError') return
      body.replaceChildren(ErrorBox(e.message, load))
    }
  }
  load()
  return body
}

function casesPane(tin, route, signal) {
  const st = { court: route.court || '', q: route.q || '' }
  const host = h('div', { class: 'stack' })
  const filters = h('div', { class: 'screen__filters' })
  const results = h('div', {})
  const keep = () => remember({ ...route, name: 'company', tab: 'cases', court: st.court, q: st.q })
  const show = () => {
    results.replaceChildren(Paged({
      fetch: (offset, limit) => api.companyCases({ tin, court: st.court, q: st.q, offset, limit }, { signal }).then((j) => j.cases),
      row: (x) => Row({ icon: 'case', title: x.key, sub: `${courtName(x.court)} · 20${x.year}`, onOpen: () => go({ name: 'case', key: x.key }) }),
      summary: (r) => `${num(r.total)} ta ish`,
      empty: 'Ish topilmadi.',
    }))
  }
  api.companyCases({ tin, court: '', q: '', offset: 0, limit: 1 }, { signal }).then((j) => {
    const courts = j.cases.courts
    const choose = Select({ label: 'Sud turi', value: st.court, options: [{ value: '', label: `Hammasi · ${num(Object.values(courts).reduce((a, n) => a + n, 0))}` }, ...Object.keys(courts).map((k) => ({ value: k, label: `${COURT[k] || k} · ${num(courts[k])}` }))], onPick: (v) => { st.court = v; keep(); show() } })
    const field = Field({ placeholder: 'Ish raqami boʻyicha filtr…', value: st.q, compact: true, onInput: debounce((v) => { st.q = v.trim(); keep(); show() }) })
    filters.replaceChildren(field.el, h('div', { class: 'filters-grid' }, choose))
    show()
  }).catch((e) => { if (e?.name !== 'AbortError') host.replaceChildren(ErrorBox(e.message)) })
  host.append(filters, results)
  return host
}

/** a company's orders and hearings are the SAME screens as the home tabs (filters, counts, pages), fixed to this company */
const ordersPane = (tin, route, signal) => ordersTab(route, { signal }, { tin, where: { name: 'company', key: tin, tab: 'orders' } })
const hearingsPane = (tin, route, signal) => hearingsTab(route, { signal }, { tin, where: { name: 'company', key: tin, tab: 'hearings' } })

/** `where` = the route this pane lives in: a company screen's tab, or the home «Toʻlovlar» tab (which also remembers its company) */
export function billsPane(tin, years, route, signal, where = { name: 'company', tab: 'bills' }) {
  const first = years[0]
  const st = { year: route.year || String(first?.year ?? first ?? ''), q: route.q || '' }
  if (!st.year) return Empty('Kvitansiyalar zaxirada yoʻq.')
  const filters = h('div', { class: 'screen__filters' })
  const results = h('div', {})
  const keep = () => remember({ ...route, ...where, year: st.year, q: st.q })
  const show = () => {
    results.replaceChildren(Paged({
      fetch: (offset, limit) => api.companyBills({ tin, year: st.year, q: st.q, offset, limit }, { signal }).then((j) => j.bills),
      row: (x) => Row({ icon: 'bill', title: x.number, sub: [`${d(x.cat)} · ${money(x.amount)} · ${billWord(x.status)} · ${dmy(x.issued)}`, has(x.caseNumber) && `ish ${x.caseNumber}`].filter(Boolean).join(' · '), onOpen: () => go({ name: 'bill', key: x.number }) }),
      summary: (r) => `${num(r.total)} ta · jami ${money(r.sum)} · toʻlangan ${money(r.paid)}`,
      empty: 'Kvitansiya topilmadi.',
    }))
  }
  const choose = Select({ label: 'Yil', value: st.year, options: years.map((y) => ({ value: String(y.year ?? y), label: y.bills != null ? `${y.year} · ${num(y.bills)}` : String(y) })), onPick: (v) => { st.year = v; keep(); show() } })
  const field = Field({ placeholder: 'Kvitansiya yoki ish raqami, sud…', value: st.q, compact: true, onInput: debounce((v) => { st.q = v.trim(); keep(); show() }) })
  filters.append(field.el, h('div', { class: 'filters-grid' }, choose))
  show()
  return h('div', { class: 'stack' }, filters, results)
}

function debounce(fn, ms = 300) {
  let t = 0
  return (v) => { clearTimeout(t); t = setTimeout(() => fn(v), ms) }
}

function overviewPane(o, years) {
  const courts = Object.entries(o.courts).sort((a, b) => b[1] - a[1])
  return h('div', { class: 'stack' },
    courts.length > 0 && Card({ title: 'Sud turlari boʻyicha ishlar' }, Bars(courts.map(([k, v]) => ({ label: COURT[k] || k, value: v, onPick: () => go({ name: 'company', key: o.tin, tab: 'cases', court: k }) })), { format: num })),
    o.byYear.length > 0 && Card({ title: 'Ishlar roʻyxatga olingan yil' }, Columns(o.byYear.map((y) => ({ label: y.year, a: y.cases })))),
    o.byYear.some((y) => y.bills > 0) && Card({ title: 'Toʻlovlar (ishga bogʻlangan) yil boʻyicha' }, Bars(o.byYear.filter((y) => y.bills > 0).reverse().map((y) => ({ label: String(y.year), value: y.bills, onPick: () => go({ name: 'company', key: o.tin, tab: 'bills', year: String(y.year) }) })), { format: num })),
    years.length === 0 && Empty('Kvitansiyalar zaxirada yoʻq.'))
}

export async function company(route, { signal }) {
  const { overview: o } = await api.overview(route.key, { signal })
  const years = (o.years || []).slice().sort().reverse()
  const tab = route.tab || 'overview'
  const dates = [o.firstAt ? `Birinchi yuklash ${dmy(o.firstAt)}` : '', o.refreshedAt ? `maʼlumot ${dmy(o.refreshedAt)} holatiga` : ''].filter(Boolean).join(' · ') || 'Zaxiradagi kompaniya'
  return h('div', { class: 'screen stack' },
    TopBar(),
    Hero({ caption: o.name ? `Kompaniya · STIR ${o.tin}` : 'Kompaniya · STIR', id: companyTitle(o), line: dates, name: !!o.name }),
    Stats([num(o.cases), 'ish'], [num(o.bills), 'toʻlov'], [String(o.byYear.length), 'yil']),
    Tabs([{ value: 'overview', label: 'Umumiy' }, { value: 'cases', label: 'Ishlar' }, { value: 'bills', label: 'Toʻlovlar' }, { value: 'orders', label: 'Qarorlar' }, { value: 'hearings', label: 'Majlislar' }], tab, (v) => go({ name: 'company', key: o.tin, tab: v }, { replace: true })),
    tab === 'overview' ? overviewPane(o, years) : tab === 'cases' ? casesPane(o.tin, route, signal) : tab === 'orders' ? ordersPane(o.tin, route, signal) : tab === 'hearings' ? hearingsPane(o.tin, route, signal) : billsPane(o.tin, o.byYear.filter((y) => y.bills > 0).map((y) => ({ year: y.year, bills: y.bills })).sort((a, b) => b.year - a.year), route, signal))
}
