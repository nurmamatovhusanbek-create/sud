// The frame around every screen: home button, search field, the one-line hint. It owns the search box (a search is a route of its own).
import { h } from './ui/h.js'
import { Field } from './ui/components.js'
import { logo } from './ui/icons.js'
import { dmyIso, num } from './core/format.js'
import { go, onRoute, remember, route, rerender } from './core/router.js'
import { TabBar } from './ui/components.js'
import { TABS } from './screens/common.js'

let hint = null
let hintRight = null
let field = null

export function setHint(info) {
  if (!hint) return
  hint.textContent = info ? (info.ready ? `${num(info.indexed)} yozuv · ${info.companies} kompaniya` : 'Zaxira yuklanmoqda…') : ''
  hintRight.textContent = info?.backupAt ? `zaxira ${dmyIso(info.backupAt)}` : ''
}

/** the bottom bar follows the route: a tab is marked only on the home screen, a detail screen marks none */
function mountTabBar() {
  const bar = document.getElementById('tabbar')
  if (!bar) return
  onRoute((r) => bar.replaceChildren(...TabBar(TABS, r.name === 'home' ? r.tab || 'hearings' : null, (tab) => go({ name: 'home', tab }))))
}

export function mountShell(headEl) {
  mountTabBar()
  let timer = 0
  const onInput = (v) => {
    clearTimeout(timer)
    const t = v.trim()
    timer = setTimeout(() => {
      if (t.length < 3) { if (route().name === 'search') go({ name: 'home' }, { replace: true }); return }
      if (route().name === 'search') { remember({ name: 'search', q: t }); rerender() } else go({ name: 'search', q: t })
    }, 220)
  }
  field = Field({ placeholder: 'Ish, kvitansiya, STIR', onInput })
  const homeBtn = h('button', { type: 'button', class: 'brand', 'aria-label': 'Bosh sahifa', on: { click: () => go({ name: 'home' }) } }, logo(28))
  hint = h('span', {})
  hintRight = h('span', {})
  headEl.append(h('div', { class: 'shell-bar' }, homeBtn, field.el), h('div', { class: 'shell-hint' }, hint, hintRight))
}

/** the search box shows what the current search route asks (back / forward) */
export function syncSearchBox() {
  const r = route()
  if (!field) return
  const text = r.name === 'search' ? r.q : ''
  if (field.input.value.trim() !== text) { field.input.value = text; field.input.closest('.field').classList.toggle('field--filled', text !== '') }
}
