// The «Majlislar» tab: the upcoming hearings, narrowed by range, by company and by a text, a page at a time. A hundred hearings are never one long scroll:
// the range chips and the company cards narrow the list with one tap, and only 30 rows are drawn until «Yana» is pressed.
import { h } from '../ui/h.js'
import { CardRow, Chips, Empty, ErrorBox, Field, Row, Skeletons } from '../ui/components.js'
import { api } from '../core/api.js'
import { go, remember } from '../core/router.js'
import { dayDmy, nextDay, num } from '../core/format.js'
import { d } from '../core/text.js'
import { courtName, ROLE, STAGE } from './common.js'

const PAGE = 30
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

export function hearingsTab(route, { signal }) {
  const st = { days: Number(route.days) || 14, tin: route.tin || '', q: route.q || '' }
  const names = {} // STIR → name, for the company cards
  api.companies({ signal }).then((j) => { for (const c of j.companies || []) names[c.tin] = c.name ? d(c.name) : ''; }).catch(() => {})
  const chipsHost = h('div', {})
  const cardsHost = h('div', {})
  const listHost = h('div', { class: 'stack' })
  const keep = () => remember({ ...route, name: 'home', tab: 'hearings', days: st.days, tin: st.tin, q: st.q })

  let offset = 0
  let today = 0
  let lastDay = 0
  let list = null // the open `.list` of the current day group
  let more = null

  const draw = (page, first) => {
    today = page.today
    if (first) {
      chipsHost.replaceChildren(Chips(RANGES.map(([days, label]) => ({ value: days, label: `${label} · ${num(page.ranges[days] ?? 0)}` })), st.days, (v) => { st.days = v; keep(); load(true) }, { scroll: true }))
      const total = page.companies.reduce((a, c) => a + c.count, 0)
      cardsHost.replaceChildren(page.companies.length > 1 || st.tin
        ? CardRow([{ value: '', title: 'Hammasi', big: num(total), sub: `${page.companies.length} kompaniya` },
          ...page.companies.map((c) => ({ value: c.tin, title: names[c.tin] || c.tin, big: num(c.count), sub: `birinchi: ${dayLabel(c.nextDay, page.today).split(',')[0]} ${c.nextTime || ''}`.trim() }))], st.tin, (v) => { st.tin = v; keep(); load(true) })
        : '')
      listHost.replaceChildren()
      lastDay = 0
      list = null
      if (!page.rows.length) { listHost.append(Empty(st.q || st.tin ? 'Bu filtr boʻyicha majlis yoʻq.' : `Yaqin ${st.days === 1 ? 'bugun' : `${st.days} kunda`} majlis yoʻq (zaxira maʼlumotiga koʻra).`)); return }
      more = h('div', { class: 'screen__more' })
      listHost.append(h('div', { class: 'section-label' }, `${num(page.total)} ta majlis`), more)
    }
    for (const x of page.rows) {
      if (x.day !== lastDay) {
        lastDay = x.day
        listHost.insertBefore(h('div', { class: 'day-label' }, dayLabel(x.day, today)), more)
        list = h('div', { class: 'list' })
        listHost.insertBefore(list, more)
      }
      list.append(item(x))
    }
    offset += page.rows.length
    more.replaceChildren(offset < page.total
      ? h('button', { type: 'button', class: 'btn btn--block', on: { click: () => load(false) } }, `Yana ${Math.min(PAGE, page.total - offset)} ta (${num(offset)}/${num(page.total)})`)
      : '')
  }

  async function load(first) {
    if (first) { offset = 0; listHost.replaceChildren(Skeletons(2)) }
    try {
      const { page } = await api.hearings({ days: st.days, tin: st.tin, q: st.q, offset, limit: PAGE }, { signal })
      draw(page, first)
    } catch (e) {
      if (e?.name === 'AbortError') return
      listHost.replaceChildren(ErrorBox(e.message, () => load(true)))
    }
  }

  const field = Field({ placeholder: 'Ish raqami yoki tomon…', value: st.q, compact: true, onInput: debounce((v) => { st.q = v.trim(); keep(); load(true) }) })
  load(true)
  return h('div', { class: 'stack' }, chipsHost, cardsHost, field.el, listHost)
}
