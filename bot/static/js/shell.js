// The frame around every screen: search field, alphabet switch, the one-line hint. It owns the search box (a search is a route of its own).
import { h } from './ui/h.js'
import { Field, Segmented } from './ui/components.js'
import { getAlphabet, setAlphabet } from './core/prefs.js'
import { dmyIso, num } from './core/format.js'
import { go, remember, route, rerender } from './core/router.js'

let hint = null
let hintRight = null
let field = null

export function setHint(info) {
  if (!hint) return
  hint.textContent = info ? (info.ready ? `${num(info.indexed)} yozuv · ${info.companies} kompaniya` : 'Zaxira yuklanmoqda…') : ''
  hintRight.textContent = info?.backupAt ? `zaxira ${dmyIso(info.backupAt)}` : ''
}

export function mountShell(headEl) {
  let timer = 0
  const onInput = (v) => {
    clearTimeout(timer)
    const t = v.trim()
    timer = setTimeout(() => {
      if (t.length < 3) { if (route().name === 'search') go({ name: 'home' }, { replace: true }); return }
      route().name === 'search' ? (remember({ name: 'search', q: t }), rerender()) : go({ name: 'search', q: t })
    }, 220)
  }
  field = Field({ placeholder: 'Ish, kvitansiya yoki STIR', onInput })
  const seg = h('div', {})
  const drawSeg = () => seg.replaceChildren(Segmented([{ value: 'lat', label: 'Lotin' }, { value: 'cyr', label: 'Кирил' }], getAlphabet(), (a) => { setAlphabet(a); drawSeg(); rerender() }))
  drawSeg()
  hint = h('span', {})
  hintRight = h('span', {})
  headEl.append(h('div', { class: 'shell-bar' }, field.el, seg), h('div', { class: 'shell-hint' }, hint, hintRight))
}

/** the search box shows what the current search route asks (back / forward) */
export function syncSearchBox() {
  const r = route()
  if (!field) return
  const text = r.name === 'search' ? r.q : ''
  if (field.input.value.trim() !== text) { field.input.value = text; field.input.closest('.field').classList.toggle('field--filled', text !== '') }
}
