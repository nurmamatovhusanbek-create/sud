import { h } from '../ui/h.js'
import { ErrorBox, Skeletons } from '../ui/components.js'

// A tiny history router: every screen is a history entry, so the phone's back button goes back INSIDE the app.
// A route is `{ name, key?, tab?, … }`; the screens are registered by main.js. The router renders the newest route only (older answers are aborted).
const screens = {}
let current = { name: 'home' }
let outlet = null
let token = 0
let controller = null
let skeletonTimer = 0

const listeners = new Set()
export const register = (name, fn) => { screens[name] = fn }
/** called with the route every time a screen is about to be drawn (the tab bar follows it) */
export const onRoute = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const route = () => current

export function go(next, { replace = false } = {}) {
  current = next
  history[replace ? 'replaceState' : 'pushState'](next, '')
  render()
  if (!replace) window.scrollTo(0, 0)
}
/** keep the route in history WITHOUT drawing it again (a filter changed what the screen already shows) */
export function remember(next) {
  current = next
  history.replaceState(next, '')
}
export const back = () => (history.length > 1 ? history.back() : go({ name: 'home' }, { replace: true }))
export const rerender = () => render()

async function render() {
  const mine = ++token
  listeners.forEach((fn) => fn(current))
  controller?.abort()
  controller = new AbortController()
  const fn = screens[current.name] || screens.home
  // a thin bar at the top says «loading» at once (after a short delay: a fast answer shows no flicker); the skeleton replaces the old screen only if the answer is not quick
  document.documentElement.dataset.busy = '1'
  clearTimeout(skeletonTimer)
  skeletonTimer = setTimeout(() => { if (mine === token) outlet.replaceChildren(Skeletons(3)) }, 120)
  try {
    const node = await fn(current, { signal: controller.signal })
    if (mine === token && node) outlet.replaceChildren(node)
  } catch (e) {
    if (e?.name === 'AbortError' || mine !== token) return
    // a failed screen keeps its back button and offers a retry
    outlet.replaceChildren(h('div', { class: 'screen' }, h('div', { class: 'screen__top' }, h('button', { type: 'button', class: 'btn', on: { click: back } }, '← Orqaga')), ErrorBox(e.message || 'Xato', render)))
  } finally {
    if (mine === token) {
      clearTimeout(skeletonTimer)
      delete document.documentElement.dataset.busy
    }
  }
}

export function start(el, first) {
  outlet = el
  current = first
  history.replaceState(first, '')
  window.addEventListener('popstate', (e) => { current = e.state || { name: 'home' }; render() })
  return render() // resolves when the first screen is drawn (or its error): the splash goes away then
}
