// The «Qarorlar» tab: every court order the backup knows (found by the app on public.sud.uz), newest case first, narrowed by text, by what was downloaded, by court,
// by result and by the case's year. A row opens the order's own screen (send to chat / ask for the download). Also the row and the pane the case and company screens reuse.
import { h } from '../ui/h.js'
import { Empty, ErrorBox, Field, Pager, Picker, Row, Select, Skeletons } from '../ui/components.js'
import { api } from '../core/api.js'
import { go, remember } from '../core/router.js'
import { num } from '../core/format.js'
import { d } from '../core/text.js'
import { pageSize, setPageSize } from '../core/page-size.js'
import { COURT } from './common.js'

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
const companyName = (c) => d(c.name) || c.tin

export function ordersTab(route, { signal }) {
  const st = { q: route.q || '', tin: route.tin || '', saved: route.saved || '', court: route.court || '', instance: route.instance || '', result: route.result || '', year: route.year || '' }
  const cardsHost = h('div', {})
  const selectsHost = h('div', {})
  const resetHost = h('div', {})
  const results = h('div', { class: 'stack pager-anchor' })
  const keep = () => remember({ ...route, name: 'home', tab: 'orders', ...st, page })
  let page = Math.max(1, Number(route.page) || 1)
  let size = pageSize()

  const any = () => Object.values(st).some((v) => v !== '')
  const pick = (key, v) => { st[key] = v; page = 1; keep(); load(true) }
  const withCount = (label, n) => (n == null ? label : `${label} · ${num(n)}`)

  const drawFacets = (f) => {
    // the company choice: a bar with the current company and a list of all of them (full names, counts, a search when there are many)
    cardsHost.replaceChildren(f.companies.length > 1 || st.tin
      ? Picker({ label: 'Kompaniya', value: st.tin, onPick: (v) => pick('tin', v),
        items: [{ value: '', title: 'Hammasi', big: num(f.allCompanies), sub: `${f.companies.length} kompaniya` },
          ...f.companies.map((c) => ({ value: c.tin, title: companyName(c), big: num(c.count), sub: `STIR ${c.tin}` }))] })
      : '')
    const one = (key, label, all, opts) => Select({ label, value: st[key], options: [{ value: '', label: all }, ...opts], onPick: (v) => pick(key, v) })
    selectsHost.replaceChildren(h('div', { class: 'filters-grid' },
      one('instance', 'Instansiya', 'Hammasi', f.instances.map((x) => ({ value: x.value, label: withCount(x.word, x.count) }))),
      one('result', 'Natija', 'Hammasi', f.results.map((x) => ({ value: x.value, label: withCount(x.word, x.count) }))),
      one('year', 'Yil', 'Hammasi', f.years.map((x) => ({ value: String(x.value), label: withCount(`20${x.value}`, x.count) }))),
      one('court', 'Sud turi', 'Hammasi', Object.entries(f.courts).map(([k, n]) => ({ value: k, label: withCount(COURT[k] || k, n) }))),
      one('saved', 'Fayl', 'Hammasi', [{ value: '1', label: withCount('Yuklangan', f.saved) }, { value: '0', label: withCount('Yuklanmagan', f.unsaved) }])))
    resetHost.replaceChildren(any() ? h('button', { type: 'button', class: 'btn btn--small', on: { click: () => { for (const k of Object.keys(st)) st[k] = ''; page = 1; field.input.value = ''; field.el.classList.remove('field--filled'); keep(); load(true) } } }, 'Filtrlarni tozalash') : '')
  }

  /** `facets`: the filters changed, so the drop-downs and company list are drawn again; a page turn only redraws the rows */
  async function load(facets) {
    results.replaceChildren(Skeletons(2))
    try {
      const { orders: r } = await api.orders({ ...st, offset: (page - 1) * size, limit: size }, { signal })
      const pages = Math.max(1, Math.ceil(r.total / size))
      if (page > pages) { page = pages; keep(); return load(facets) } // the list got shorter than the page asked for
      if (facets || !selectsHost.firstChild) drawFacets(r)
      results.replaceChildren()
      if (!r.rows.length) { results.append(Empty(any() ? 'Bu filtr boʻyicha qaror yoʻq.' : 'Zaxirada qarorlar yoʻq. Ilovada ishning «Qarorlar» tugmasini bosib tekshiring, soʻng zaxira oling.')); return }
      const turn = (n) => { page = n; keep(); load(false); results.scrollIntoView({ block: 'start' }) }
      const resize = (n) => { size = n; setPageSize(n); page = 1; keep(); load(false) }
      const pager = () => Pager({ page, size, total: r.total, onPage: turn, onSize: resize })
      results.append(
        h('div', { class: 'section-label' }, `${num(r.total)} ta qaror · yuklangan ${num(r.saved)} · yuklanmagan ${num(r.unsaved)}`),
        pager(),
        h('div', { class: 'list' }, ...r.rows.map((o) => orderRow(o))),
        pager())
    } catch (e) {
      if (e?.name === 'AbortError') return
      results.replaceChildren(ErrorBox(e.message, () => load(facets)))
    }
  }

  const field = Field({ placeholder: 'Ish raqami, sud, sudya…', value: st.q, compact: true, onInput: debounce((v) => { st.q = v.trim(); page = 1; keep(); load(true) }) })
  load(true)
  return h('div', { class: 'stack' }, field.el, cardsHost, selectsHost, resetHost, results)
}
