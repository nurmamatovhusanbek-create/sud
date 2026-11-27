// The «Majlislar» tab: the upcoming hearings, narrowed by range, by company and by a text, in pages of 10 / 30 / 50 / 100 (with ‹ ›), grouped by day inside a page.
// A hundred hearings are never one long scroll: the range chips and the company bar narrow the list with one tap.
import { h } from '../ui/h.js'
import { Chips, Empty, ErrorBox, Field, Pager, Picker, Row, Skeletons } from '../ui/components.js'
import { api } from '../core/api.js'
import { go, remember } from '../core/router.js'
import { dayDmy, nextDay, num } from '../core/format.js'
import { d } from '../core/text.js'
import { pageSize, setPageSize } from '../core/page-size.js'
import { courtName, ROLE, STAGE } from './common.js'

const RANGES = [[1, 'Bugun'], [7, '7 kun'], [14, '14 kun'], [30, '30 kun'], [60, '60 kun']]

const debounce = (fn, ms = 300) => { let t = 0; return (v) => { clearTimeout(t); t = setTimeout(() => fn(v), ms) } }

function dayLabel(day, today) {
  const date = dayDmy(day)
  if (day === today) return `Bugun, ${date}`
  if (day === nextDay(today)) return `Ertaga, ${date}`
  return date
}

function item(x) {
  // the company's side is known: «Javobgar · qarshi tomon: X»; otherwise both parties as they are
  const sides = x.role ? `${ROLE[x.role]} · qarshi tomon: ${d(x.counterparty)}` : [d(x.plaintiff), d(x.defendant)].filter(Boolean).join(' — ')
  const sub = [courtName(x.court), STAGE[x.stage]].filter(Boolean).join(' · ')
  return Row({ icon: 'case', title: x.caseNumber, tag: x.time || undefined, sub, sub2: sides, onOpen: () => go({ name: 'case', key: x.caseNumber }) })
}

/** `opts.tin`: ONE company's hearings (the company screen's «Majlislar» tab): no company bar; `opts.where`: the route it lives in */
export function hearingsTab(route, { signal }, opts = {}) {
  const where = opts.where || { name: 'home', tab: 'hearings' }
  const st = { days: Number(route.days) || 14, tin: opts.tin ?? (route.tin || ''), q: route.q || '' }
  const names = {} // STIR → name, for the company cards
  let lastFacets = null // the names arrive after the first page: the company bar is drawn again with them
  api.companies({ signal }).then((j) => { for (const c of j.companies || []) names[c.tin] = c.name ? d(c.name) : ''; if (lastFacets) drawFacets(lastFacets) }).catch(() => {})
  const chipsHost = h('div', {})
  const cardsHost = h('div', {})
  const listHost = h('div', { class: 'stack pager-anchor' })
  const keep = () => remember({ ...route, ...where, days: st.days, tin: st.tin, q: st.q, page })

  let page = Math.max(1, Number(route.page) || 1)
  let size = pageSize()

  /** the filters (not the page) changed: the range chips and the company bar are drawn again */
  const drawFacets = (r) => {
    lastFacets = r
    chipsHost.replaceChildren(Chips(RANGES.map(([days, label]) => ({ value: days, label: `${label} · ${num(r.ranges[days] ?? 0)}` })), st.days, (v) => { st.days = v; page = 1; keep(); load(true) }, { scroll: true }))
    const total = r.companies.reduce((a, c) => a + c.count, 0)
    cardsHost.replaceChildren(!opts.tin && (r.companies.length > 1 || st.tin)
      ? Picker({ label: 'Kompaniya', value: st.tin, onPick: (v) => { st.tin = v; page = 1; keep(); load(true) },
        items: [{ value: '', title: 'Hammasi', big: num(total), sub: `${r.companies.length} kompaniya` },
          ...r.companies.map((c) => ({ value: c.tin, title: names[c.tin] || c.tin, big: num(c.count), sub: `birinchi: ${dayLabel(c.nextDay, r.today).split(',')[0]} ${c.nextTime || ''}`.trim() }))] })
      : '')
  }

  async function load(facets) {
    listHost.replaceChildren(Skeletons(2))
    try {
      const { page: r } = await api.hearings({ days: st.days, tin: st.tin, q: st.q, offset: (page - 1) * size, limit: size }, { signal })
      const pages = Math.max(1, Math.ceil(r.total / size))
      if (page > pages) { page = pages; keep(); return load(facets) } // the list got shorter than the page asked for
      if (facets || !chipsHost.firstChild) drawFacets(r)
      listHost.replaceChildren()
      if (!r.rows.length) { listHost.append(Empty(st.q || st.tin ? 'Bu filtr boʻyicha majlis yoʻq.' : `Yaqin ${st.days === 1 ? 'bugun' : `${st.days} kunda`} majlis yoʻq (zaxira maʼlumotiga koʻra).`)); return }
      const turn = (n) => { page = n; keep(); load(false); listHost.scrollIntoView({ block: 'start' }) }
      const resize = (n) => { size = n; setPageSize(n); page = 1; keep(); load(false) }
      const pager = () => Pager({ page, size, total: r.total, onPage: turn, onSize: resize })
      listHost.append(h('div', { class: 'section-label' }, `${num(r.total)} ta majlis`), pager())
      // the rows of THIS page, a heading and a card per day
      let lastDay = 0
      let list = null
      for (const x of r.rows) {
        if (x.day !== lastDay) {
          lastDay = x.day
          listHost.append(h('div', { class: 'day-label' }, dayLabel(x.day, r.today)))
          list = h('div', { class: 'list' })
          listHost.append(list)
        }
        list.append(item(x))
      }
      listHost.append(pager())
    } catch (e) {
      if (e?.name === 'AbortError') return
      listHost.replaceChildren(ErrorBox(e.message, () => load(facets)))
    }
  }

  const field = Field({ placeholder: 'Ish raqami yoki tomon…', value: st.q, compact: true, onInput: debounce((v) => { st.q = v.trim(); page = 1; keep(); load(true) }) })
  load(true)
  return h('div', { class: 'stack' }, chipsHost, cardsHost, field.el, listHost)
}
