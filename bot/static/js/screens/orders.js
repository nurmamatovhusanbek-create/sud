// The «Qarorlar» tab: every court order the backup knows (found by the app on public.sud.uz), newest case first, narrowed by text, by what was downloaded, by court,
// by result and by the case's year. A row opens the order's own screen (send to chat / ask for the download). Also the row and the pane the case and company screens reuse.
import { h } from '../ui/h.js'
import { Chips, Empty, ErrorBox, Field, Row, Skeletons } from '../ui/components.js'
import { api } from '../core/api.js'
import { go, remember } from '../core/router.js'
import { num } from '../core/format.js'
import { d } from '../core/text.js'
import { COURT } from './common.js'

const PAGE = 30
const SAVED = [{ value: '', label: 'Hammasi' }, { value: '1', label: 'Yuklangan' }, { value: '0', label: 'Yuklanmagan' }]

const debounce = (fn, ms = 300) => { let t = 0; return (v) => { clearTimeout(t); t = setTimeout(() => fn(v), ms) } }

/** one order as a list row; `withCase` puts the case number first (lists across cases), otherwise the instance is the title (inside one case) */
export function orderRow(o, { withCase = true } = {}) {
  // «yuklanmagan» is a word of the line, not a pill beside the title: a pill takes a third of a narrow phone's row and wraps everything else
  const sub = [withCase ? o.instanceWord : '', o.resultWord, o.saved ? o.sizeLabel : 'yuklanmagan'].filter(Boolean).join(' · ')
  return Row({
    icon: 'order', title: withCase ? o.caseNumber : o.instanceWord,
    sub, sub2: d(o.court) || undefined,
    onOpen: () => go({ name: 'order', key: o.pdfId, case: o.caseNumber }),
  })
}

export function ordersTab(route, { signal }) {
  const st = { q: route.q || '', saved: route.saved || '', court: route.court || '', result: route.result || '', year: route.year || '' }
  const filters = h('div', { class: 'screen__filters' })
  const chipsHost = h('div', { class: 'stack' })
  const results = h('div', { class: 'stack' })
  const keep = () => remember({ ...route, name: 'home', tab: 'orders', ...st })
  let offset = 0
  let facets = null

  const drawChips = () => {
    const f = facets
    const rows = [Chips(SAVED.map((o) => ({ value: o.value, label: o.value === '1' ? `${o.label} · ${num(f?.saved ?? 0)}` : o.value === '0' ? `${o.label} · ${num(f?.unsaved ?? 0)}` : o.label })), st.saved, (v) => pick('saved', v), { scroll: true })]
    const courts = Object.entries(f?.courts || {})
    if (courts.length > 1 || st.court) rows.push(Chips([{ value: '', label: 'Barcha sudlar' }, ...courts.map(([k, n]) => ({ value: k, label: `${COURT[k] || k} · ${num(n)}` }))], st.court, (v) => pick('court', v), { scroll: true }))
    const rs = f?.results || []
    if (rs.length > 1 || st.result) rows.push(Chips([{ value: '', label: 'Har qanday natija' }, ...rs.map((r) => ({ value: r.value, label: `${r.word} · ${num(r.count)}` }))], st.result, (v) => pick('result', v), { scroll: true }))
    const years = f?.years || []
    if (years.length > 1 || st.year) rows.push(Chips([{ value: '', label: 'Barcha yillar' }, ...years.map((y) => ({ value: String(y), label: `20${y}` }))], st.year, (v) => pick('year', v), { scroll: true }))
    chipsHost.replaceChildren(...rows)
  }
  const pick = (key, v) => { st[key] = v; keep(); load(true) }

  async function load(first) {
    if (first) { offset = 0; results.replaceChildren(Skeletons(2)) }
    try {
      const { orders: page } = await api.orders({ q: st.q, saved: st.saved, court: st.court, result: st.result, year: st.year, offset, limit: PAGE }, { signal })
      if (first) {
        facets = page
        drawChips()
        results.replaceChildren()
        if (!page.rows.length) { results.append(Empty(st.q || st.saved || st.court || st.result || st.year ? 'Bu filtr boʻyicha qaror yoʻq.' : 'Zaxirada qarorlar yoʻq. Ilovada ishning «Qarorlar» tugmasini bosib tekshiring, soʻng zaxira oling.')); return }
        results.append(h('div', { class: 'section-label' }, `${num(page.total)} ta qaror`), h('div', { class: 'list' }), h('div', { class: 'screen__more' }))
      }
      const [, list, more] = results.children
      list.append(...page.rows.map((o) => orderRow(o)))
      offset += page.rows.length
      more.replaceChildren(offset < page.total ? h('button', { type: 'button', class: 'btn btn--block', on: { click: () => load(false) } }, `Yana ${Math.min(PAGE, page.total - offset)} ta (${num(offset)}/${num(page.total)})`) : '')
    } catch (e) {
      if (e?.name === 'AbortError') return
      results.replaceChildren(ErrorBox(e.message, () => load(true)))
    }
  }

  const field = Field({ placeholder: 'Ish raqami, sud, sudya…', value: st.q, compact: true, onInput: debounce((v) => { st.q = v.trim(); keep(); load(true) }) })
  filters.append(field.el, chipsHost)
  drawChips()
  load(true)
  return h('div', { class: 'stack' }, filters, results)
}
