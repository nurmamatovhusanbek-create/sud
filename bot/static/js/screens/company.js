import { h } from '../ui/h.js'
import { Bars, Button, Card, Chips, Columns, Empty, ErrorBox, Field, Hero, Row, Stats, Tabs } from '../ui/components.js'
import { billWord } from '../ui/status.js'
import { api } from '../core/api.js'
import { go, remember } from '../core/router.js'
import { dmy, has, money, num } from '../core/format.js'
import { d } from '../core/text.js'
import { COURT, courtName, TopBar } from './common.js'

const PAGE = 30

/** a paged, filterable list: `fetch(offset)` → { total, rows, head? }, `row(x)` → node. Replaces its own body; "more" appends. */
function Paged({ fetch, row, summary, empty }) {
  const body = h('div', {})
  const list = h('div', { class: 'list' })
  const more = h('div', { class: 'screen__more' })
  let offset = 0
  async function load(first) {
    try {
      const r = await fetch(offset)
      if (first) {
        body.replaceChildren()
        if (!r.rows.length) { body.append(Empty(empty)); return }
        body.append(h('div', { class: 'section-label' }, summary(r)), list, more)
        list.replaceChildren()
      }
      list.append(...r.rows.map(row))
      offset += r.rows.length
      more.replaceChildren(offset < r.total ? Button({ label: `Yana ${Math.min(PAGE, r.total - offset)} ta…`, block: true, onClick: () => load(false) }) : '')
    } catch (e) {
      if (e?.name === 'AbortError') return
      body.replaceChildren(ErrorBox(e.message, () => { offset = 0; load(true) }))
    }
  }
  load(true)
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
      fetch: (offset) => api.companyCases({ tin, court: st.court, q: st.q, offset, limit: PAGE }, { signal }).then((j) => j.cases),
      row: (x) => Row({ icon: 'case', title: x.key, sub: `${courtName(x.court)} · 20${x.year}`, onOpen: () => go({ name: 'case', key: x.key }) }),
      summary: (r) => `${num(r.total)} ta ish`,
      empty: 'Ish topilmadi.',
    }))
  }
  api.companyCases({ tin, court: '', q: '', offset: 0, limit: 1 }, { signal }).then((j) => {
    const courts = j.cases.courts
    const options = [{ value: '', label: 'Hammasi' }, ...Object.keys(courts).map((k) => ({ value: k, label: `${COURT[k] || k} ${num(courts[k])}` }))]
    const chipsHost = h('div', {})
    const drawChips = () => chipsHost.replaceChildren(Chips(options, st.court, (v) => { st.court = v; keep(); drawChips(); show() }))
    drawChips()
    const field = Field({ placeholder: 'Ish raqami boʻyicha filtr…', value: st.q, compact: true, onInput: debounce((v) => { st.q = v.trim(); keep(); show() }) })
    filters.replaceChildren(field.el, chipsHost)
    show()
  }).catch((e) => { if (e?.name !== 'AbortError') host.replaceChildren(ErrorBox(e.message)) })
  host.append(filters, results)
  return host
}

function billsPane(tin, years, route, signal) {
  const st = { year: route.year || String(years[0] || ''), q: route.q || '' }
  if (!st.year) return Empty('Kvitansiyalar zaxirada yoʻq.')
  const filters = h('div', { class: 'screen__filters' })
  const results = h('div', {})
  const keep = () => remember({ ...route, name: 'company', tab: 'bills', year: st.year, q: st.q })
  const show = () => {
    results.replaceChildren(Paged({
      fetch: (offset) => api.companyBills({ tin, year: st.year, q: st.q, offset, limit: PAGE }, { signal }).then((j) => j.bills),
      row: (x) => Row({ icon: 'bill', title: x.number, sub: [`${d(x.cat)} · ${money(x.amount)} · ${billWord(x.status)} · ${dmy(x.issued)}`, has(x.caseNumber) && `ish ${x.caseNumber}`].filter(Boolean).join(' · '), onOpen: () => go({ name: 'bill', key: x.number }) }),
      summary: (r) => `${num(r.total)} ta · jami ${money(r.sum)} · toʻlangan ${money(r.paid)}`,
      empty: 'Kvitansiya topilmadi.',
    }))
  }
  const chipsHost = h('div', {})
  const drawChips = () => chipsHost.replaceChildren(Chips(years.map((y) => ({ value: String(y), label: String(y) })), st.year, (v) => { st.year = v; keep(); drawChips(); show() }))
  drawChips()
  const field = Field({ placeholder: 'Kvitansiya yoki ish raqami, sud…', value: st.q, compact: true, onInput: debounce((v) => { st.q = v.trim(); keep(); show() }) })
  filters.append(field.el, chipsHost)
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
    Hero({ caption: 'Kompaniya · STIR', id: o.tin, line: dates }),
    Stats([num(o.cases), 'ish'], [num(o.bills), 'toʻlov'], [String(o.byYear.length), 'yil']),
    Tabs([{ value: 'overview', label: 'Umumiy' }, { value: 'cases', label: 'Ishlar' }, { value: 'bills', label: 'Toʻlovlar' }], tab, (v) => go({ name: 'company', key: o.tin, tab: v }, { replace: true })),
    tab === 'overview' ? overviewPane(o, years) : tab === 'cases' ? casesPane(o.tin, route, signal) : billsPane(o.tin, years, route, signal))
}
