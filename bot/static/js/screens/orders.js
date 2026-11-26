// The «Qarorlar» tab: every court order the backup knows (found by the app on public.sud.uz), newest case first, narrowed by text, by what was downloaded, by court,
// by result and by the case's year. A row opens the order's own screen (send to chat / ask for the download). Also the row and the pane the case and company screens reuse.
import { h } from '../ui/h.js'
import { CardRow, Empty, ErrorBox, Field, Row, Select, Skeletons } from '../ui/components.js'
import { api } from '../core/api.js'
import { go, remember } from '../core/router.js'
import { num } from '../core/format.js'
import { d } from '../core/text.js'
import { COURT } from './common.js'

const PAGE = 30

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

/** the company's name for a card: Latin, short; its STIR when the backup does not know the name */
const cardName = (c) => (d(c.name) || c.tin).slice(0, 26)

export function ordersTab(route, { signal }) {
  const st = { q: route.q || '', tin: route.tin || '', saved: route.saved || '', court: route.court || '', instance: route.instance || '', result: route.result || '', year: route.year || '' }
  const cardsHost = h('div', {})
  const selectsHost = h('div', {})
  const resetHost = h('div', {})
  const results = h('div', { class: 'stack' })
  const keep = () => remember({ ...route, name: 'home', tab: 'orders', ...st })
  let offset = 0

  const any = () => Object.values(st).some((v) => v !== '')
  const pick = (key, v) => { st[key] = v; keep(); load(true) }
  const withCount = (label, n) => (n == null ? label : `${label} · ${num(n)}`)

  const drawFacets = (f) => {
    // the company cards: «Hammasi» and one per company, scrolling sideways (the same cards as the Majlislar tab)
    cardsHost.replaceChildren(f.companies.length > 1 || st.tin
      ? CardRow([{ value: '', title: 'Hammasi', big: num(f.allCompanies), sub: `${f.companies.length} kompaniya` },
        ...f.companies.map((c) => ({ value: c.tin, title: cardName(c), big: num(c.count), sub: 'qaror' }))], st.tin, (v) => pick('tin', v))
      : '')
    const one = (key, label, all, opts) => Select({ label, value: st[key], options: [{ value: '', label: all }, ...opts], onPick: (v) => pick(key, v) })
    selectsHost.replaceChildren(h('div', { class: 'filters-grid' },
      one('instance', 'Instansiya', 'Hammasi', f.instances.map((x) => ({ value: x.value, label: withCount(x.word, x.count) }))),
      one('result', 'Natija', 'Hammasi', f.results.map((x) => ({ value: x.value, label: withCount(x.word, x.count) }))),
      one('year', 'Yil', 'Hammasi', f.years.map((x) => ({ value: String(x.value), label: withCount(`20${x.value}`, x.count) }))),
      one('court', 'Sud turi', 'Hammasi', Object.entries(f.courts).map(([k, n]) => ({ value: k, label: withCount(COURT[k] || k, n) }))),
      one('saved', 'Fayl', 'Hammasi', [{ value: '1', label: withCount('Yuklangan', f.saved) }, { value: '0', label: withCount('Yuklanmagan', f.unsaved) }])))
    resetHost.replaceChildren(any() ? h('button', { type: 'button', class: 'btn btn--small', on: { click: () => { for (const k of Object.keys(st)) st[k] = ''; field.input.value = ''; field.el.classList.remove('field--filled'); keep(); load(true) } } }, 'Filtrlarni tozalash') : '')
  }

  async function load(first) {
    if (first) { offset = 0; results.replaceChildren(Skeletons(2)) }
    try {
      const { orders: page } = await api.orders({ ...st, offset, limit: PAGE }, { signal })
      if (first) {
        drawFacets(page)
        results.replaceChildren()
        if (!page.rows.length) { results.append(Empty(any() ? 'Bu filtr boʻyicha qaror yoʻq.' : 'Zaxirada qarorlar yoʻq. Ilovada ishning «Qarorlar» tugmasini bosib tekshiring, soʻng zaxira oling.')); return }
        results.append(h('div', { class: 'section-label' }, `${num(page.total)} ta qaror · yuklangan ${num(page.saved)} · yuklanmagan ${num(page.unsaved)}`), h('div', { class: 'list' }), h('div', { class: 'screen__more' }))
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
  load(true)
  return h('div', { class: 'stack' }, field.el, cardsHost, selectsHost, resetHost, results)
}
